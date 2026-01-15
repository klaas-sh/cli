#!/bin/bash
#
# Klaas CLI Installation Script
#
# Usage:
#   curl -fsSL https://klaas.sh/install.sh | bash
#
# This script downloads and installs the klaas CLI binary.
# Supported platforms: macOS (arm64, x64), Linux (arm64, x64, musl)
#

set -e

# Configuration
GITHUB_REPO="klaas-sh/cli"
BINARY_NAME="klaas"
INSTALL_DIR="${KLAAS_INSTALL_DIR:-/usr/local/bin}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
GRAY='\033[0;90m'
AMBER='\033[38;5;214m'
NC='\033[0m'

info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
  echo -e "${RED}[ERROR]${NC} $1" >&2
  exit 1
}

# Detect OS
detect_os() {
  local os
  os="$(uname -s)"
  case "$os" in
    Darwin) echo "darwin" ;;
    Linux) echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*)
      error "Use PowerShell installer: irm https://klaas.sh/install.ps1 | iex"
      ;;
    *) error "Unsupported operating system: $os" ;;
  esac
}

# Detect architecture
detect_arch() {
  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) echo "x64" ;;
    aarch64|arm64) echo "arm64" ;;
    *) error "Unsupported architecture: $arch" ;;
  esac
}

# Detect if running on musl (Alpine Linux, etc.)
detect_musl() {
  if [ -f /lib/libc.musl-x86_64.so.1 ] || \
     [ -f /lib/libc.musl-aarch64.so.1 ] || \
     [ -f /lib/ld-musl-x86_64.so.1 ] || \
     [ -f /lib/ld-musl-aarch64.so.1 ] || \
     (command -v ldd &> /dev/null && ldd /bin/ls 2>&1 | grep -q musl); then
    echo "true"
  else
    echo "false"
  fi
}

# Download to stdout or file
download() {
  local url="$1"
  local output="$2"

  if command -v curl &> /dev/null; then
    if [ -n "$output" ]; then
      curl -fsSL "$url" -o "$output"
    else
      curl -fsSL "$url"
    fi
  elif command -v wget &> /dev/null; then
    if [ -n "$output" ]; then
      wget -q "$url" -O "$output"
    else
      wget -q "$url" -O -
    fi
  else
    error "Neither curl nor wget found. Please install one of them."
  fi
}

# Get the latest release version from GitHub
get_latest_version() {
  local version
  version=$(download "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" | \
    grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')

  if [ -z "$version" ]; then
    error "Failed to get latest version from GitHub"
  fi
  echo "$version"
}

# Extract checksum from manifest.json using pure bash (no jq dependency)
get_checksum_from_manifest() {
  local manifest="$1"
  local platform="$2"

  # Normalize JSON to single line
  manifest=$(echo "$manifest" | tr -d '\n\r\t' | sed 's/ \+/ /g')

  # Extract checksum for platform using bash regex
  if [[ $manifest =~ \"$platform\"[^}]*\"checksum\"[[:space:]]*:[[:space:]]*\"([a-f0-9]{64})\" ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi

  return 1
}

# Main installation
main() {
  echo ""
  echo -e "${AMBER}  ╭────────╮${NC}"
  echo -e "${AMBER}  ├────────┤${NC}"
  echo -e "${AMBER}  │ ❯ __   │${NC}"
  echo -e "${AMBER}  ╰────────╯${NC}"
  echo ""
  echo -e "  ${YELLOW}klaas${NC} ${GRAY}~ Remote access for Claude Code${NC}"
  echo ""

  # Detect platform
  local os arch is_musl platform
  os=$(detect_os)
  arch=$(detect_arch)

  # Check for musl on Linux
  if [ "$os" = "linux" ]; then
    is_musl=$(detect_musl)
    if [ "$is_musl" = "true" ]; then
      platform="${os}-${arch}-musl"
    else
      platform="${os}-${arch}"
    fi
  else
    platform="${os}-${arch}"
  fi

  info "Detected platform: $platform"

  # Get latest version
  info "Fetching latest version..."
  local version
  version=$(get_latest_version)
  info "Latest version: $version"

  # Download manifest.json
  info "Downloading manifest..."
  local manifest_url="https://github.com/${GITHUB_REPO}/releases/download/${version}/manifest.json"
  local manifest
  manifest=$(download "$manifest_url")

  if [ -z "$manifest" ]; then
    error "Failed to download manifest.json"
  fi

  # Extract checksum from manifest
  local checksum
  checksum=$(get_checksum_from_manifest "$manifest" "$platform")

  if [ -z "$checksum" ] || [[ ! "$checksum" =~ ^[a-f0-9]{64}$ ]]; then
    error "Platform $platform not found in manifest"
  fi

  # Build download URL
  local asset_name="klaas-${platform}.tar.gz"
  local download_url="https://github.com/${GITHUB_REPO}/releases/download/${version}/${asset_name}"

  info "Downloading ${asset_name}..."

  # Create temp directory
  local tmp_dir
  tmp_dir=$(mktemp -d)
  trap "rm -rf '$tmp_dir'" EXIT

  # Download archive
  if ! download "$download_url" "${tmp_dir}/${asset_name}"; then
    error "Download failed"
  fi

  # Verify checksum
  info "Verifying checksum..."
  local actual_checksum
  if command -v sha256sum &> /dev/null; then
    actual_checksum=$(sha256sum "${tmp_dir}/${asset_name}" | cut -d' ' -f1)
  elif command -v shasum &> /dev/null; then
    actual_checksum=$(shasum -a 256 "${tmp_dir}/${asset_name}" | cut -d' ' -f1)
  else
    warn "No checksum tool found, skipping verification"
    actual_checksum="$checksum"  # Skip verification
  fi

  if [ "$actual_checksum" != "$checksum" ]; then
    error "Checksum verification failed"
  fi
  info "Checksum verified"

  # Extract
  info "Extracting..."
  tar -xzf "${tmp_dir}/${asset_name}" -C "$tmp_dir"

  # Check if we need sudo
  local use_sudo=""
  if [ ! -w "$INSTALL_DIR" ]; then
    if command -v sudo &> /dev/null; then
      use_sudo="sudo"
      warn "Installation requires sudo privileges"
    else
      error "Cannot write to $INSTALL_DIR and sudo is not available"
    fi
  fi

  # Install
  info "Installing to ${INSTALL_DIR}/${BINARY_NAME}..."
  $use_sudo mkdir -p "$INSTALL_DIR"
  $use_sudo mv "${tmp_dir}/${BINARY_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
  $use_sudo chmod +x "${INSTALL_DIR}/${BINARY_NAME}"

  success "klaas ${version} installed successfully!"
  echo ""
  echo "Run 'klaas' to get started."
  echo ""

  # Check if install dir is in PATH
  if ! echo "$PATH" | grep -q "$INSTALL_DIR"; then
    warn "$INSTALL_DIR is not in your PATH"
    echo "Add the following to your shell configuration:"
    echo ""
    echo "  export PATH=\"\$PATH:$INSTALL_DIR\""
    echo ""
  fi
}

main "$@"
