//! Billing error types and user-facing rendering for feature-gate denials.
//!
//! The klaas API returns HTTP 402/403 responses with a JSON body of the
//! form
//!
//! ```text
//! {
//!   "code": "feature_gate" | "trial_expired",
//!   "feature_id": "sessions.limit",
//!   "upgrade_url": "https://klaas.sh/settings/billing",
//!   "message": "You have reached the free-plan session limit.",
//!   "mode": "over_limit",
//!   "limit": 1,
//!   "current_usage": 1
//! }
//! ```
//!
//! This module parses those bodies into a structured [`BillingError`] and
//! formats them for display in the CLI using the amber accent from
//! `crate::ui::colors`.
//!
//! Both REST (`reqwest`) and WebSocket (`tokio-tungstenite`) error paths
//! funnel through [`BillingError::from_json`] so the rendered output is
//! identical regardless of transport.

use serde::Deserialize;

use crate::ui::colors;

/// Structured representation of a feature-gate / trial-expired denial.
///
/// Construct via [`BillingError::from_json`] and render via [`Display`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BillingError {
    /// Error code: `"feature_gate"` or `"trial_expired"`.
    pub code: String,
    /// Feature identifier (e.g. `"sessions.limit"`), if provided.
    pub feature_id: Option<String>,
    /// Fully-qualified upgrade URL. Relative URLs from the API are
    /// normalised against the API host before storage here.
    pub upgrade_url: Option<String>,
    /// Human-readable message for the user.
    pub message: String,
}

/// Wire shape of the billing error body. Matches the API types exactly.
#[derive(Debug, Clone, Deserialize)]
struct BillingErrorBody {
    code: String,
    #[serde(default)]
    feature_id: Option<String>,
    #[serde(default)]
    upgrade_url: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

impl BillingError {
    /// Attempts to parse `body` as a billing-error JSON payload.
    ///
    /// Returns `None` if the body is not JSON, lacks a `code` field, or
    /// carries a `code` outside the billing set. The caller is expected
    /// to treat a `None` return as an ordinary (non-billing) error.
    ///
    /// # Arguments
    /// * `body` - Raw response body (usually UTF-8 JSON).
    /// * `api_base_url` - Base URL used to resolve relative upgrade URLs
    ///   such as `/settings/billing`. Pass the CLI's configured API host;
    ///   the WebSocket upgrade path uses the same origin.
    pub fn from_json(body: &str, api_base_url: &str) -> Option<Self> {
        let parsed: BillingErrorBody = serde_json::from_str(body).ok()?;

        match parsed.code.as_str() {
            "feature_gate" | "trial_expired" => {}
            _ => return None,
        }

        let upgrade_url = parsed
            .upgrade_url
            .as_deref()
            .map(|u| normalize_upgrade_url(u, api_base_url));

        let message = parsed.message.unwrap_or_else(|| match parsed.code.as_str() {
            "trial_expired" => "Your trial has expired.".to_string(),
            _ => "This feature is not available on your current plan.".to_string(),
        });

        Some(Self {
            code: parsed.code,
            feature_id: parsed.feature_id,
            upgrade_url,
            message,
        })
    }

