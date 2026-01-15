# Third-Party Setup Guide

Manual setup required for external services before CLI distribution works fully.

## Overview

| Service | Purpose | Required? | Effort |
|---------|---------|-----------|--------|
| GitHub Releases | Binary hosting | Yes (done) | Already configured |
| Homebrew Tap | macOS/Linux package manager | Recommended | ~15 min |
| Scoop Bucket | Windows package manager | Recommended | ~15 min |
| WinGet | Windows Store package manager | Optional | ~30 min + review wait |
| Apple Developer | macOS code signing | Optional | $99/year + setup |

---

## 1. GitHub Repository Settings

### Required Secrets

Go to **GitHub → Repository → Settings → Secrets and variables → Actions**

These should already be configured for API/Dashboard deployment:

| Secret | Required For |
|--------|--------------|
| `CLOUDFLARE_API_TOKEN` | API/Dashboard (not CLI) |
| `CLOUDFLARE_ACCOUNT_ID` | API/Dashboard (not CLI) |

CLI releases use `GITHUB_TOKEN` which is automatic.

### Additional Secrets (for package managers)

| Secret | Required For | How to Create |
|--------|--------------|---------------|
| `HOMEBREW_TAP_TOKEN` | Auto-updating Homebrew formula | GitHub PAT with `repo` scope |
| `SCOOP_BUCKET_TOKEN` | Auto-updating Scoop manifest | GitHub PAT with `repo` scope |
| `WINGET_PAT` | WinGet submissions | GitHub PAT (see WinGet section) |

---

## 2. Homebrew Tap Setup

Homebrew is the standard package manager for macOS and popular on Linux.

### Step 1: Create the Tap Repository

1. Go to GitHub and create a new repository: `klaas-sh/homebrew-tap`
2. Make it public
3. Add a README.md:

```markdown
# Homebrew Tap for klaas

## Installation

```bash
brew tap klaas-sh/cli
brew install klaas
```

## Update

```bash
brew update
brew upgrade klaas
```
```

### Step 2: Create the Formula

Create `Formula/klaas.rb` in the tap repository:

```ruby
class Klaas < Formula
  desc "Remote access wrapper for Claude Code"
  homepage "https://klaas.sh"
  version "0.1.0"
  license "MIT"

  on_macos do
    on_intel do
      url "https://github.com/klaas-sh/cli/releases/download/v#{version}/klaas-darwin-x64.tar.gz"
      sha256 "REPLACE_AFTER_FIRST_RELEASE"
    end

    on_arm do
      url "https://github.com/klaas-sh/cli/releases/download/v#{version}/klaas-darwin-arm64.tar.gz"
      sha256 "REPLACE_AFTER_FIRST_RELEASE"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/klaas-sh/cli/releases/download/v#{version}/klaas-linux-x64.tar.gz"
      sha256 "REPLACE_AFTER_FIRST_RELEASE"
    end

    on_arm do
      url "https://github.com/klaas-sh/cli/releases/download/v#{version}/klaas-linux-arm64.tar.gz"
      sha256 "REPLACE_AFTER_FIRST_RELEASE"
    end
  end

  def install
    bin.install "klaas"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/klaas --version")
  end
end
```

### Step 3: Create GitHub PAT for Automation

1. Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Generate new token with `repo` scope
3. Add as `HOMEBREW_TAP_TOKEN` secret in the klaas repository

### Step 4: Manual Update Process (Until Automation)

After each release, update the formula:

```bash
# Get SHA256 for each platform
curl -sL https://github.com/klaas-sh/cli/releases/download/v0.1.0/klaas-darwin-x64.tar.gz | shasum -a 256
curl -sL https://github.com/klaas-sh/cli/releases/download/v0.1.0/klaas-darwin-arm64.tar.gz | shasum -a 256
curl -sL https://github.com/klaas-sh/cli/releases/download/v0.1.0/klaas-linux-x64.tar.gz | shasum -a 256
curl -sL https://github.com/klaas-sh/cli/releases/download/v0.1.0/klaas-linux-arm64.tar.gz | shasum -a 256
```

Update the formula with new version and SHA256 values, commit, and push.

---

## 3. Scoop Bucket Setup

Scoop is a popular command-line installer for Windows.

### Step 1: Create the Bucket Repository

1. Create a new GitHub repository: `klaas-sh/scoop-bucket`
2. Make it public
3. Add a README.md:

```markdown
# Scoop Bucket for klaas

## Installation

```powershell
scoop bucket add klaas https://github.com/klaas-sh/scoop-bucket
scoop install klaas
```

## Update

```powershell
scoop update klaas
```
```

### Step 2: Create the Manifest

Create `bucket/klaas.json`:

```json
{
    "version": "0.1.0",
    "description": "Remote access wrapper for Claude Code",
    "homepage": "https://klaas.sh",
    "license": "MIT",
    "architecture": {
        "64bit": {
            "url": "https://github.com/klaas-sh/cli/releases/download/v0.1.0/klaas-windows-x64.exe.zip",
            "hash": "REPLACE_AFTER_FIRST_RELEASE"
        }
    },
    "bin": "klaas.exe",
    "checkver": "github",
    "autoupdate": {
        "architecture": {
            "64bit": {
                "url": "https://github.com/klaas-sh/cli/releases/download/v$version/klaas-windows-x64.exe.zip"
            }
        }
    }
}
```

