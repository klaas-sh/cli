//! Build script for klaas CLI.
//!
//! This script sets API URLs at compile time:
//! - Release builds: hardcoded production URLs (api.klaas.sh)
//! - Debug builds: reads from .env file if present, otherwise localhost

use std::env;
use std::fs;
use std::path::Path;

/// Production API URL.
const PROD_API_URL: &str = "https://api.klaas.sh";

/// Production WebSocket URL.
const PROD_WS_URL: &str = "wss://api.klaas.sh/ws";

/// Default development API URL.
const DEV_API_URL: &str = "http://localhost:8787";

/// Default development WebSocket URL.
const DEV_WS_URL: &str = "ws://localhost:8787/ws";

fn main() {
    // Tell Cargo to rerun this script if .env changes
    println!("cargo::rerun-if-changed=.env");
    println!("cargo::rerun-if-env-changed=PROFILE");

    let profile = env::var("PROFILE").unwrap_or_default();
    let is_release = profile == "release";

    let (api_url, ws_url) = if is_release {
        // Release builds always use production URLs
        (PROD_API_URL.to_string(), PROD_WS_URL.to_string())
    } else {
        // Debug builds: try to read from .env file
        let (env_api, env_ws) = read_dotenv();

        let api_url = env_api.unwrap_or_else(|| DEV_API_URL.to_string());
        let ws_url = env_ws.unwrap_or_else(|| derive_ws_url(&api_url));

        (api_url, ws_url)
    };

    // Set compile-time environment variables
    println!("cargo::rustc-env=KLAAS_API_URL={}", api_url);
    println!("cargo::rustc-env=KLAAS_WS_URL={}", ws_url);
}

/// Reads KLAAS_API_URL and KLAAS_WS_URL from .env file if it exists.
fn read_dotenv() -> (Option<String>, Option<String>) {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
    let dotenv_path = Path::new(&manifest_dir).join(".env");

    if !dotenv_path.exists() {
        return (None, None);
    }

    let contents = match fs::read_to_string(&dotenv_path) {
        Ok(c) => c,
        Err(_) => return (None, None),
    };

    let mut api_url = None;
    let mut ws_url = None;

    for line in contents.lines() {
        let line = line.trim();

        // Skip comments and empty lines
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        // Parse KEY=VALUE
        if let Some((key, value)) = line.split_once('=') {
            let key = key.trim();
            let value = value.trim();

            match key {
                "KLAAS_API_URL" => api_url = Some(value.to_string()),
                "KLAAS_WS_URL" => ws_url = Some(value.to_string()),
                _ => {}
            }
        }
    }

    (api_url, ws_url)
}

/// Derives WebSocket URL from API URL.
fn derive_ws_url(api_url: &str) -> String {
    let ws_base = if api_url.starts_with("https://") {
        api_url.replacen("https://", "wss://", 1)
    } else if api_url.starts_with("http://") {
        api_url.replacen("http://", "ws://", 1)
    } else {
        format!("wss://{}", api_url)
    };

    let ws_base = ws_base.trim_end_matches('/');
    format!("{}/ws", ws_base)
}