    /// Writes the error to stderr with amber accent colours. Intended
    /// for top-level error sites (command handlers, `main.rs`).
    pub fn render(&self) {
        eprintln!();
        eprintln!("{}", self);
        eprintln!();
    }
}

/// Resolves a possibly-relative `upgrade_url` against `api_base_url`.
///
/// - Absolute URLs (starting with `http://` or `https://`) are returned
///   unchanged.
/// - Relative paths (starting with `/`) are joined onto the scheme and
///   authority of `api_base_url`.
/// - Bare relative strings are returned as-is — the API is expected to
///   always send an absolute URL or a root-relative path, so this branch
///   exists only as a last-resort fallback.
///
/// # Examples
///
/// ```ignore
/// assert_eq!(
///     normalize_upgrade_url("/settings/billing", "https://api.klaas.sh"),
///     "https://api.klaas.sh/settings/billing",
/// );
/// assert_eq!(
///     normalize_upgrade_url("https://klaas.sh/u", "https://api.klaas.sh"),
///     "https://klaas.sh/u",
/// );
/// ```
pub fn normalize_upgrade_url(upgrade_url: &str, api_base_url: &str) -> String {
    if upgrade_url.starts_with("http://") || upgrade_url.starts_with("https://") {
        return upgrade_url.to_string();
    }

    if let Some(path) = upgrade_url.strip_prefix('/') {
        let origin = origin_of(api_base_url).unwrap_or_else(|| api_base_url.to_string());
        let trimmed = origin.trim_end_matches('/');
        return format!("{}/{}", trimmed, path);
    }

    upgrade_url.to_string()
}

/// Extracts the `scheme://host[:port]` origin from `url`, discarding any
/// path, query, or fragment. Returns `None` if parsing fails.
fn origin_of(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://")?;
    let authority_end = rest
        .find(|c: char| c == '/' || c == '?' || c == '#')
        .unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    if authority.is_empty() {
        return None;
    }
    Some(format!("{}://{}", scheme, authority))
}

impl std::fmt::Display for BillingError {
    /// Renders a two-line user-facing prompt with amber accents.
    ///
    /// Line 1: `⚠  Upgrade required: <message>`
    /// Line 2: `   Upgrade at: <upgrade_url>` (omitted when no URL).
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let (ar, ag, ab) = colors::AMBER;
        let (sr, sg, sb) = colors::TEXT_SECONDARY;
        let amber = format!("\x1b[38;2;{};{};{}m", ar, ag, ab);
        let secondary = format!("\x1b[38;2;{};{};{}m", sr, sg, sb);
        let bold = "\x1b[1m";
        let reset = "\x1b[0m";

        let heading = match self.code.as_str() {
            "trial_expired" => "Trial expired",
            _ => "Upgrade required",
        };

        write!(
            f,
            "  {bold}{amber}⚠{reset}  {bold}{amber}{heading}{reset}{secondary}: {msg}{reset}",
            bold = bold,
            amber = amber,
            heading = heading,
            secondary = secondary,
            msg = self.message,
            reset = reset,
        )?;

        if let Some(url) = &self.upgrade_url {
            write!(
                f,
                "\n     {secondary}Upgrade at: {amber}{url}{reset}",
                secondary = secondary,
                amber = amber,
                url = url,
                reset = reset,
            )?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const API_URL: &str = "https://api.klaas.sh";

    #[test]
    fn test_parse_feature_gate_absolute_url() {
        let body = r#"{
            "code": "feature_gate",
            "feature_id": "sessions.limit",
            "upgrade_url": "https://klaas.sh/settings/billing",
            "message": "Session limit reached.",
            "mode": "over_limit",
            "limit": 1,
            "current_usage": 1
        }"#;

        let err = BillingError::from_json(body, API_URL).unwrap();
        assert_eq!(err.code, "feature_gate");
        assert_eq!(err.feature_id.as_deref(), Some("sessions.limit"));
        assert_eq!(
            err.upgrade_url.as_deref(),
            Some("https://klaas.sh/settings/billing")
        );
        assert_eq!(err.message, "Session limit reached.");
    }

    #[test]
    fn test_parse_relative_upgrade_url_is_normalised() {
        let body = r#"{
            "code": "feature_gate",
            "feature_id": "sessions.concurrent_connections",
            "upgrade_url": "/settings/billing",
            "message": "Concurrent connection limit reached."
        }"#;

        let err = BillingError::from_json(body, "https://api.klaas.sh/").unwrap();
        assert_eq!(
            err.upgrade_url.as_deref(),
            Some("https://api.klaas.sh/settings/billing")
        );
    }

    #[test]
    fn test_parse_trial_expired() {
        let body = r#"{
            "code": "trial_expired",
            "upgrade_url": "https://klaas.sh/settings/billing",
            "message": "Your trial has ended."
        }"#;

