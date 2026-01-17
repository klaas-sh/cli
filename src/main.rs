//! Remote access wrapper for AI coding agents.
//!
//! Wraps AI agent CLI sessions and enables remote access via a web interface.
//! Sessions auto-attach on startup for streaming to the cloud.
//!
//! # Usage
//!
//! ```bash
//! # Start with auto-detected agent
//! klaas
//!
//! # Start with specific agent
//! klaas --agent claude
//! klaas --gemini
//! klaas -a codex
//!
//! # List available agents
//! klaas --list-agents
//!
//! # Pass through agent flags (after --)
//! klaas --claude -- --model sonnet --allowedTools Read,Write
//! ```

use clap::{Parser, Subcommand};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod agents;
mod app;
mod auth;
mod config;
mod credentials;
mod crypto;
mod error;
mod hook;
mod pty;
mod terminal;
mod types;
mod ui;
mod update;
mod websocket;

/// CLI arguments.
#[derive(Parser)]
#[command(name = "klaas")]
#[command(about = "Remote access wrapper for AI coding agents")]
#[command(version, disable_version_flag = true)]
#[command(long_about = "Wraps AI agent CLI sessions and enables remote access \
    via a web interface. Sessions auto-attach on startup.\n\n\
    Supports Claude Code, Gemini CLI, Codex, Aider, and more.\n\
    All input is passed through to the agent. \
    All output is captured for remote streaming.")]
struct Cli {
    /// Print version.
    #[arg(short = 'v', long = "version", action = clap::ArgAction::Version)]
    version: (),

    /// Subcommand to run.
    #[command(subcommand)]
    command: Option<Commands>,

    /// Select which agent to run.
    #[arg(short = 'a', long = "agent", value_name = "AGENT")]
    agent: Option<String>,

    /// Resume the previous session instead of starting a new one.
    #[arg(long)]
    resume: bool,

    /// Arguments to pass through to the agent.
    /// All unrecognized arguments are forwarded.
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    agent_args: Vec<String>,
}

/// Available subcommands.
#[derive(Subcommand)]
enum Commands {
    /// List installed agents.
    Agents,

    /// Upgrade klaas to the latest version.
    #[command(alias = "update")]
    Upgrade,

    /// Uninstall klaas from this system.
    Uninstall {
        /// Remove all user data (credentials and config) without prompting.
        #[arg(long)]
        purge: bool,
    },

    /// Handle hook events from agents (internal use).
    /// Called by agent CLIs when hooks fire, not by users directly.
    Hook {
        /// The hook event type.
        #[arg(value_name = "EVENT")]
        event: String,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load environment variables from .env file (if present)
    dotenvy::dotenv().ok();

    // Initialize logging
    // Only log to stderr so we don't interfere with PTY output
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "klaas=warn".into()),
        )
        .with(tracing_subscriber::fmt::layer().with_writer(std::io::stderr))
        .init();

    let cli = Cli::parse();

    // Handle subcommands
    if let Some(command) = cli.command {
        let exit_code = match command {
            Commands::Agents => {
                list_agents();
                0
            }
            Commands::Upgrade => match update::perform_update().await {
                Ok(()) => 0,
                Err(e) => {
                    eprintln!("Upgrade failed: {}", e);
                    1
                }
            },
            Commands::Uninstall { purge } => match perform_uninstall(purge) {
                Ok(()) => 0,
                Err(e) => {
                    eprintln!("Uninstall failed: {}", e);
                    1
                }
            },
            Commands::Hook { event } => match hook::handle_hook(&event).await {
                Ok(()) => 0,
                Err(e) => {
                    eprintln!("{}", e);
                    1
                }
            },
        };
        std::process::exit(exit_code);
    }

    // Spawn background update check (non-blocking)
    update::spawn_update_check();

    // Display startup banner and hide cursor during startup
    ui::display_startup_banner();
    ui::hide_cursor();

    // Select agent to run
    let selected_agent = match select_agent(&cli) {
        agents::AgentSelection::Selected(agent) => {
            ui::show_cursor();
            agent
        }
        agents::AgentSelection::Cancelled => {
            ui::show_cursor();
            std::process::exit(0);
        }
        agents::AgentSelection::NoneInstalled => {
            ui::show_cursor();
            eprintln!("Error: No supported AI coding agents found.");
            eprintln!();
            eprintln!("Install one of the following:");
            eprintln!("  - Claude Code: https://claude.ai/download");
            eprintln!("  - Gemini CLI: https://ai.google.dev/gemini-cli");
            eprintln!("  - Codex CLI: https://openai.com/codex");
            eprintln!("  - Aider: pip install aider-chat");
            std::process::exit(1);
        }
    };

    // Run the application with selected agent
    let exit_code = match app::run(selected_agent, cli.agent_args, cli.resume).await {
        Ok(code) => {
            // Show update notification after agent exits
            update::display_update_notification();
            code
        }
        Err(e) => {
            eprintln!("Error: {}", e);
            1
        }
    };

    std::process::exit(exit_code);
}

