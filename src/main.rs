//! Remote access wrapper for Claude Code.
//!
//! Wraps Claude Code sessions and enables remote access via a web interface.
//! Sessions auto-attach on startup for streaming to the cloud.
//!
//! # Usage
//!
//! ```bash
//! # Start Claude Code with remote access
//! klaas
//!
//! # Start with a prompt
//! klaas -p "Review this codebase"
//!
//! # Pass through Claude Code flags
//! klaas --model sonnet --allowedTools Read,Write
//! ```

use clap::{Parser, Subcommand};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod app;
mod auth;
mod config;
mod credentials;
mod error;
mod pty;
mod terminal;
mod types;
mod ui;
mod update;
mod websocket;

/// CLI arguments.
#[derive(Parser)]
#[command(name = "klaas")]
#[command(about = "Remote access wrapper for Claude Code")]
#[command(version)]
#[command(long_about = "Wraps Claude Code sessions and enables remote access \
    via a web interface. Sessions auto-attach on startup.\n\n\
    All input is passed through to Claude Code. \
    All output is captured for remote streaming.")]
struct Cli {
    /// Subcommand to run.
    #[command(subcommand)]
    command: Option<Commands>,

    /// Start a new session instead of resuming the previous one.
    /// Without this flag, klaas will resume the last session if it exists.
    #[arg(long)]
    new_session: bool,

    /// Arguments to pass through to Claude Code.
    /// All unrecognized arguments are forwarded.
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    claude_args: Vec<String>,
}

/// Available subcommands.
#[derive(Subcommand)]
enum Commands {
    /// Update klaas to the latest version.
    Update,
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
            Commands::Update => match update::perform_update().await {
                Ok(()) => 0,
                Err(e) => {
                    eprintln!("Update failed: {}", e);
                    1
                }
            },
        };
        std::process::exit(exit_code);
    }

    // Spawn background update check (non-blocking)
    update::spawn_update_check();

    // Run the application
    let exit_code = match app::run(cli.claude_args, cli.new_session).await {
        Ok(code) => {
            // Show update notification after Claude Code exits
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
