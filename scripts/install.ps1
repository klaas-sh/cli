#Requires -Version 5.1
<#
.SYNOPSIS
    klaas CLI Installation Script for Windows

.DESCRIPTION
    Downloads and installs the klaas CLI binary for Windows.

.EXAMPLE
    irm https://klaas.sh/install.ps1 | iex

.EXAMPLE
    # Install to custom directory
    $env:KLAAS_INSTALL_DIR = "C:\tools\klaas"
    irm https://klaas.sh/install.ps1 | iex

.NOTES
    Supported: Windows 10/11 x64
#>

$ErrorActionPreference = "Stop"

# Configuration
$GitHubRepo = "klaas-sh/cli"
$BinaryName = "klaas.exe"
$InstallDir = if ($env:KLAAS_INSTALL_DIR) {
    $env:KLAAS_INSTALL_DIR
} else {
    "$env:LOCALAPPDATA\klaas\bin"
}

function Write-Info {
    param($Message)
    Write-Host "[INFO] " -ForegroundColor Blue -NoNewline
    Write-Host $Message
}

function Write-Success {
    param($Message)
    Write-Host "[SUCCESS] " -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Write-Warn {
    param($Message)
    Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline
    Write-Host $Message
}

function Write-Err {
    param($Message)
    Write-Host "[ERROR] " -ForegroundColor Red -NoNewline
    Write-Host $Message
    exit 1
}

function Get-Platform {
    if (-not [Environment]::Is64BitOperatingSystem) {
        Write-Err "32-bit Windows is not supported"
    }

    # Check for ARM64
    $arch = $env:PROCESSOR_ARCHITECTURE
    if ($arch -eq "ARM64") {
        Write-Err "Windows ARM64 is not yet supported"
    }

    return "windows-x64"
}

function Get-LatestVersion {
    Write-Info "Fetching latest version..."

    try {
        $release = Invoke-RestMethod `
            -Uri "https://api.github.com/repos/$GitHubRepo/releases/latest" `
            -UseBasicParsing
        return $release.tag_name
    }
    catch {
        Write-Err "Failed to get latest version: $_"
    }
}

function Install-Klaas {
    # Show banner (terminal window logo in amber)
    Write-Host ""
    Write-Host "  ╭────────╮" -ForegroundColor DarkYellow
    Write-Host "  ├────────┤" -ForegroundColor DarkYellow
    Write-Host "  │ ❯ __   │" -ForegroundColor DarkYellow
    Write-Host "  ╰────────╯" -ForegroundColor DarkYellow
    Write-Host ""
    Write-Host "  klaas" -ForegroundColor Yellow -NoNewline
    Write-Host " ~ Remote access for Claude Code" -ForegroundColor Gray
    Write-Host ""

    # Detect platform
    $platform = Get-Platform
    Write-Info "Detected platform: $platform"

    # Get latest version
    $version = Get-LatestVersion
    Write-Info "Latest version: $version"

    # Download manifest.json
    Write-Info "Downloading manifest..."
    $manifestUrl = "https://github.com/$GitHubRepo/releases/download/$version/manifest.json"
    try {
        $manifest = Invoke-RestMethod -Uri $manifestUrl -UseBasicParsing
    }
    catch {
        Write-Err "Failed to download manifest: $_"
    }

    # Get checksum from manifest
    $platformKey = $platform -replace "\.exe$", ""
    $platformInfo = $manifest.platforms.$platformKey
    if (-not $platformInfo) {
        Write-Err "Platform $platform not found in manifest"
    }
    $expectedHash = $platformInfo.checksum.ToUpper()

    # Build download URL
    $assetName = $platformInfo.archive
    if (-not $assetName) {
        $assetName = "klaas-$platform.zip"
    }
    $downloadUrl = "https://github.com/$GitHubRepo/releases/download/$version/$assetName"

    # Create temp directory
    $tmpDir = New-Item -ItemType Directory -Path (
        Join-Path $env:TEMP ([System.IO.Path]::GetRandomFileName())
    )

    try {
        $zipPath = Join-Path $tmpDir "klaas.zip"

        # Download binary
        Write-Info "Downloading $assetName..."
        Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing

        # Verify checksum
        Write-Info "Verifying checksum..."
        $actualHash = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToUpper()

        if ($expectedHash -ne $actualHash) {
            Write-Err "Checksum verification failed"
        }
        Write-Info "Checksum verified"

        # Extract
        Write-Info "Extracting..."
        Expand-Archive -Path $zipPath -DestinationPath $tmpDir -Force

        # Create install directory
        if (-not (Test-Path $InstallDir)) {
            New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        }

        # Install binary
        Write-Info "Installing to $InstallDir..."
        $sourcePath = Join-Path $tmpDir $BinaryName
        $destPath = Join-Path $InstallDir $BinaryName
        Move-Item -Path $sourcePath -Destination $destPath -Force

        Write-Success "klaas $version installed successfully!"
        Write-Host ""
        Write-Host "Run 'klaas' to get started." -ForegroundColor Gray
        Write-Host ""

        # Check if install dir is in PATH
        $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
        if ($userPath -notlike "*$InstallDir*") {
            Write-Warn "$InstallDir is not in your PATH"

            $addToPath = Read-Host "Add to PATH? (Y/n)"
            if ($addToPath -ne "n" -and $addToPath -ne "N") {
                [Environment]::SetEnvironmentVariable(
                    "PATH",
                    "$userPath;$InstallDir",
                    "User"
                )
                $env:PATH = "$env:PATH;$InstallDir"
                Write-Success "Added to PATH. Restart your terminal for changes."
            }
            else {
                Write-Host ""
                Write-Host "Add manually to your PATH:" -ForegroundColor Gray
                Write-Host "  $InstallDir" -ForegroundColor Cyan
                Write-Host ""
            }
        }
    }
    finally {
        # Cleanup
        Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
    }
}

# Run installation
Install-Klaas
