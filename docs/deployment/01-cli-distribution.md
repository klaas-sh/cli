# klaas CLI Distribution Guide

Technical implementation guide for multi-platform distribution of klaas, a Rust-based CLI wrapper for Claude Code.

## Overview

This document covers the complete setup for distributing klaas across:

| Platform | Distribution Method | Auto-Update |
|----------|---------------------|-------------|
| macOS | Homebrew tap, curl installer | Yes (installer) |
| Linux | apt/dnf repos, curl installer | Yes (installer) |
| Windows | Winget, Scoop, PowerShell installer | Yes (installer) |

---

## 1. Rust Cross-Compilation Setup

### 1.1 Cargo.toml Configuration

Ensure your `Cargo.toml` has proper metadata for distribution:

```toml
[package]
name = "klaas"
version = "0.1.0"
edition = "2021"
description = "CLI wrapper for Claude Code"
license = "MIT"
repository = "https://github.com/klaas-sh/cli"
homepage = "https://klaas.sh"
readme = "README.md"

[profile.release]
opt-level = "z"     # Optimize for size
lto = true          # Link-time optimization
codegen-units = 1   # Better optimization
panic = "abort"     # Smaller binary
strip = true        # Strip symbols
```

### 1.2 Target Platforms

Add these targets for cross-compilation:

```bash
# macOS
rustup target add x86_64-apple-darwin
rustup target add aarch64-apple-darwin

# Linux
rustup target add x86_64-unknown-linux-gnu
rustup target add aarch64-unknown-linux-gnu
rustup target add x86_64-unknown-linux-musl  # Static linking

# Windows
rustup target add x86_64-pc-windows-msvc
rustup target add aarch64-pc-windows-msvc
```

---

## 2. GitHub Actions Release Workflow

### 2.1 Main Release Workflow

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

env:
  CARGO_TERM_COLOR: always
  BINARY_NAME: klaas

