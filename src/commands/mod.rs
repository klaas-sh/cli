//! CLI commands module.
//!
//! This module contains subcommands for session management:
//! - `sessions`: List and select sessions interactively
//! - `connect`: Connect to a session as a guest
//! - `fleet`: List and attach to the Maestro fleet

pub mod connect;
pub mod fleet;
pub mod sessions;
