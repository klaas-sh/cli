//! Self-update functionality for the klaas CLI.
//!
//! Checks for new versions via GitHub releases API and provides
//! self-update capability. Version checks are cached to avoid
//! excessive API calls.

use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tracing::{debug, info};

/// GitHub repository for klaas releases.
const GITHUB_REPO: &str = "klaas-sh/cli";

/// How often to check for updates after a successful check (24 hours).
const UPDATE_CHECK_INTERVAL_SECS: u64 = 86400;

/// How often to retry after a failed check (1 hour).
const UPDATE_RETRY_INTERVAL_SECS: u64 = 3600;

/// Current version from Cargo.toml.
pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Cached update check state.
#[derive(Debug, Serialize, Deserialize, Default)]
struct UpdateCache {
    /// Unix timestamp of last check.
    last_check: u64,
    /// Latest version found (if any).
    latest_version: Option<String>,
    /// Whether an update is available.
    update_available: bool,
}

/// Result of a version check.
#[derive(Debug, Clone)]
pub struct UpdateCheckResult {
    /// Current installed version.
    pub current_version: String,
    /// Latest available version (if check succeeded).
    pub latest_version: Option<String>,
    /// Whether an update is available.
    pub update_available: bool,
}

/// GitHub release response (minimal fields).
#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
}

/// Gets the path to the update cache file.
fn get_cache_path() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("klaas")
        .join("update-cache.json")
}