/// Selects an agent based on CLI flags and installed agents.
fn select_agent(cli: &Cli) -> agents::AgentSelection {
    use agents::{AgentRegistry, AgentSelection};
    use config::{load_config, KlaasConfig};

    // Load configuration
    let klaas_config: KlaasConfig = load_config();

    // Build registry with custom agents
    let mut registry = AgentRegistry::new();
    if !klaas_config.agents.is_empty() {
        let custom: std::collections::HashMap<String, agents::Agent> = klaas_config
            .agents
            .into_iter()
            .map(|(id, cfg)| {
                let mut agent: agents::Agent = cfg.into();
                agent.id = id.clone();
                (id, agent)
            })
            .collect();
        registry.add_custom(custom);
    }

    // Check if user specified an agent via -a/--agent flag
    if let Some(ref agent_id) = cli.agent {
        if let Some(agent) = registry.get(agent_id) {
            if agent.is_installed() {
                return AgentSelection::Selected(agent.clone());
            } else {
                eprintln!(
                    "Error: Agent '{}' ({}) is not installed.",
                    agent_id, agent.name
                );
                eprintln!("Run 'klaas --list-agents' to see available agents.");
                std::process::exit(1);
            }
        } else {
            eprintln!("Error: Unknown agent '{}'.", agent_id);
            eprintln!("Run 'klaas --list-agents' to see available agents.");
            std::process::exit(1);
        }
    }

    // Filter agents by config
    let candidates: Vec<&agents::Agent> = if !klaas_config.only.is_empty() {
        registry.filter_only(&klaas_config.only)
    } else if !klaas_config.also.is_empty() {
        registry.filter_also(&klaas_config.also)
    } else {
        registry.all()
    };

    // Detect which are installed
    let installed_refs = registry.detect_installed_from(&candidates);

    // Convert to owned agents and add shell option if multiple agents exist
    let shell_agent = agents::shell_agent();
    let mut installed: Vec<agents::Agent> = installed_refs.iter().map(|a| (*a).clone()).collect();

    if !installed.is_empty() {
        if let Some(shell) = shell_agent {
            installed.push(shell);
        }
    }

    match installed.len() {
        0 => AgentSelection::NoneInstalled,
        1 => {
            // Auto-select the only installed agent
            AgentSelection::Selected(installed[0].clone())
        }
        _ => {
            // Check if there's a default agent specified in config
            if let Some(ref default_id) = klaas_config.default_agent {
                if let Some(agent) = installed.iter().find(|a| a.id == *default_id) {
                    return AgentSelection::Selected(agent.clone());
                }
            }

            // Multiple agents - show interactive selection
            let refs: Vec<&agents::Agent> = installed.iter().collect();
            ui::select_agent(&refs)
        }
    }
}

