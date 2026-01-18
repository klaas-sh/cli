//! Terminal UI animations and styling for klaas CLI.
//!
//! Provides visually appealing startup screens and animations with the klaas
//! brand colors (amber palette).

use std::io::{self, Write};
use std::time::{Duration, Instant};

/// Amber color palette from klaas brand (matching landing page design).
pub mod colors {
    /// Amber-500: Main accent color #f59e0b
    pub const AMBER: (u8, u8, u8) = (245, 158, 11);
    /// Amber-400: Light accent #fbbf24
    pub const AMBER_LIGHT: (u8, u8, u8) = (251, 191, 36);
    /// Amber-300: Lighter accent #fcd34d
    pub const AMBER_LIGHTER: (u8, u8, u8) = (252, 211, 77);
    /// Amber-200: Brightest highlight #fde68a
    pub const AMBER_BRIGHT: (u8, u8, u8) = (253, 230, 138);
    /// Amber-700: Dark accent #b45309
    pub const AMBER_DARK: (u8, u8, u8) = (180, 83, 9);
    /// Text primary #fafafa
    pub const TEXT_PRIMARY: (u8, u8, u8) = (250, 250, 250);
    /// Text secondary #a1a1aa
    pub const TEXT_SECONDARY: (u8, u8, u8) = (161, 161, 170);
    /// Text muted #71717a
    pub const TEXT_MUTED: (u8, u8, u8) = (113, 113, 122);
    /// Text dim #52525b
    pub const TEXT_DIM: (u8, u8, u8) = (82, 82, 91);
    /// Green for success #22c55e
    pub const GREEN: (u8, u8, u8) = (34, 197, 94);
    /// Cyan for info #22d3ee
    pub const CYAN: (u8, u8, u8) = (34, 211, 238);
}

/// Star characters for the animated spinner (matching Claude Code's sequence).
/// Uses middle dot as "off" state, lingers longer on larger stars.
const STAR_FRAMES: &[char] = &[
    '·', '·', '·', '·', '✢', '✳', '✶', '✻', '✻', '✻', '✽', '✽', '✽', '✽', '✽', '✻', '✻', '✻', '✶',
    '✶', '✳', '✢', '·',
];

/// Width of the shimmer highlight (number of characters).
const SHIMMER_WIDTH: usize = 5;

/// Number of frames to pause at each end of the shimmer.
const SHIMMER_PAUSE_FRAMES: usize = 8;

/// Timer phase symbols that rotate every 15 seconds (draining circle effect).
const TIMER_PHASE_SYMBOLS: &[char] = &['●', '◕', '◑', '◔'];

/// Generates ANSI escape code for 24-bit true color foreground.
fn fg_color(r: u8, g: u8, b: u8) -> String {
    format!("\x1b[38;2;{};{};{}m", r, g, b)
}

/// Interpolates between two colors based on a factor (0.0 to 1.0).
fn lerp_color(from: (u8, u8, u8), to: (u8, u8, u8), t: f32) -> (u8, u8, u8) {
    let t = t.clamp(0.0, 1.0);
    (
        (from.0 as f32 + (to.0 as f32 - from.0 as f32) * t) as u8,
        (from.1 as f32 + (to.1 as f32 - from.1 as f32) * t) as u8,
        (from.2 as f32 + (to.2 as f32 - from.2 as f32) * t) as u8,
    )
}

/// ANSI reset code.
const RESET: &str = "\x1b[0m";

/// Bold ANSI code.
const BOLD: &str = "\x1b[1m";

/// Hide cursor ANSI code.
const HIDE_CURSOR: &str = "\x1b[?25l";

/// Show cursor ANSI code.
const SHOW_CURSOR: &str = "\x1b[?25h";

/// Hides the terminal cursor.
pub fn hide_cursor() {
    print!("{}", HIDE_CURSOR);
    let _ = io::stdout().flush();
}

/// Shows the terminal cursor.
pub fn show_cursor() {
    print!("{}", SHOW_CURSOR);
    let _ = io::stdout().flush();
}

/// Shimmer direction.
#[derive(Clone, Copy, PartialEq)]
enum ShimmerDirection {
    Forward,
    Backward,
}

/// Animation state for the waiting spinner.
pub struct WaitingAnimation {
    frame: usize,
    shimmer_pos: isize,
    text_len: usize,
    direction: ShimmerDirection,
    pause_frames: usize,
    start_time: Instant,
    expires_in_secs: u64,
}