        let err = BillingError::from_json(body, API_URL).unwrap();
        assert_eq!(err.code, "trial_expired");
        assert_eq!(err.message, "Your trial has ended.");
    }

    #[test]
    fn test_parse_unknown_code_returns_none() {
        let body = r#"{"code":"UNAUTHORIZED","message":"nope"}"#;
        assert!(BillingError::from_json(body, API_URL).is_none());
    }

    #[test]
    fn test_parse_non_json_returns_none() {
        assert!(BillingError::from_json("not json", API_URL).is_none());
        assert!(BillingError::from_json("", API_URL).is_none());
    }

    #[test]
    fn test_parse_missing_message_falls_back() {
        let body = r#"{"code":"feature_gate","upgrade_url":"/x"}"#;
        let err = BillingError::from_json(body, API_URL).unwrap();
        assert!(err.message.contains("not available"));

        let body = r#"{"code":"trial_expired"}"#;
        let err = BillingError::from_json(body, API_URL).unwrap();
        assert!(err.message.to_lowercase().contains("trial"));
    }

    #[test]
    fn test_normalize_absolute_url_unchanged() {
        assert_eq!(
            normalize_upgrade_url("https://klaas.sh/u", API_URL),
            "https://klaas.sh/u"
        );
        assert_eq!(
            normalize_upgrade_url("http://localhost:3000/x", API_URL),
            "http://localhost:3000/x"
        );
    }

    #[test]
    fn test_normalize_relative_url_prepends_origin() {
        assert_eq!(
            normalize_upgrade_url("/settings/billing", "https://api.klaas.sh"),
            "https://api.klaas.sh/settings/billing"
        );
        // Trailing slash on base is handled.
        assert_eq!(
            normalize_upgrade_url("/settings/billing", "https://api.klaas.sh/"),
            "https://api.klaas.sh/settings/billing"
        );
        // API base with a path strips the path before joining.
        assert_eq!(
            normalize_upgrade_url("/settings/billing", "https://api.klaas.sh/v1"),
            "https://api.klaas.sh/settings/billing"
        );
    }

    #[test]
    fn test_normalize_bare_relative_passthrough() {
        // Intentionally not prefixed with '/' — returned unchanged as a
        // last resort.
        assert_eq!(
            normalize_upgrade_url("settings/billing", API_URL),
            "settings/billing"
        );
    }

    #[test]
    fn test_origin_of_basic() {
        assert_eq!(
            origin_of("https://api.klaas.sh/v1/foo"),
            Some("https://api.klaas.sh".to_string())
        );
        assert_eq!(
            origin_of("http://localhost:8787"),
            Some("http://localhost:8787".to_string())
        );
        assert_eq!(origin_of("not a url"), None);
    }

    #[test]
    fn test_display_includes_message_and_url() {
        let err = BillingError {
            code: "feature_gate".to_string(),
            feature_id: Some("sessions.limit".to_string()),
            upgrade_url: Some("https://klaas.sh/settings/billing".to_string()),
            message: "Session limit reached.".to_string(),
        };
        let rendered = format!("{}", err);
        assert!(rendered.contains("Upgrade required"));
        assert!(rendered.contains("Session limit reached."));
        assert!(rendered.contains("https://klaas.sh/settings/billing"));
        // ANSI escape sequences are present.
        assert!(rendered.contains("\x1b["));
    }

    #[test]
    fn test_display_trial_expired_heading() {
        let err = BillingError {
            code: "trial_expired".to_string(),
            feature_id: None,
            upgrade_url: None,
            message: "Trial ended.".to_string(),
        };
        let rendered = format!("{}", err);
        assert!(rendered.contains("Trial expired"));
        assert!(rendered.contains("Trial ended."));
        // No upgrade-url line when URL is missing.
        assert!(!rendered.contains("Upgrade at:"));
    }
}