/// Uninstalls klaas from the system.
fn perform_uninstall(purge: bool) -> anyhow::Result<()> {
    use std::io::{self, Write};
    use ui::colors;

    // Find where klaas is installed
    let current_exe = std::env::current_exe()?;
    let binary_path = current_exe.canonicalize()?;

    // User data directory (~/.klaas/) - contains credentials and config
    let user_data_dir = dirs::home_dir()
        .map(|p| p.join(".klaas"))
        .unwrap_or_default();

    // Cache directory (~/Library/Caches/klaas/ on macOS, ~/.cache/klaas/ on Linux)
    let cache_dir = dirs::cache_dir()
        .map(|p| p.join("klaas"))
        .unwrap_or_default();

    println!();
    println!(
        "  {}Uninstalling klaas...{}",
        fg_color(colors::AMBER),
        reset()
    );
    println!();

    // Show what will be removed
    println!("  This will remove:");
    println!(
        "    {}• {}{}",
        fg_color(colors::TEXT_SECONDARY),
        binary_path.display(),
        reset()
    );
    if cache_dir.exists() {
        println!(
            "    {}• {}{} (cache)",
            fg_color(colors::TEXT_SECONDARY),
            cache_dir.display(),
            reset()
        );
    }
    println!();

    // Confirm uninstall
    print!(
        "  {}Continue? [y/N]{} ",
        fg_color(colors::TEXT_MUTED),
        reset()
    );
    io::stdout().flush()?;

    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    let confirm = input.trim().to_lowercase();

    if confirm != "y" && confirm != "yes" {
        println!();
        println!("  Cancelled.");
        println!();
        return Ok(());
    }

    // Ask about user data unless --purge was specified
    let remove_user_data = if purge {
        true
    } else if user_data_dir.exists() {
        println!();
        print!(
            "  {}Remove user data (credentials and config)? [y/N]{} ",
            fg_color(colors::TEXT_MUTED),
            reset()
        );
        io::stdout().flush()?;

        input.clear();
        io::stdin().read_line(&mut input)?;
        let answer = input.trim().to_lowercase();
        answer == "y" || answer == "yes"
    } else {
        false
    };

    println!();

    // Remove cache directory
    if cache_dir.exists() {
        std::fs::remove_dir_all(&cache_dir)?;
        println!(
            "  {}✓{} Removed {}",
            fg_color(colors::GREEN),
            reset(),
            cache_dir.display()
        );
    }

    // Remove user data directory if requested
    if remove_user_data && user_data_dir.exists() {
        std::fs::remove_dir_all(&user_data_dir)?;
        println!(
            "  {}✓{} Removed {}",
            fg_color(colors::GREEN),
            reset(),
            user_data_dir.display()
        );
    }

    // Remove binary (schedule for deletion on Windows, direct on Unix)
    #[cfg(unix)]
    {
        std::fs::remove_file(&binary_path)?;
        println!(
            "  {}✓{} Removed {}",
            fg_color(colors::GREEN),
            reset(),
            binary_path.display()
        );
    }

    #[cfg(windows)]
    {
        // On Windows, we can't delete a running executable directly.
        // Schedule deletion via a batch script that runs after we exit.
        let batch_content = format!(
            "@echo off\n\
             :retry\n\
             del \"{}\" >nul 2>&1\n\
             if exist \"{}\" (\n\
                 timeout /t 1 /nobreak >nul\n\
                 goto retry\n\
             )\n\
             del \"%~f0\"\n",
            binary_path.display(),
            binary_path.display()
        );
        let temp_dir = std::env::temp_dir();
        let batch_path = temp_dir.join("klaas_uninstall.bat");
        std::fs::write(&batch_path, batch_content)?;

        // Run the batch script detached
        std::process::Command::new("cmd")
            .args(["/C", "start", "/min", "", &batch_path.to_string_lossy()])
            .spawn()?;

        println!(
            "  {}✓{} Scheduled removal of {}",
            fg_color(colors::GREEN),
            reset(),
            binary_path.display()
        );
    }

    println!();
    println!(
        "  {}klaas has been uninstalled.{}",
        fg_color(colors::GREEN),
        reset()
    );

    // Note about preserved user data
    if !remove_user_data && user_data_dir.exists() {
        println!();
        println!(
            "  {}User data preserved at: {}{}",
            fg_color(colors::TEXT_MUTED),
            user_data_dir.display(),
            reset()
        );
    }

    println!();

    Ok(())
}

/// Lists installed agents.
fn list_agents() {
    use agents::AgentRegistry;
    use config::load_config;
    use ui::colors;

    let klaas_config = load_config();
    let mut registry = AgentRegistry::new();

    // Add custom agents
    if !klaas_config.agents.is_empty() {
        let custom: std::collections::HashMap<String, agents::Agent> = klaas_config
            .agents
            .into_iter()
            .map(|(id, cfg)| {
                let mut agent: agents::Agent = cfg.into();
                agent.id = id.clone();
                (id, agent)
            })
            .collect();
        registry.add_custom(custom);
    }

    // Filter to only installed agents
    let installed: Vec<_> = registry
        .all()
        .into_iter()
        .filter(|a| a.is_installed())
        .collect();

    println!();
    if installed.is_empty() {
        println!(
            "  {}No agents installed.{}",
            fg_color(colors::TEXT_MUTED),
            reset()
        );
        println!();
        println!("  Install one of the following:");
        println!("    - Claude Code: https://claude.ai/download");
        println!("    - Gemini CLI:  https://ai.google.dev/gemini-cli");
        println!("    - Codex CLI:   https://openai.com/codex");
    } else {
        println!("  {}Installed agents:{}", fg_color(colors::AMBER), reset());
        println!();
        for agent in installed {
            println!("    {:<12} - {}", agent.id, agent.name);
        }
    }
    println!();
}

/// Generates ANSI escape code for 24-bit true color foreground.
fn fg_color(color: (u8, u8, u8)) -> String {
    format!("\x1b[38;2;{};{};{}m", color.0, color.1, color.2)
}

/// ANSI reset code.
fn reset() -> &'static str {
    "\x1b[0m"
}