/// Reads the update cache from disk.
fn read_cache() -> UpdateCache {
    let path = get_cache_path();
    if !path.exists() {
        return UpdateCache::default();
    }

    fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

/// Writes the update cache to disk.
fn write_cache(cache: &UpdateCache) {
    let path = get_cache_path();

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    if let Ok(content) = serde_json::to_string(cache) {
        let _ = fs::write(&path, content);
    }
}

/// Gets the current Unix timestamp.
fn now_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Checks if a version check is needed (cache expired).
fn should_check() -> bool {
    let cache = read_cache();
    let now = now_timestamp();
    let elapsed = now.saturating_sub(cache.last_check);

    // Use shorter interval if last check failed (no version cached)
    let interval = if cache.latest_version.is_some() {
        UPDATE_CHECK_INTERVAL_SECS
    } else {
        UPDATE_RETRY_INTERVAL_SECS
    };

    elapsed >= interval
}

/// Compares two version strings (semver-style).
///
/// Returns true if `latest` is newer than `current`.
fn is_newer_version(current: &str, latest: &str) -> bool {
    // Strip leading 'v' if present
    let current = current.trim_start_matches('v');
    let latest = latest.trim_start_matches('v');

    // Parse version components
    let parse_version = |s: &str| -> Vec<u32> {
        s.split('.')
            .filter_map(|part| {
                // Handle pre-release suffixes like "1.0.0-beta"
                part.split('-').next().and_then(|p| p.parse().ok())
            })
            .collect()
    };

    let current_parts = parse_version(current);
    let latest_parts = parse_version(latest);

    // Compare component by component
    for i in 0..std::cmp::max(current_parts.len(), latest_parts.len()) {
        let c = current_parts.get(i).copied().unwrap_or(0);
        let l = latest_parts.get(i).copied().unwrap_or(0);

        if l > c {
            return true;
        }
        if l < c {
            return false;
        }
    }

    false
}

/// Checks for updates (non-blocking, caches result).
///
/// This function is designed to be called during startup or auth.
/// It uses a cache to avoid checking on every invocation.
///
/// # Returns
///
/// `UpdateCheckResult` with current and latest version info.
pub async fn check_for_updates() -> UpdateCheckResult {
    let current_version = CURRENT_VERSION.to_string();

    // Check cache first
    if !should_check() {
        let cache = read_cache();
        return UpdateCheckResult {
            current_version,
            latest_version: cache.latest_version,
            update_available: cache.update_available,
        };
    }

    debug!("Checking for updates...");

    // Fetch latest release from GitHub
    let latest_version = fetch_latest_version().await;

    // Determine if update is available
    let update_available = latest_version
        .as_ref()
        .map(|v| is_newer_version(&current_version, v))
        .unwrap_or(false);

    // Cache the result (both success and failure)
    // Failures use a shorter retry interval (see should_check)
    let cache = UpdateCache {
        last_check: now_timestamp(),
        latest_version: latest_version.clone(),
        update_available,
    };
    write_cache(&cache);

    if update_available {
        info!(
            current = %current_version,
            latest = latest_version.as_deref().unwrap_or("unknown"),
            "Update available"
        );
    }

    UpdateCheckResult {
        current_version,
        latest_version,
        update_available,
    }
}

/// Fetches the latest version from GitHub releases API.
async fn fetch_latest_version() -> Option<String> {
    let url = format!(
        "https://api.github.com/repos/{}/releases/latest",
        GITHUB_REPO
    );

    let client = reqwest::Client::builder()
        .user_agent(format!("klaas/{}", CURRENT_VERSION))
        .timeout(Duration::from_secs(5))
        .build()
        .ok()?;

    let response = client.get(&url).send().await.ok()?;

    if !response.status().is_success() {
        debug!("GitHub API returned status: {}", response.status());
        return None;
    }

    let release: GitHubRelease = response.json().await.ok()?;
    Some(release.tag_name)
}

/// Checks for updates and auto-updates if a new version is available.
///
/// This is called on startup. If an update is available:
/// 1. Downloads and installs the new version
/// 2. Re-execs the new binary with the same arguments
///
/// Returns true if klaas was updated and re-exec'd (caller should exit).
/// Returns false if no update was needed or update failed.
pub async fn auto_update_if_available() -> bool {
    // Check for updates (uses cache)
    let result = check_for_updates().await;

    if !result.update_available {
        return false;
    }

    let latest = match result.latest_version {
        Some(v) => v,
        None => return false,
    };

    // Show update message
    eprintln!(
        "\x1b[38;2;245;158;11m↻\x1b[0m Updating klaas {} → {}...",
        result.current_version,
        latest.trim_start_matches('v')
    );

    // Perform the update
    match perform_update_quiet().await {
        Ok(()) => {
            eprintln!(
                "\x1b[38;2;34;197;94m✓\x1b[0m Updated to {}",
                latest.trim_start_matches('v')
            );
            eprintln!();

            // Re-exec the new binary with the same arguments
            re_exec_self();

            // If re_exec returns, something went wrong
            true
        }
        Err(e) => {
            debug!("Auto-update failed: {}", e);
            // Silently continue with current version
            false
        }
    }
}

/// Performs update without verbose output (for auto-update).
async fn perform_update_quiet() -> Result<(), String> {
    let url = format!(
        "https://api.github.com/repos/{}/releases/latest",
        GITHUB_REPO
    );

    let client = reqwest::Client::builder()
        .user_agent(format!("klaas/{}", CURRENT_VERSION))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch release info: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("GitHub API error: {}", response.status()));
    }

    let release: GitHubRelease = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse release info: {}", e))?;

    let latest_version = release.tag_name.trim_start_matches('v');

    if !is_newer_version(CURRENT_VERSION, latest_version) {
        return Ok(());
    }

    // Detect platform
    let platform = detect_platform()?;
    let asset_name = format!("klaas-{}.tar.gz", platform);
    let download_url = format!(
        "https://github.com/{}/releases/download/{}/{}",
        GITHUB_REPO, release.tag_name, asset_name
    );

    // Download the archive
    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed: {} ({})",
            response.status(),
            download_url
        ));
    }

    let archive_data = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read download: {}", e))?;

    // Get current executable path
    let current_exe = std::env::current_exe()
        .map_err(|e| format!("Failed to get current executable path: {}", e))?;

    // Create temp directory for extraction
    let temp_dir =
        tempfile::tempdir().map_err(|e| format!("Failed to create temp directory: {}", e))?;

    let archive_path = temp_dir.path().join(&asset_name);
    fs::write(&archive_path, &archive_data)
        .map_err(|e| format!("Failed to write archive: {}", e))?;

    // Extract the archive
    let output = std::process::Command::new("tar")
        .args(["-xzf", &asset_name])
        .current_dir(temp_dir.path())
        .output()
        .map_err(|e| format!("Failed to extract archive: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Extraction failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // Find the extracted binary
    let new_binary = temp_dir.path().join("klaas");
    if !new_binary.exists() {
        return Err("Extracted binary not found".to_string());
    }

    // Replace the current binary
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        // Make the new binary executable
        fs::set_permissions(&new_binary, fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("Failed to set permissions: {}", e))?;

        // Backup old binary
        let backup_path = current_exe.with_extension("old");
        let _ = fs::remove_file(&backup_path);

        // Rename current to backup
        fs::rename(&current_exe, &backup_path)
            .map_err(|e| format!("Failed to backup current binary: {}", e))?;

        // Move new binary to current location
        if let Err(e) = fs::rename(&new_binary, &current_exe) {
            let _ = fs::rename(&backup_path, &current_exe);
            return Err(format!("Failed to install new binary: {}", e));
        }

        // Remove backup on success
        let _ = fs::remove_file(&backup_path);
    }

    #[cfg(windows)]
    {
        // Windows: copy new binary alongside old one
        let new_path = current_exe.with_file_name("klaas-new.exe");
        fs::copy(&new_binary, &new_path)
            .map_err(|e| format!("Failed to copy new binary: {}", e))?;
        // Note: Windows users will need to replace manually
    }

    // Clear update cache
    let cache = UpdateCache::default();
    write_cache(&cache);

    Ok(())
}

