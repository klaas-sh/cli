//! Terminal UI animations and styling for Klaas CLI.
//!
//! Provides visually appealing startup screens and animations with the klaas
//! brand colors (amber palette).

use std::io::{self, Write};
use std::time::Duration;

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

/// Star characters for the animated spinner.
const STAR_FRAMES: &[char] = &['✢', '✣', '✤', '✻', '✼', '✽', '❉', '❈', '❊', '※'];

/// Width of the shimmer highlight (number of characters).
const SHIMMER_WIDTH: usize = 5;

/// Number of frames to pause at each end of the shimmer.
const SHIMMER_PAUSE_FRAMES: usize = 8;

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
}

impl WaitingAnimation {
    /// Creates a new waiting animation.
    pub fn new() -> Self {
        let text = "Waiting for authorisation...";
        Self {
            frame: 0,
            shimmer_pos: -(SHIMMER_WIDTH as isize),
            text_len: text.chars().count(),
            direction: ShimmerDirection::Forward,
            pause_frames: 0,
        }
    }

    /// Renders a single frame of the "Waiting for authorization" animation.
    ///
    /// The star character cycles through different symbols, and a single
    /// bright highlight moves back and forth through the amber-colored text.
    pub fn render_frame(&mut self) {
        let star = STAR_FRAMES[self.frame % STAR_FRAMES.len()];
        let text = "Waiting for authorisation...";

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

        print!("{}", output);
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

    /// Clears the animation line.
    pub fn clear(&self) {
        print!("\r{}\r", " ".repeat(60));
        let _ = io::stdout().flush();
    }
}

impl Default for WaitingAnimation {
    fn default() -> Self {
        Self::new()
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

    // Print ASCII art logo in amber
    println!();
    for line in LOGO {
        println!("  {}{}{}", fg_color(ar, ag, ab), line, RESET);
    }

    println!(
        "  {}{}klaas{} {}v{}{} {}~ Remote access for Claude Code{}",
        BOLD,
        fg_color(ar, ag, ab),
        RESET,
        fg_color(tr, tg, tb),
        env!("CARGO_PKG_VERSION"),
        RESET,
        fg_color(tr, tg, tb),
        RESET
    );
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
pub fn display_offline_warning(error: &str) {
    let (yr, yg, yb) = colors::AMBER;
    let (mr, mg, mb) = colors::TEXT_MUTED;

    println!();
    println!(
        "  {}{}!{} Unable to connect to Klaas server.{}",
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
    println!("    {}Error: {}{}", fg_color(mr, mg, mb), error, RESET);
    println!();
}

/// Returns the animation frame interval for smooth animation.
pub fn animation_interval() -> Duration {
    Duration::from_millis(80)
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
        let anim = WaitingAnimation::new();
        assert_eq!(anim.frame, 0);
        assert_eq!(anim.shimmer_pos, -(SHIMMER_WIDTH as isize));
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