jobs:
  create-release:
    runs-on: ubuntu-latest
    outputs:
      upload_url: ${{ steps.create_release.outputs.upload_url }}
      version: ${{ steps.get_version.outputs.version }}
    steps:
      - name: Get version from tag
        id: get_version
        run: echo "version=${GITHUB_REF#refs/tags/v}" >> $GITHUB_OUTPUT

      - name: Create Release
        id: create_release
        uses: actions/create-release@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tag_name: ${{ github.ref }}
          release_name: klaas v${{ steps.get_version.outputs.version }}
          draft: false
          prerelease: false

  build:
    needs: create-release
    strategy:
      fail-fast: false
      matrix:
        include:
          # macOS
          - os: macos-latest
            target: x86_64-apple-darwin
            artifact_name: klaas-x86_64-apple-darwin.tar.gz
          - os: macos-latest
            target: aarch64-apple-darwin
            artifact_name: klaas-aarch64-apple-darwin.tar.gz
          
          # Linux
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
            artifact_name: klaas-x86_64-unknown-linux-gnu.tar.gz
          - os: ubuntu-latest
            target: aarch64-unknown-linux-gnu
            artifact_name: klaas-aarch64-unknown-linux-gnu.tar.gz
          - os: ubuntu-latest
            target: x86_64-unknown-linux-musl
            artifact_name: klaas-x86_64-unknown-linux-musl.tar.gz
          
          # Windows
          - os: windows-latest
            target: x86_64-pc-windows-msvc
            artifact_name: klaas-x86_64-pc-windows-msvc.zip
          - os: windows-latest
            target: aarch64-pc-windows-msvc
            artifact_name: klaas-aarch64-pc-windows-msvc.zip

    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - name: Install Rust toolchain
        uses: dtolnay/rust-action@stable
        with:
          targets: ${{ matrix.target }}

      - name: Install cross-compilation tools (Linux ARM)
        if: matrix.target == 'aarch64-unknown-linux-gnu'
        run: |
          sudo apt-get update
          sudo apt-get install -y gcc-aarch64-linux-gnu

      - name: Install musl tools
        if: matrix.target == 'x86_64-unknown-linux-musl'
        run: |
          sudo apt-get update
          sudo apt-get install -y musl-tools

      - name: Build
        run: cargo build --release --target ${{ matrix.target }}
        env:
          CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER: aarch64-linux-gnu-gcc

      - name: Package (Unix)
        if: runner.os != 'Windows'
        run: |
          cd target/${{ matrix.target }}/release
          tar czvf ../../../${{ matrix.artifact_name }} ${{ env.BINARY_NAME }}
          cd ../../..
          shasum -a 256 ${{ matrix.artifact_name }} > ${{ matrix.artifact_name }}.sha256

      - name: Package (Windows)
        if: runner.os == 'Windows'
        shell: pwsh
        run: |
          cd target/${{ matrix.target }}/release
          Compress-Archive -Path ${{ env.BINARY_NAME }}.exe -DestinationPath ../../../${{ matrix.artifact_name }}
          cd ../../..
          (Get-FileHash ${{ matrix.artifact_name }} -Algorithm SHA256).Hash.ToLower() + "  " + "${{ matrix.artifact_name }}" | Out-File -Encoding utf8 ${{ matrix.artifact_name }}.sha256

      - name: Upload Release Asset
        uses: actions/upload-release-asset@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          upload_url: ${{ needs.create-release.outputs.upload_url }}
          asset_path: ./${{ matrix.artifact_name }}
          asset_name: ${{ matrix.artifact_name }}
          asset_content_type: application/octet-stream

      - name: Upload Checksum
        uses: actions/upload-release-asset@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          upload_url: ${{ needs.create-release.outputs.upload_url }}
          asset_path: ./${{ matrix.artifact_name }}.sha256
          asset_name: ${{ matrix.artifact_name }}.sha256
          asset_content_type: text/plain

  # macOS code signing (optional but recommended)
  sign-macos:
    needs: [create-release, build]
    runs-on: macos-latest
    if: false  # Enable when you have Apple Developer certificates
    steps:
      - name: Download artifacts
        # Sign and notarize macOS binaries
        # Requires APPLE_CERTIFICATE, APPLE_CERTIFICATE_PASSWORD, 
        # APPLE_ID, APPLE_TEAM_ID secrets
        run: echo "Implement code signing"

  # Update package managers
  update-homebrew:
    needs: [create-release, build]
    runs-on: ubuntu-latest
    steps:
      - name: Update Homebrew tap
        uses: mislav/bump-homebrew-formula-action@v3
        with:
          formula-name: klaas
          homebrew-tap: klaas-sh/homebrew-tap
          download-url: https://github.com/klaas-sh/cli/releases/download/v${{ needs.create-release.outputs.version }}/klaas-x86_64-apple-darwin.tar.gz
        env:
          COMMITTER_TOKEN: ${{ secrets.HOMEBREW_TAP_TOKEN }}

  update-scoop:
    needs: [create-release, build]
    runs-on: ubuntu-latest
    steps:
      - name: Checkout scoop bucket
        uses: actions/checkout@v4
        with:
          repository: klaas-sh/scoop-bucket
          token: ${{ secrets.SCOOP_BUCKET_TOKEN }}
          path: scoop-bucket

      - name: Update manifest
        run: |
          VERSION=${{ needs.create-release.outputs.version }}
          cat > scoop-bucket/klaas.json << EOF
          {
            "version": "${VERSION}",
            "description": "CLI wrapper for Claude Code",
            "homepage": "https://klaas.sh",
            "license": "MIT",
            "architecture": {
              "64bit": {
                "url": "https://github.com/klaas-sh/cli/releases/download/v${VERSION}/klaas-x86_64-pc-windows-msvc.zip",
                "hash": "$(curl -sL https://github.com/klaas-sh/cli/releases/download/v${VERSION}/klaas-x86_64-pc-windows-msvc.zip.sha256 | cut -d' ' -f1)"
              },
              "arm64": {
                "url": "https://github.com/klaas-sh/cli/releases/download/v${VERSION}/klaas-aarch64-pc-windows-msvc.zip",
                "hash": "$(curl -sL https://github.com/klaas-sh/cli/releases/download/v${VERSION}/klaas-aarch64-pc-windows-msvc.zip.sha256 | cut -d' ' -f1)"
              }
            },
            "bin": "klaas.exe",
            "checkver": "github",
            "autoupdate": {
              "architecture": {
                "64bit": {
                  "url": "https://github.com/klaas-sh/cli/releases/download/v\$version/klaas-x86_64-pc-windows-msvc.zip"
                },
                "arm64": {
                  "url": "https://github.com/klaas-sh/cli/releases/download/v\$version/klaas-aarch64-pc-windows-msvc.zip"
                }
              }
            }
          }
          EOF

      - name: Commit and push
        run: |
          cd scoop-bucket
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add klaas.json
          git commit -m "Update klaas to v${{ needs.create-release.outputs.version }}"
          git push

  update-installers:
    needs: [create-release, build]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Update installer scripts with new version
        run: |
          VERSION=${{ needs.create-release.outputs.version }}
          sed -i "s/VERSION=.*/VERSION=\"${VERSION}\"/" scripts/install.sh
          sed -i "s/\$Version = .*/\$Version = \"${VERSION}\"/" scripts/install.ps1

      - name: Deploy to klaas.sh
        # Deploy updated installer scripts to your hosting
        # This could be GitHub Pages, Cloudflare Pages, S3, etc.
        run: |
          echo "Deploy install.sh and install.ps1 to klaas.sh"
          # Example: aws s3 cp scripts/install.sh s3://klaas.sh/install.sh
          # Example: wrangler pages deploy scripts/ --project-name=klaas
