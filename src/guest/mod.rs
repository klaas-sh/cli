//! Guest terminal mode for viewing remote sessions.
//!
//! This module provides the ability to connect to and view a remote klaas
//! session as a guest. Guests can observe the terminal output in real-time
//! and optionally send input (prompts) to the host session.

pub mod terminal;

pub use terminal::run;