### Step 3: Create GitHub PAT

Same process as Homebrew - create a PAT with `repo` scope and add as `SCOOP_BUCKET_TOKEN`.

---

## 4. WinGet Setup (Optional)

WinGet is Microsoft's official Windows package manager. Submissions require PR review.

### Step 1: Fork winget-pkgs

1. Fork `microsoft/winget-pkgs` on GitHub
2. This is where you'll submit manifest PRs

### Step 2: Create Manifests

Create directory structure in your fork:
```
manifests/s/klaas-sh/cli/0.1.0/
├── klaas-sh.klaas.installer.yaml
├── klaas-sh.klaas.locale.en-US.yaml
└── klaas-sh.klaas.yaml
```

**klaas-sh.klaas.yaml:**
```yaml
PackageIdentifier: klaas-sh.klaas
PackageVersion: 0.1.0
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.6.0
```

**klaas-sh.klaas.installer.yaml:**
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
    InstallerUrl: https://github.com/klaas-sh/cli/releases/download/v0.1.0/klaas-windows-x64.exe.zip
    InstallerSha256: REPLACE_WITH_SHA256
ManifestType: installer
ManifestVersion: 1.6.0
```

**klaas-sh.klaas.locale.en-US.yaml:**
```yaml
PackageIdentifier: klaas-sh.klaas
PackageVersion: 0.1.0
PackageLocale: en-US
Publisher: klaas-sh
PackageName: klaas
License: MIT
ShortDescription: Remote access wrapper for Claude Code
PackageUrl: https://klaas.sh
ManifestType: defaultLocale
ManifestVersion: 1.6.0
```

### Step 3: Submit PR

1. Commit manifests to your fork
2. Create PR to `microsoft/winget-pkgs`
3. Wait for automated validation and human review (can take days/weeks)

### Step 4: Create PAT for Automation (Optional)

For automated updates using `wingetcreate`:
1. Create PAT with `public_repo` scope
2. Add as `WINGET_PAT` secret

---

## 5. Apple Developer Setup (Optional)

Code signing prevents macOS Gatekeeper warnings. Requires paid Apple Developer account.

### Requirements

- Apple Developer Program membership ($99/year)
- Developer ID Application certificate
- Notarization credentials

### Step 1: Enroll in Apple Developer Program

1. Go to https://developer.apple.com/programs/
2. Enroll as individual or organization
3. Wait for approval (can take 24-48 hours)

### Step 2: Create Developer ID Certificate

1. Open Xcode → Preferences → Accounts
2. Select your Apple ID → Manage Certificates
3. Click + → Developer ID Application

Or via Apple Developer portal:
1. Go to Certificates, Identifiers & Profiles
2. Create new certificate → Developer ID Application
3. Download and install in Keychain

### Step 3: Export Certificate for CI

```bash
# Export from Keychain as .p12 file
security export -k ~/Library/Keychains/login.keychain-db \
  -t identities -f pkcs12 -o certificate.p12 -P "your-password"

# Base64 encode for GitHub secret
base64 -i certificate.p12 | pbcopy
```

### Step 4: Create App-Specific Password

1. Go to https://appleid.apple.com/
2. Sign in → Security → App-Specific Passwords
3. Generate password for "klaas-ci"

### Step 5: Add GitHub Secrets

| Secret | Value |
|--------|-------|
| `APPLE_CERTIFICATE` | Base64-encoded .p12 certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Password used when exporting |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_TEAM_ID` | Your team ID (found in developer portal) |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from Step 4 |

---

## 6. Hosting install.sh on klaas.sh

The installer script needs to be accessible at `https://klaas.sh/install.sh`.

### Option A: Hugo Site (if klaas.sh uses Hugo)

Add `scripts/install.sh` to your Hugo static files:
```
hugo-sites/sites/klaas-sh/static/install.sh
```

### Option B: Cloudflare Worker

Create a simple worker that serves the script:

```typescript
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/install.sh') {
      const script = await fetch(
        'https://raw.githubusercontent.com/klaas-sh/cli/main/scripts/install.sh'
      );
      return new Response(script.body, {
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // ... rest of site
  }
}
```

### Option C: Redirect

Add DNS/Worker rule to redirect `klaas.sh/install.sh` to GitHub raw content.

---

## Setup Checklist

### Minimum Viable Distribution
- [ ] First release created with `git tag v0.1.0 && git push origin v0.1.0`
- [ ] Verify GitHub Release has all 5 binaries
- [ ] Host `install.sh` at `https://klaas.sh/install.sh`
- [ ] Test: `curl -fsSL https://klaas.sh/install.sh | bash`

### Recommended (Package Managers)
- [ ] Create `klaas-sh/homebrew-tap` repository
- [ ] Add Homebrew formula with correct SHA256 hashes
- [ ] Create `klaas-sh/scoop-bucket` repository
- [ ] Add Scoop manifest with correct hash
- [ ] Create GitHub PATs for automation
- [ ] Add `HOMEBREW_TAP_TOKEN` secret
- [ ] Add `SCOOP_BUCKET_TOKEN` secret

### Optional (Enhanced Distribution)
- [ ] Submit WinGet manifest PR
- [ ] Set up Apple Developer account
- [ ] Configure code signing secrets
- [ ] Add checksum files to releases