impl WaitingAnimation {
    /// Creates a new waiting animation with the given expiry time in seconds.
    pub fn new(expires_in_secs: u64) -> Self {
        let text = "Waiting for authorisation…";
        Self {
            frame: 0,
            shimmer_pos: -(SHIMMER_WIDTH as isize),
            text_len: text.chars().count(),
            direction: ShimmerDirection::Forward,
            pause_frames: 0,
            start_time: Instant::now(),
            expires_in_secs,
        }
    }

    /// Returns the remaining seconds until expiry.
    pub fn remaining_secs(&self) -> u64 {
        let elapsed = self.start_time.elapsed().as_secs();
        self.expires_in_secs.saturating_sub(elapsed)
    }

    /// Returns true if the authorization has expired.
    pub fn is_expired(&self) -> bool {
        self.remaining_secs() == 0
    }

    /// Renders a single frame of the "Waiting for authorization" animation.
    ///
    /// The star character cycles through different symbols, and a single
    /// bright highlight moves back and forth through the amber-colored text.
    pub fn render_frame(&mut self) {
        let star = STAR_FRAMES[self.frame % STAR_FRAMES.len()];
        let text = "Waiting for authorisation…";

        // Build the animated text with single shimmer highlight
        let mut output = String::new();

        // Animated star in bright amber
        let (r, g, b) = colors::AMBER_BRIGHT;
        output.push_str(&format!(
            "\r  {}{}{}{} ",
            BOLD,
            fg_color(r, g, b),
            star,
            RESET
        ));

        // Text with single moving highlight
        // Base color is amber, highlight fades to bright
        for (i, ch) in text.chars().enumerate() {
            let distance = (i as isize - self.shimmer_pos).unsigned_abs();

            let color = if distance < SHIMMER_WIDTH {
                // Within highlight range - interpolate from bright to base
                let t = distance as f32 / SHIMMER_WIDTH as f32;
                lerp_color(colors::AMBER_BRIGHT, colors::AMBER, t)
            } else {
                colors::AMBER
            };

            let (r, g, b) = color;
            output.push_str(&fg_color(r, g, b));
            output.push(ch);
        }
        output.push_str(RESET);

        // Add countdown timer with rotating phase symbol
        let remaining = self.remaining_secs();
        let elapsed = self.start_time.elapsed().as_secs();
        // Symbol changes every 15 seconds: ● ◕ ◑ ◔
        let phase_index = ((elapsed / 15) % 4) as usize;
        let phase_symbol = TIMER_PHASE_SYMBOLS[phase_index];

        let time_text = if remaining == 0 {
            "0 seconds left".to_string()
        } else if remaining <= 60 {
            // Show seconds in the last minute
            if remaining == 1 {
                "1 second left".to_string()
            } else {
                format!("{} seconds left", remaining)
            }
        } else {
            // Show minutes when > 1 minute
            let minutes = remaining.div_ceil(60);
            if minutes == 1 {
                "1 minute left".to_string()
            } else {
                format!("{} minutes left", minutes)
            }
        };
        // Timer on new line, aligned with "Waiting" (4 spaces = "  · ")
        let (mr, mg, mb) = colors::TEXT_MUTED;
        let timer_line = format!(
            "    {}({} {}){}",
            fg_color(mr, mg, mb),
            phase_symbol,
            time_text,
            RESET
        );

        // Clear current line, print main text, then newline and timer
        // Use \x1b[K to clear to end of line (removes stale characters)
        // Use \r before timer_line to ensure it starts at column 0
        print!("\r{}\x1b[K\n\r{}\x1b[K\x1b[1A", output, timer_line);
        let _ = io::stdout().flush();

        // Advance star animation
        self.frame = (self.frame + 1) % STAR_FRAMES.len();

        // Handle pause at ends
        if self.pause_frames > 0 {
            self.pause_frames -= 1;
            return;
        }

        // Move shimmer position based on direction
        match self.direction {
            ShimmerDirection::Forward => {
                self.shimmer_pos += 1;
                // Check if we've reached the end
                if self.shimmer_pos >= (self.text_len + SHIMMER_WIDTH) as isize {
                    self.direction = ShimmerDirection::Backward;
                    self.pause_frames = SHIMMER_PAUSE_FRAMES;
                }
            }
            ShimmerDirection::Backward => {
                self.shimmer_pos -= 1;
                // Check if we've reached the start
                if self.shimmer_pos <= -(SHIMMER_WIDTH as isize) {
                    self.direction = ShimmerDirection::Forward;
                    self.pause_frames = SHIMMER_PAUSE_FRAMES;
                }
            }
        }
    }