```

---

## 3. Homebrew Tap Setup

### 3.1 Create the Tap Repository

Create a new repository: `klaas-sh/homebrew-tap`

Structure:
```
homebrew-klaas/
├── Formula/
│   └── klaas.rb
└── README.md
```

### 3.2 Formula Template

Create `Formula/klaas.rb`:

```ruby
class Klaas < Formula
  desc "CLI wrapper for Claude Code"
  homepage "https://klaas.sh"
  version "0.1.0"
  license "MIT"

  on_macos do
    on_intel do
      url "https://github.com/klaas-sh/cli/releases/download/v#{version}/klaas-x86_64-apple-darwin.tar.gz"
      sha256 "REPLACE_WITH_ACTUAL_SHA256"
    end

    on_arm do
      url "https://github.com/klaas-sh/cli/releases/download/v#{version}/klaas-aarch64-apple-darwin.tar.gz"
      sha256 "REPLACE_WITH_ACTUAL_SHA256"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/klaas-sh/cli/releases/download/v#{version}/klaas-x86_64-unknown-linux-gnu.tar.gz"
      sha256 "REPLACE_WITH_ACTUAL_SHA256"
    end

    on_arm do
      url "https://github.com/klaas-sh/cli/releases/download/v#{version}/klaas-aarch64-unknown-linux-gnu.tar.gz"
      sha256 "REPLACE_WITH_ACTUAL_SHA256"
    end
  end

  def install
    bin.install "klaas"
  end

  test do
    assert_match "klaas", shell_output("#{bin}/klaas --version")
  end
end
```

### 3.3 User Installation

```bash
brew tap klaas-sh/cli
brew install klaas
```

---

## 4. Installer Scripts

### 4.1 Unix Installer (`install.sh`)

Create `scripts/install.sh` and host at `https://klaas.sh/install.sh`:

```bash
#!/bin/bash
set -euo pipefail

VERSION="0.1.0"
INSTALL_DIR="${KLAAS_INSTALL_DIR:-$HOME/.local/bin}"
REPO="klaas-sh/cli"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}info${NC}: $1"; }
warn() { echo -e "${YELLOW}warn${NC}: $1"; }
error() { echo -e "${RED}error${NC}: $1"; exit 1; }

# Detect OS and architecture
detect_platform() {
    local os arch

    case "$(uname -s)" in
        Linux*)  os="unknown-linux-gnu" ;;
        Darwin*) os="apple-darwin" ;;
        *)       error "Unsupported operating system: $(uname -s)" ;;
    esac

    case "$(uname -m)" in
        x86_64|amd64)  arch="x86_64" ;;
        arm64|aarch64) arch="aarch64" ;;
        *)             error "Unsupported architecture: $(uname -m)" ;;
    esac

    echo "${arch}-${os}"
}

# Download and verify binary
download_binary() {
    local platform="$1"
    local url="https://github.com/${REPO}/releases/download/v${VERSION}/klaas-${platform}.tar.gz"
    local checksum_url="${url}.sha256"
    local tmp_dir

    tmp_dir=$(mktemp -d)
    trap "rm -rf $tmp_dir" EXIT

    info "Downloading klaas v${VERSION} for ${platform}..."
    
    if command -v curl &> /dev/null; then
        curl -fsSL "$url" -o "$tmp_dir/klaas.tar.gz"
        curl -fsSL "$checksum_url" -o "$tmp_dir/klaas.tar.gz.sha256"
    elif command -v wget &> /dev/null; then
        wget -q "$url" -O "$tmp_dir/klaas.tar.gz"
        wget -q "$checksum_url" -O "$tmp_dir/klaas.tar.gz.sha256"
    else
        error "Neither curl nor wget found. Please install one of them."
    fi

    # Verify checksum
    info "Verifying checksum..."
    cd "$tmp_dir"
    if command -v sha256sum &> /dev/null; then
        sha256sum -c klaas.tar.gz.sha256 || error "Checksum verification failed"
    elif command -v shasum &> /dev/null; then
        shasum -a 256 -c klaas.tar.gz.sha256 || error "Checksum verification failed"
    else
        warn "No checksum tool found, skipping verification"
    fi

    # Extract and install
    tar xzf klaas.tar.gz
    mkdir -p "$INSTALL_DIR"
    mv klaas "$INSTALL_DIR/"
    chmod +x "$INSTALL_DIR/klaas"
}

# Add to PATH if needed
setup_path() {
    local shell_config=""
    
    case "$SHELL" in
        */zsh)  shell_config="$HOME/.zshrc" ;;
        */bash) shell_config="$HOME/.bashrc" ;;
        */fish) shell_config="$HOME/.config/fish/config.fish" ;;
    esac

    if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
        warn "$INSTALL_DIR is not in your PATH"
        
        if [[ -n "$shell_config" ]]; then
            echo "" >> "$shell_config"
            echo "# klaas" >> "$shell_config"
            
            if [[ "$SHELL" == */fish ]]; then
                echo "set -gx PATH \$PATH $INSTALL_DIR" >> "$shell_config"
            else
                echo "export PATH=\"\$PATH:$INSTALL_DIR\"" >> "$shell_config"
            fi
            
            info "Added $INSTALL_DIR to PATH in $shell_config"
            info "Run 'source $shell_config' or restart your terminal"
        else
            info "Add the following to your shell config:"
            echo "  export PATH=\"\$PATH:$INSTALL_DIR\""
        fi
    fi
}

main() {
    info "Installing klaas..."
    
    local platform
    platform=$(detect_platform)
    
    download_binary "$platform"
    setup_path
    
    info "klaas v${VERSION} installed successfully!"
    info "Run 'klaas --help' to get started"
}

main "$@"
```