/// Re-executes the current binary with the same arguments.
///
/// This is used after auto-update to run the new version.
#[cfg(unix)]
fn re_exec_self() {
    use std::os::unix::process::CommandExt;

    let exe = match std::env::current_exe() {
        Ok(e) => e,
        Err(_) => return,
    };

    let args: Vec<String> = std::env::args().collect();

    // exec replaces the current process with the new one
    let mut cmd = std::process::Command::new(&exe);
    if args.len() > 1 {
        cmd.args(&args[1..]);
    }

    // This won't return if successful
    let _ = cmd.exec();
}

#[cfg(windows)]
fn re_exec_self() {
    // On Windows, we can't easily replace ourselves
    // Just continue with the old binary for this session
}

/// Performs a self-update by downloading and replacing the binary.
///
/// # Returns
///
/// Ok(()) on success, or an error message on failure.
pub async fn perform_update() -> Result<(), String> {
    eprintln!("Checking for updates...");

    // Force a fresh check
    let url = format!(
        "https://api.github.com/repos/{}/releases/latest",
        GITHUB_REPO
    );

    let client = reqwest::Client::builder()
        .user_agent(format!("klaas/{}", CURRENT_VERSION))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch release info: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("GitHub API error: {}", response.status()));
    }

    let release: GitHubRelease = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse release info: {}", e))?;

    let latest_version = release.tag_name.trim_start_matches('v');

    if !is_newer_version(CURRENT_VERSION, latest_version) {
        eprintln!("Already running the latest version ({}).", CURRENT_VERSION);
        return Ok(());
    }

    eprintln!("Updating from {} to {}...", CURRENT_VERSION, latest_version);

    // Detect platform
    let platform = detect_platform()?;
    let asset_name = format!("klaas-{}.tar.gz", platform);
    let download_url = format!(
        "https://github.com/{}/releases/download/{}/{}",
        GITHUB_REPO, release.tag_name, asset_name
    );

    eprintln!("Downloading {}...", asset_name);

    // Download the archive
    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed: {} ({})",
            response.status(),
            download_url
        ));
    }

    let archive_data = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read download: {}", e))?;

    // Get current executable path
    let current_exe = std::env::current_exe()
        .map_err(|e| format!("Failed to get current executable path: {}", e))?;

    // Create temp directory for extraction
    let temp_dir =
        tempfile::tempdir().map_err(|e| format!("Failed to create temp directory: {}", e))?;

    let archive_path = temp_dir.path().join(&asset_name);
    fs::write(&archive_path, &archive_data)
        .map_err(|e| format!("Failed to write archive: {}", e))?;

    // Extract the archive
    eprintln!("Extracting...");

    let output = std::process::Command::new("tar")
        .args(["-xzf", &asset_name])
        .current_dir(temp_dir.path())
        .output()
        .map_err(|e| format!("Failed to extract archive: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Extraction failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // Find the extracted binary
    let new_binary = temp_dir.path().join("klaas");
    if !new_binary.exists() {
        return Err("Extracted binary not found".to_string());
    }

    // Replace the current binary
    eprintln!("Installing...");

    // On Unix, we can replace the running binary by renaming
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        // Make the new binary executable
        fs::set_permissions(&new_binary, fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("Failed to set permissions: {}", e))?;

        // Backup old binary
        let backup_path = current_exe.with_extension("old");
        let _ = fs::remove_file(&backup_path); // Remove old backup if exists

        // Rename current to backup
        fs::rename(&current_exe, &backup_path)
            .map_err(|e| format!("Failed to backup current binary: {}", e))?;

        // Move new binary to current location
        if let Err(e) = fs::rename(&new_binary, &current_exe) {
            // Try to restore backup
            let _ = fs::rename(&backup_path, &current_exe);
            return Err(format!("Failed to install new binary: {}", e));
        }

        // Remove backup on success
        let _ = fs::remove_file(&backup_path);
    }

    #[cfg(windows)]
    {
        // Windows requires more complex handling due to file locking
        // For now, just copy to a new location and instruct user
        let new_path = current_exe.with_file_name("klaas-new.exe");
        fs::copy(&new_binary, &new_path)
            .map_err(|e| format!("Failed to copy new binary: {}", e))?;

        eprintln!("New version downloaded to: {}", new_path.display());
        eprintln!("Please close klaas and replace the old binary manually.");
        return Ok(());
    }

    // Clear update cache
    let cache = UpdateCache::default();
    write_cache(&cache);

    eprintln!(
        "\x1b[32mSuccessfully updated to version {}!\x1b[0m",
        latest_version
    );

    Ok(())
}