    /// Clears the animation lines (main line + timer line).
    pub fn clear(&self) {
        // Clear current line, move down, clear timer line, move back up
        print!("\r\x1b[K\n\x1b[K\x1b[1A");
        let _ = io::stdout().flush();
    }
}

impl Default for WaitingAnimation {
    fn default() -> Self {
        Self::new(600) // Default 10 minutes
    }
}

/// ASCII art logo for klaas (terminal window icon).
const LOGO: &[&str] = &["╭────────╮", "├────────┤", "│ ❯ __   │", "╰────────╯"];

/// Displays the klaas startup banner.
///
/// Shows a minimal, elegant header with the klaas branding.
pub fn display_startup_banner() {
    let (ar, ag, ab) = colors::AMBER;
    let (tr, tg, tb) = colors::TEXT_SECONDARY;

    // Print ASCII art logo with text on right side
    println!();
    println!("  {}{}{}", fg_color(ar, ag, ab), LOGO[0], RESET);
    println!(
        "  {}{}{} {}{}klaas{} {}v{}{}",
        fg_color(ar, ag, ab),
        LOGO[1],
        RESET,
        BOLD,
        fg_color(ar, ag, ab),
        RESET,
        fg_color(tr, tg, tb),
        env!("CARGO_PKG_VERSION"),
        RESET
    );
    println!(
        "  {}{}{} {}Remote Terminal Access{}",
        fg_color(ar, ag, ab),
        LOGO[2],
        RESET,
        fg_color(tr, tg, tb),
        RESET
    );
    println!("  {}{}{}", fg_color(ar, ag, ab), LOGO[3], RESET);
    println!();
}

/// Displays auth instructions with branded styling.
pub fn display_auth_instructions(
    _verification_uri: &str,
    _user_code: &str,
    verification_uri_complete: Option<&str>,
) {
    let (al, alg, alb) = colors::AMBER_LIGHT;
    let (tr, tg, tb) = colors::TEXT_SECONDARY;

    println!();
    println!(
        "  {}To connect this device, visit:{}",
        fg_color(tr, tg, tb),
        RESET
    );
    println!();

    // Prefer the complete URL (with code embedded)
    let url = verification_uri_complete.unwrap_or(_verification_uri);
    println!("    {}{}{}{}", BOLD, fg_color(al, alg, alb), url, RESET);
    println!();
}

/// Displays a success message when authentication completes.
pub fn display_auth_success() {
    let (gr, gg, gb) = colors::GREEN;
    println!(
        "\r  {}{}✓{} Authentication successful!{}",
        BOLD,
        fg_color(gr, gg, gb),
        RESET,
        RESET
    );
}

/// Displays a message when the device code expires and a new one is requested.
pub fn display_code_expired() {
    let (ar, ag, ab) = colors::AMBER;
    let (mr, mg, mb) = colors::TEXT_MUTED;
    println!(
        "\r  {}{}↻{} Code expired. Requesting new code...{}",
        BOLD,
        fg_color(ar, ag, ab),
        RESET,
        RESET
    );
    println!(
        "    {}Press ESC to continue without syncing.{}",
        fg_color(mr, mg, mb),
        RESET
    );
    println!();
}

/// Displays pairing instructions for the ECDH key exchange flow.
pub fn display_pairing_instructions(verification_uri: &str, pairing_code: &str) {
    let (ar, ag, ab) = colors::AMBER;
    let (al, alg, alb) = colors::AMBER_LIGHT;
    let (cr, cg, cb) = colors::CYAN;

    println!();
    println!(
        "  {}{}To connect this device:{}",
        BOLD,
        fg_color(ar, ag, ab),
        RESET
    );
    println!();

    // Display the pairing code prominently
    println!(
        "    Open the Dashboard and enter code: {}{}{}{}",
        BOLD,
        fg_color(cr, cg, cb),
        pairing_code,
        RESET
    );
    println!();

    // Display the URL
    println!(
        "    Or visit: {}{}{}{}",
        BOLD,
        fg_color(al, alg, alb),
        verification_uri,
        RESET
    );
    println!();
}

/// Displays a success message when pairing completes.
pub fn display_pairing_success() {
    let (gr, gg, gb) = colors::GREEN;
    println!(
        "\r  {}{}✓{} Device paired successfully!{}",
        BOLD,
        fg_color(gr, gg, gb),
        RESET,
        RESET
    );
}