### 4.2 Windows Installer (`install.ps1`)

Create `scripts/install.ps1` and host at `https://klaas.sh/install.ps1`:

```powershell
#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$Version = "0.1.0"
$Repo = "klaas-sh/cli"
$InstallDir = if ($env:KLAAS_INSTALL_DIR) { $env:KLAAS_INSTALL_DIR } else { "$env:LOCALAPPDATA\klaas\bin" }

function Write-Info { param($msg) Write-Host "info: " -ForegroundColor Green -NoNewline; Write-Host $msg }
function Write-Warn { param($msg) Write-Host "warn: " -ForegroundColor Yellow -NoNewline; Write-Host $msg }
function Write-Err { param($msg) Write-Host "error: " -ForegroundColor Red -NoNewline; Write-Host $msg; exit 1 }

function Get-Platform {
    $arch = if ([Environment]::Is64BitOperatingSystem) {
        if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "aarch64" } else { "x86_64" }
    } else {
        Write-Err "32-bit Windows is not supported"
    }
    return "$arch-pc-windows-msvc"
}

function Install-Klaas {
    $platform = Get-Platform
    $url = "https://github.com/$Repo/releases/download/v$Version/klaas-$platform.zip"
    $checksumUrl = "$url.sha256"
    
    $tmpDir = New-Item -ItemType Directory -Path (Join-Path $env:TEMP ([System.IO.Path]::GetRandomFileName()))
    
    try {
        Write-Info "Downloading klaas v$Version for $platform..."
        
        $zipPath = Join-Path $tmpDir "klaas.zip"
        $checksumPath = Join-Path $tmpDir "klaas.zip.sha256"
        
        Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
        Invoke-WebRequest -Uri $checksumUrl -OutFile $checksumPath -UseBasicParsing
        
        # Verify checksum
        Write-Info "Verifying checksum..."
        $expectedHash = (Get-Content $checksumPath).Split()[0].ToUpper()
        $actualHash = (Get-FileHash $zipPath -Algorithm SHA256).Hash
        
        if ($expectedHash -ne $actualHash) {
            Write-Err "Checksum verification failed"
        }
        
        # Extract and install
        Write-Info "Installing to $InstallDir..."
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        Expand-Archive -Path $zipPath -DestinationPath $InstallDir -Force
        
    } finally {
        Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
    }
}

function Add-ToPath {
    $currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    
    if ($currentPath -notlike "*$InstallDir*") {
        Write-Info "Adding $InstallDir to PATH..."
        [Environment]::SetEnvironmentVariable("PATH", "$currentPath;$InstallDir", "User")
        $env:PATH = "$env:PATH;$InstallDir"
        Write-Info "PATH updated. Restart your terminal for changes to take effect."
    }
}

Write-Info "Installing klaas..."
Install-Klaas
Add-ToPath
Write-Info "klaas v$Version installed successfully!"
Write-Info "Run 'klaas --help' to get started"
```

