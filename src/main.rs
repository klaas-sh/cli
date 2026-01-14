//! Remote access wrapper for Claude Code.
//!
//! Wraps Claude Code sessions and enables remote access via a web interface.
//! Sessions auto-attach on startup for streaming to the cloud.
//!
//! # Usage
//!
//! ```bash
//! # Start Claude Code with remote access
//! nexo
//!
//! # Start with a prompt
//! nexo -p "Review this codebase"
//!
//! # Pass through Claude Code flags
//! nexo --model sonnet --allowedTools Read,Write
//! ```

use clap::Parser;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod app;
mod auth;
mod config;
mod credentials;
mod error;
mod pty;
mod terminal;
mod types;
mod websocket;

/// CLI arguments.
#[derive(Parser)]
#[command(name = "nexo")]
#[command(about = "Remote access wrapper for Claude Code")]
#[command(version)]
#[command(long_about = "Wraps Claude Code sessions and enables remote access \
    via a web interface. Sessions auto-attach on startup.\n\n\
    All input is passed through to Claude Code. \
    All output is captured for remote streaming.")]
struct Cli {
    /// Start a new session instead of resuming the previous one.
    /// Without this flag, nexo will resume the last session if it exists.
    #[arg(long)]
    new_session: bool,

    /// Arguments to pass through to Claude Code.
    /// All unrecognized arguments are forwarded.
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    claude_args: Vec<String>,
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
                .unwrap_or_else(|_| "nexo=warn".into()),
        )
        .with(tracing_subscriber::fmt::layer().with_writer(std::io::stderr))
        .init();

    let cli = Cli::parse();

    // Run the application
    let exit_code = match app::run(cli.claude_args, cli.new_session).await {
        Ok(code) => code,
        Err(e) => {
            eprintln!("Error: {}", e);
            1
        }
    };

    std::process::exit(exit_code);
}