/// Displays session connected message.
pub fn display_session_connected(session_url: Option<&str>) {
    let (cr, cg, cb) = colors::CYAN;
    let (ar, ag, ab) = colors::AMBER_LIGHT;

    if let Some(url) = session_url {
        println!(
            "  {}{}✓{} Session streaming to: {}{}{}{}",
            BOLD,
            fg_color(cr, cg, cb),
            RESET,
            BOLD,
            fg_color(ar, ag, ab),
            url,
            RESET
        );
    } else {
        println!(
            "  {}{}✓{} Session connected{}",
            BOLD,
            fg_color(cr, cg, cb),
            RESET,
            RESET
        );
    }
    println!();
}

/// Displays offline mode warning.
pub fn display_offline_warning() {
    let (yr, yg, yb) = colors::AMBER;
    let (mr, mg, mb) = colors::TEXT_MUTED;

    println!(
        "  {}{}!{} Unable to connect to klaas server.{}",
        BOLD,
        fg_color(yr, yg, yb),
        RESET,
        RESET
    );
    println!(
        "    {}Running in offline mode - no remote sync.{}",
        fg_color(mr, mg, mb),
        RESET
    );
    println!();
}

/// Returns the animation frame interval for smooth animation.
pub fn animation_interval() -> Duration {
    Duration::from_millis(80)
}

/// Displays an interactive agent selection menu.
///
/// Shows a list of available agents with keyboard shortcuts.
/// User can select by pressing the shortcut key or using arrow keys.
///
/// # Arguments
/// * `agents` - List of installed agents to choose from
///
/// # Returns
/// The selected agent or a cancellation/error result.
pub fn select_agent(agents: &[&crate::agents::Agent]) -> crate::agents::AgentSelection {
    use crate::agents::AgentSelection;
    use crossterm::{
        event::{self, Event, KeyCode},
        terminal,
    };

    if agents.is_empty() {
        return AgentSelection::NoneInstalled;
    }

    // Enter raw mode for keyboard input
    if terminal::enable_raw_mode().is_err() {
        // Fall back to first agent if we can't enter raw mode
        return AgentSelection::Selected(agents[0].clone());
    }

    let mut selected_index: usize = 0;
    let mut stdout = io::stdout();

    // Draw initial menu
    draw_agent_menu(&mut stdout, agents, selected_index, false);

    let result = loop {
        // Wait for key event
        if let Ok(Event::Key(key_event)) = event::read() {
            match key_event.code {
                KeyCode::Up => {
                    // Wrap around: if at top, go to bottom
                    if selected_index > 0 {
                        selected_index -= 1;
                    } else {
                        selected_index = agents.len() - 1;
                    }
                    draw_agent_menu(&mut stdout, agents, selected_index, true);
                }
                KeyCode::Down => {
                    // Wrap around: if at bottom, go to top
                    if selected_index < agents.len() - 1 {
                        selected_index += 1;
                    } else {
                        selected_index = 0;
                    }
                    draw_agent_menu(&mut stdout, agents, selected_index, true);
                }
                KeyCode::Enter => {
                    break AgentSelection::Selected(agents[selected_index].clone());
                }
                KeyCode::Esc => {
                    break AgentSelection::Cancelled;
                }
                KeyCode::Char(c) => {
                    // Ctrl+C to cancel (same as Esc)
                    if c == 'c' && key_event.modifiers.contains(event::KeyModifiers::CONTROL) {
                        break AgentSelection::Cancelled;
                    }
                    // Check for shortcut key
                    let upper = c.to_ascii_uppercase();
                    if let Some(idx) = agents.iter().position(|a| a.shortcut_key() == upper) {
                        selected_index = idx;
                        break AgentSelection::Selected(agents[selected_index].clone());
                    }
                }
                _ => {}
            }
        }
    };

    // Exit raw mode and clear menu
    let _ = terminal::disable_raw_mode();
    clear_agent_menu(&mut stdout, agents.len());

    result
}