---

## 5. Scoop Bucket Setup

### 5.1 Create Bucket Repository

Create repository: `klaas-sh/scoop-bucket`

Structure:
```
scoop-klaas/
├── bucket/
│   └── klaas.json
└── README.md
```

### 5.2 Manifest (`bucket/klaas.json`)

```json
{
    "version": "0.1.0",
    "description": "CLI wrapper for Claude Code",
    "homepage": "https://klaas.sh",
    "license": "MIT",
    "architecture": {
        "64bit": {
            "url": "https://github.com/klaas-sh/cli/releases/download/v0.1.0/klaas-x86_64-pc-windows-msvc.zip",
            "hash": "REPLACE_WITH_SHA256"
        },
        "arm64": {
            "url": "https://github.com/klaas-sh/cli/releases/download/v0.1.0/klaas-aarch64-pc-windows-msvc.zip",
            "hash": "REPLACE_WITH_SHA256"
        }
    },
    "bin": "klaas.exe",
    "checkver": "github",
    "autoupdate": {
        "architecture": {
            "64bit": {
                "url": "https://github.com/klaas-sh/cli/releases/download/v$version/klaas-x86_64-pc-windows-msvc.zip"
            },
            "arm64": {
                "url": "https://github.com/klaas-sh/cli/releases/download/v$version/klaas-aarch64-pc-windows-msvc.zip"
            }
        }
    }
}
```

### 5.3 User Installation

```powershell
scoop bucket add klaas https://github.com/klaas-sh/scoop-bucket
scoop install klaas
```

---

## 6. WinGet Submission

### 6.1 Create Manifest

WinGet requires submitting to microsoft/winget-pkgs repository via PR.

Create manifest structure:
```
manifests/y/klaas-sh/cli/0.1.0/
├── klaas-sh.klaas.installer.yaml
├── klaas-sh.klaas.locale.en-US.yaml
└── klaas-sh.klaas.yaml
```

### 6.2 Main Manifest (`klaas-sh.klaas.yaml`)

```yaml
PackageIdentifier: klaas-sh.klaas
PackageVersion: 0.1.0
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.6.0
```

### 6.3 Installer Manifest (`klaas-sh.klaas.installer.yaml`)

```yaml
PackageIdentifier: klaas-sh.klaas
PackageVersion: 0.1.0
Platform:
  - Windows.Desktop
MinimumOSVersion: 10.0.17763.0
InstallerType: zip
NestedInstallerType: portable
NestedInstallerFiles:
  - RelativeFilePath: klaas.exe
    PortableCommandAlias: klaas
Installers:
  - Architecture: x64
    InstallerUrl: https://github.com/klaas-sh/cli/releases/download/v0.1.0/klaas-x86_64-pc-windows-msvc.zip
    InstallerSha256: REPLACE_WITH_SHA256
  - Architecture: arm64
    InstallerUrl: https://github.com/klaas-sh/cli/releases/download/v0.1.0/klaas-aarch64-pc-windows-msvc.zip
    InstallerSha256: REPLACE_WITH_SHA256
ManifestType: installer
ManifestVersion: 1.6.0
```

### 6.4 Locale Manifest (`klaas-sh.klaas.locale.en-US.yaml`)

```yaml
PackageIdentifier: klaas-sh.klaas
PackageVersion: 0.1.0
PackageLocale: en-US
Publisher: Your Organization
PackageName: klaas
License: MIT
ShortDescription: CLI wrapper for Claude Code
PackageUrl: https://klaas.sh
ManifestType: defaultLocale
ManifestVersion: 1.6.0
```

### 6.5 Automated WinGet Updates

Add to your release workflow:

```yaml
  update-winget:
    needs: [create-release, build]
    runs-on: windows-latest
    steps:
      - name: Install wingetcreate
        run: |
          iwr https://aka.ms/wingetcreate/latest -OutFile wingetcreate.exe

      - name: Update WinGet manifest
        run: |
          $version = "${{ needs.create-release.outputs.version }}"
          $x64Url = "https://github.com/klaas-sh/cli/releases/download/v${version}/klaas-x86_64-pc-windows-msvc.zip"
          $arm64Url = "https://github.com/klaas-sh/cli/releases/download/v${version}/klaas-aarch64-pc-windows-msvc.zip"
          
          .\wingetcreate.exe update klaas-sh.klaas `
            --version $version `
            --urls $x64Url $arm64Url `
            --submit `
            --token ${{ secrets.WINGET_PAT }}
```

