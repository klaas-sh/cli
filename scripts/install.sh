#!/bin/bash
#
# Klaas CLI Installation Script
#
# Usage:
#   curl -fsSL https://klaas.sh/install.sh | bash
#
# This script downloads and installs the klaas CLI binary.
# Supported platforms: macOS (arm64, x64), Linux (arm64, x64)
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
NC='\033[0m' # No Color

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
    MINGW*|MSYS*|CYGWIN*) error "Windows is not supported by this installer. Please download the binary manually from GitHub releases." ;;
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

# Get the latest release version from GitHub
get_latest_version() {
  local version
  if command -v curl &> /dev/null; then
    version=$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" | \
      grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
  elif command -v wget &> /dev/null; then
    version=$(wget -qO- "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" | \
      grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
  else
    error "Neither curl nor wget found. Please install one of them."
  fi

  if [ -z "$version" ]; then
    error "Failed to get latest version from GitHub"
  fi
  echo "$version"
}

# Download a file
download() {
  local url="$1"
  local output="$2"

  if command -v curl &> /dev/null; then
    curl -fsSL "$url" -o "$output"
  elif command -v wget &> /dev/null; then
    wget -q "$url" -O "$output"
  else
    error "Neither curl nor wget found. Please install one of them."
  fi
}

# Main installation
main() {
  echo ""
  echo "  _    _                "
  echo " | | _| | __ _  __ _ ___"
  echo " | |/ / |/ _\` |/ _\` / __|"
  echo " |   <| | (_| | (_| \\__ \\"
  echo " |_|\\_\\_|\\__,_|\\__,_|___/"
  echo ""
  echo " Remote access for Claude Code"
  echo ""

  # Detect platform
  local os arch platform
  os=$(detect_os)
  arch=$(detect_arch)
  platform="${os}-${arch}"

  info "Detected platform: $platform"

  # Get latest version
  info "Fetching latest version..."
  local version
  version=$(get_latest_version)
  info "Latest version: $version"

  # Build download URL
  local asset_name="klaas-${platform}.tar.gz"
  local download_url="https://github.com/${GITHUB_REPO}/releases/download/${version}/${asset_name}"

  info "Downloading ${asset_name}..."

  # Create temp directory
  local tmp_dir
  tmp_dir=$(mktemp -d)
  trap "rm -rf '$tmp_dir'" EXIT

  # Download archive
  download "$download_url" "${tmp_dir}/${asset_name}"

  # Download and verify checksum
  local checksum_url="${download_url}.sha256"
  if download "$checksum_url" "${tmp_dir}/${asset_name}.sha256" 2>/dev/null; then
    info "Verifying checksum..."
    cd "$tmp_dir"
    if command -v sha256sum &> /dev/null; then
      if sha256sum -c "${asset_name}.sha256" > /dev/null 2>&1; then
        info "Checksum verified"
      else
        error "Checksum verification failed"
      fi
    elif command -v shasum &> /dev/null; then
      if shasum -a 256 -c "${asset_name}.sha256" > /dev/null 2>&1; then
        info "Checksum verified"
      else
        error "Checksum verification failed"
      fi
    else
      warn "No checksum tool found, skipping verification"
    fi
    cd - > /dev/null
  else
    warn "Checksum file not available, skipping verification"
  fi

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