/// Draws the agent selection menu.
/// If `is_redraw` is true, moves cursor up to overwrite the previous menu.
fn draw_agent_menu(
    stdout: &mut io::Stdout,
    agents: &[&crate::agents::Agent],
    selected_index: usize,
    is_redraw: bool,
) {
    use crossterm::{cursor, terminal, QueueableCommand};

    let (ar, ag, ab) = colors::AMBER;
    let (tr, tg, tb) = colors::TEXT_SECONDARY;
    let (mr, mg, mb) = colors::TEXT_MUTED;
    let (cr, cg, cb) = colors::CYAN;

    // If redrawing, move cursor up to overwrite previous menu
    // Menu structure: 1 header + 1 blank + agents + 1 blank + 1 footer = agents + 4
    if is_redraw {
        let lines_to_move_up = agents.len() + 4;
        for _ in 0..lines_to_move_up {
            let _ = stdout.queue(cursor::MoveUp(1));
            let _ = stdout.queue(terminal::Clear(terminal::ClearType::CurrentLine));
        }
    }

    // Move to start of line
    let _ = stdout.queue(cursor::MoveToColumn(0));

    // Print header
    print!(
        "  {}{}Select an agent:{}\r\n\r\n",
        BOLD,
        fg_color(ar, ag, ab),
        RESET
    );

    // Print each agent
    for (idx, agent) in agents.iter().enumerate() {
        let is_selected = idx == selected_index;
        let shortcut = agent.shortcut_key();

        // Selection indicator
        let indicator = if is_selected { "›" } else { " " };

        // Color based on selection
        let (name_color, shortcut_color) = if is_selected {
            ((ar, ag, ab), (cr, cg, cb))
        } else {
            ((tr, tg, tb), (mr, mg, mb))
        };

        print!(
            "  {} {}[{}]{} {}{}{}\r\n",
            indicator,
            fg_color(shortcut_color.0, shortcut_color.1, shortcut_color.2),
            shortcut,
            RESET,
            fg_color(name_color.0, name_color.1, name_color.2),
            agent.name,
            RESET
        );
    }

    // Print instructions
    print!(
        "\r\n  {}Use ↑↓ arrows and Enter or press shortcut. Esc to cancel.{}\r\n",
        fg_color(mr, mg, mb),
        RESET
    );

    let _ = stdout.flush();
}

/// Clears the agent selection menu from the terminal.
fn clear_agent_menu(stdout: &mut io::Stdout, agent_count: usize) {
    use crossterm::{cursor, terminal, QueueableCommand};

    // Move up to clear all lines (1 header + 1 blank + agents + 1 blank + 1 footer)
    let lines_to_clear = agent_count + 4;

    for _ in 0..lines_to_clear {
        let _ = stdout.queue(cursor::MoveUp(1));
        let _ = stdout.queue(terminal::Clear(terminal::ClearType::CurrentLine));
    }

    let _ = stdout.flush();
}

/// Displays a notice that hooks are available but not configured.
///
/// This is shown when an agent supports hooks (like Claude Code or Gemini CLI)
/// but the user hasn't set up the klaas hook in their settings yet.
pub fn display_hooks_available_notice(agent: &crate::agents::Agent) {
    let (cr, cg, cb) = colors::CYAN;
    let (mr, mg, mb) = colors::TEXT_MUTED;
    let (ar, ag, ab) = colors::AMBER_LIGHT;

    // Use shorter name without company prefix for display
    let display_name = agent
        .name
        .strip_prefix("Anthropic ")
        .or_else(|| agent.name.strip_prefix("Google "))
        .or_else(|| agent.name.strip_prefix("OpenAI "))
        .unwrap_or(&agent.name);

    println!(
        "  {}{}ℹ{} {} supports hooks for permission notifications",
        BOLD,
        fg_color(cr, cg, cb),
        RESET,
        display_name
    );
    println!(
        "    {}To enable, add to your {} settings:{}",
        fg_color(mr, mg, mb),
        display_name,
        RESET
    );
    println!(
        "    {}› klaas hooks setup --{}{}",
        fg_color(ar, ag, ab),
        agent.id,
        RESET
    );
    println!();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fg_color_generation() {
        let color = fg_color(255, 128, 0);
        assert_eq!(color, "\x1b[38;2;255;128;0m");
    }

    #[test]
    fn test_waiting_animation_new() {
        let anim = WaitingAnimation::new(600);
        assert_eq!(anim.frame, 0);
        assert_eq!(anim.shimmer_pos, -(SHIMMER_WIDTH as isize));
        assert_eq!(anim.expires_in_secs, 600);
    }

    #[test]
    fn test_star_frames_not_empty() {
        assert!(!STAR_FRAMES.is_empty());
    }

    #[test]
    fn test_lerp_color() {
        let from = (0, 0, 0);
        let to = (255, 255, 255);
        let mid = lerp_color(from, to, 0.5);
        assert_eq!(mid, (127, 127, 127));
    }

    #[test]
    fn test_lerp_color_clamped() {
        let from = (100, 100, 100);
        let to = (200, 200, 200);
        // Values outside 0-1 should be clamped
        let below = lerp_color(from, to, -0.5);
        let above = lerp_color(from, to, 1.5);
        assert_eq!(below, from);
        assert_eq!(above, to);
    }
}