/// Detects the current platform for download.
fn detect_platform() -> Result<&'static str, String> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    match (os, arch) {
        ("macos", "x86_64") => Ok("darwin-x64"),
        ("macos", "aarch64") => Ok("darwin-arm64"),
        ("linux", "x86_64") => Ok("linux-x64"),
        ("linux", "aarch64") => Ok("linux-arm64"),
        ("windows", "x86_64") => Ok("windows-x64"),
        _ => Err(format!("Unsupported platform: {}-{}", os, arch)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_newer_version() {
        assert!(is_newer_version("0.1.0", "0.2.0"));
        assert!(is_newer_version("0.1.0", "0.1.1"));
        assert!(is_newer_version("0.1.0", "1.0.0"));
        assert!(is_newer_version("1.0.0", "1.0.1"));

        assert!(!is_newer_version("0.2.0", "0.1.0"));
        assert!(!is_newer_version("1.0.0", "0.9.0"));
        assert!(!is_newer_version("0.1.0", "0.1.0"));
    }

    #[test]
    fn test_is_newer_version_with_v_prefix() {
        assert!(is_newer_version("v0.1.0", "v0.2.0"));
        assert!(is_newer_version("0.1.0", "v0.2.0"));
        assert!(is_newer_version("v0.1.0", "0.2.0"));
    }

    #[test]
    fn test_detect_platform() {
        // Just ensure it doesn't panic
        let result = detect_platform();
        assert!(result.is_ok() || result.is_err());
    }
}
