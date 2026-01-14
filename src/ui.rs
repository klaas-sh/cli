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
/// Selected for visual similarity to create smooth transitions.
const STAR_FRAMES: &[char] = &['✦', '✧', '✶', '✷', '✸', '✹', '✺', '✧', '✦'];

/// Shimmer color sequence for the "Waiting for authorization" text.
/// Creates a wave effect from dim to bright to dim.
const SHIMMER_COLORS: &[(u8, u8, u8)] = &[
    colors::TEXT_DIM,
    colors::TEXT_MUTED,
    colors::TEXT_SECONDARY,
    colors::AMBER_DARK,
    colors::AMBER,
    colors::AMBER_LIGHT,
    colors::AMBER_LIGHTER,
    colors::AMBER_LIGHT,
    colors::AMBER,
    colors::AMBER_DARK,
    colors::TEXT_SECONDARY,
    colors::TEXT_MUTED,
    colors::TEXT_DIM,
];

/// Generates ANSI escape code for 24-bit true color foreground.
fn fg_color(r: u8, g: u8, b: u8) -> String {
    format!("\x1b[38;2;{};{};{}m", r, g, b)
}

/// ANSI reset code.
const RESET: &str = "\x1b[0m";

/// Bold ANSI code.
const BOLD: &str = "\x1b[1m";

/// Animation state for the waiting spinner.
pub struct WaitingAnimation {
    frame: usize,
    shimmer_offset: usize,
}

impl WaitingAnimation {
    /// Creates a new waiting animation.
    pub fn new() -> Self {
        Self {
            frame: 0,
            shimmer_offset: 0,
        }
    }

    /// Renders a single frame of the "Waiting for authorization" animation.
    ///
    /// The star character cycles through different symbols, and the text
    /// has a shimmer effect that flows through the characters.
    pub fn render_frame(&mut self) {
        let star = STAR_FRAMES[self.frame % STAR_FRAMES.len()];
        let text = "Waiting for authorisation...";

        // Build the animated text with shimmer effect
        let mut output = String::new();

        // Animated star in amber
        let (r, g, b) = colors::AMBER_LIGHT;
        output.push_str(&format!(
            "\r  {}{}{}{} ",
            BOLD,
            fg_color(r, g, b),
            star,
            RESET
        ));

        // Shimmer effect on the text
        for (i, ch) in text.chars().enumerate() {
            let color_idx = (i + self.shimmer_offset) % SHIMMER_COLORS.len();
            let (r, g, b) = SHIMMER_COLORS[color_idx];
            output.push_str(&fg_color(r, g, b));
            output.push(ch);
        }
        output.push_str(RESET);

        print!("{}", output);
        let _ = io::stdout().flush();

        // Advance animation
        self.frame = (self.frame + 1) % STAR_FRAMES.len();
        self.shimmer_offset = (self.shimmer_offset + 1) % SHIMMER_COLORS.len();
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

/// Displays the klaas startup banner.
///
/// Shows a minimal, elegant header with the klaas branding.
pub fn display_startup_banner() {
    let (ar, ag, ab) = colors::AMBER;
    let (tr, tg, tb) = colors::TEXT_SECONDARY;

    println!();
    println!(
        "  {}{}klaas{} {}v{}{}",
        BOLD,
        fg_color(ar, ag, ab),
        RESET,
        fg_color(tr, tg, tb),
        env!("CARGO_PKG_VERSION"),
        RESET
    );
    println!(
        "  {}Remote access for Claude Code{}",
        fg_color(tr, tg, tb),
        RESET
    );
    println!();
}

/// Displays auth instructions with branded styling.
pub fn display_auth_instructions(
    verification_uri: &str,
    user_code: &str,
    verification_uri_complete: Option<&str>,
    expires_in_minutes: u64,
) {
    let (ar, ag, ab) = colors::AMBER;
    let (al, alg, alb) = colors::AMBER_LIGHT;
    let (tr, tg, tb) = colors::TEXT_SECONDARY;
    let (mr, mg, mb) = colors::TEXT_MUTED;

    println!();

    if let Some(complete_uri) = verification_uri_complete {
        println!(
            "  {}To connect this device, visit:{}",
            fg_color(tr, tg, tb),
            RESET
        );
        println!();
        println!(
            "    {}{}{}{}",
            BOLD,
            fg_color(al, alg, alb),
            complete_uri,
            RESET
        );
        println!();
        println!(
            "  {}The code {}{}{}{} will be pre-filled.{}",
            fg_color(tr, tg, tb),
            BOLD,
            fg_color(ar, ag, ab),
            user_code,
            RESET,
            RESET
        );
    } else {
        println!(
            "  {}To connect this device, visit:{}",
            fg_color(tr, tg, tb),
            RESET
        );
        println!();
        println!(
            "    {}{}{}{}",
            BOLD,
            fg_color(al, alg, alb),
            verification_uri,
            RESET
        );
        println!();
        println!("  {}And enter the code:{}", fg_color(tr, tg, tb), RESET);
        println!();
        println!("    {}{}{}{}", BOLD, fg_color(ar, ag, ab), user_code, RESET);
    }

    println!();
    println!(
        "  {}This code expires in {} minutes.{}",
        fg_color(mr, mg, mb),
        expires_in_minutes,
        RESET
    );
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
        assert_eq!(anim.shimmer_offset, 0);
    }

    #[test]
    fn test_star_frames_not_empty() {
        assert!(!STAR_FRAMES.is_empty());
    }

    #[test]
    fn test_shimmer_colors_not_empty() {
        assert!(!SHIMMER_COLORS.is_empty());
    }
}