---

## 7. Linux Package Repositories (Optional)

### 7.1 APT Repository Setup

For Debian/Ubuntu users, you can host an APT repository.

**Option A: Use GitHub Releases + Cloudsmith/Packagecloud**

Services like Cloudsmith or Packagecloud handle the repository hosting:

```yaml
  publish-apt:
    needs: [create-release, build]
    runs-on: ubuntu-latest
    steps:
      - name: Download Linux binary
        run: |
          curl -LO "https://github.com/klaas-sh/cli/releases/download/v${{ needs.create-release.outputs.version }}/klaas-x86_64-unknown-linux-gnu.tar.gz"
          tar xzf klaas-x86_64-unknown-linux-gnu.tar.gz

      - name: Create .deb package
        run: |
          VERSION=${{ needs.create-release.outputs.version }}
          mkdir -p pkg/DEBIAN pkg/usr/local/bin
          cp klaas pkg/usr/local/bin/
          
          cat > pkg/DEBIAN/control << EOF
          Package: klaas
          Version: ${VERSION}
          Section: utils
          Priority: optional
          Architecture: amd64
          Maintainer: Your Name <you@example.com>
          Description: CLI wrapper for Claude Code
          EOF
          
          dpkg-deb --build pkg klaas_${VERSION}_amd64.deb

      - name: Upload to Packagecloud
        uses: danielmundi/upload-packagecloud@v1
        with:
          package-name: klaas_${{ needs.create-release.outputs.version }}_amd64.deb
          packagecloud-username: klaas-sh
          packagecloud-repo: klaas
          packagecloud-distrib: ubuntu/jammy
          packagecloud-token: ${{ secrets.PACKAGECLOUD_TOKEN }}
```

**Option B: Self-hosted with GitHub Pages**

More complex but gives full control. Requires setting up GPG signing and repository structure.

---

## 8. Required GitHub Secrets

Add these secrets to your repository:

| Secret | Purpose |
|--------|---------|
| `HOMEBREW_TAP_TOKEN` | PAT with repo access to klaas-sh/homebrew-tap |
| `SCOOP_BUCKET_TOKEN` | PAT with repo access to klaas-sh/scoop-bucket |
| `WINGET_PAT` | PAT for winget-pkgs PRs (requires microsoft/winget-pkgs write access) |
| `PACKAGECLOUD_TOKEN` | (Optional) For APT repository hosting |
| `APPLE_CERTIFICATE` | (Optional) For macOS code signing |
| `APPLE_CERTIFICATE_PASSWORD` | (Optional) For macOS code signing |
| `APPLE_ID` | (Optional) For macOS notarization |
| `APPLE_TEAM_ID` | (Optional) For macOS notarization |

---

## 9. Release Checklist

When releasing a new version:

1. **Update version** in `Cargo.toml`
2. **Update CHANGELOG.md**
3. **Create and push tag:**
   ```bash
   git tag -a v0.1.0 -m "Release v0.1.0"
   git push origin v0.1.0
   ```
4. **GitHub Actions automatically:**
    - Builds binaries for all platforms
    - Creates GitHub Release with assets
    - Updates Homebrew formula
    - Updates Scoop manifest
    - Submits WinGet PR
    - Deploys updated installer scripts

---

## 10. User Installation Summary

After setup, users can install klaas via:

**macOS/Linux (recommended):**
```bash
curl -fsSL https://klaas.sh/install.sh | bash
```

**macOS (Homebrew):**
```bash
brew tap klaas-sh/cli
brew install klaas
```

**Windows (recommended):**
```powershell
irm https://klaas.sh/install.ps1 | iex
```

**Windows (Scoop):**
```powershell
scoop bucket add klaas https://github.com/klaas-sh/scoop-bucket
scoop install klaas
```

**Windows (WinGet):**
```powershell
winget install klaas-sh.klaas
```

---

## Alternative: cargo-dist

For a simpler setup, consider [cargo-dist](https://opensource.axo.dev/cargo-dist/) which automates much of this:

```bash
cargo install cargo-dist
cargo dist init
```

This generates GitHub Actions workflows with Homebrew, npm (for npx wrapper), and installer scripts built-in. Trade-off: less customization but faster setup.