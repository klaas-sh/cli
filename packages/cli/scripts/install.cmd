@echo off
setlocal EnableDelayedExpansion

:: Klaas CLI Installation Script for Windows CMD
::
:: Usage:
::   curl -fsSL https://klaas.sh/install.cmd -o install.cmd && install.cmd
::
:: This script downloads and installs the klaas CLI binary.

:: Configuration
set "GITHUB_REPO=klaas-sh/cli"
set "BINARY_NAME=klaas.exe"

:: Use custom install dir or default to LocalAppData
if defined KLAAS_INSTALL_DIR (
    set "INSTALL_DIR=%KLAAS_INSTALL_DIR%"
) else (
    set "INSTALL_DIR=%LOCALAPPDATA%\klaas\bin"
)

:: Colors (ANSI escape codes for Windows 10+)
for /f %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"
set "GREEN=%ESC%[32m"
set "YELLOW=%ESC%[33m"
set "BLUE=%ESC%[34m"
set "RED=%ESC%[31m"
set "AMBER=%ESC%[38;5;214m"
set "GRAY=%ESC%[90m"
set "NC=%ESC%[0m"

:: Banner (terminal window logo in amber)
echo.
echo %AMBER%  ╭────────╮%NC%
echo %AMBER%  ├────────┤%NC%
echo %AMBER%  │ ❯ __   │%NC%
echo %AMBER%  ╰────────╯%NC%
echo.
echo   %YELLOW%klaas%NC% %GRAY%~ Remote access for Claude Code%NC%
echo.

:: Check architecture
if "%PROCESSOR_ARCHITECTURE%"=="AMD64" (
    set "PLATFORM=windows-x64"
) else if "%PROCESSOR_ARCHITECTURE%"=="ARM64" (
    echo %RED%[ERROR]%NC% Windows ARM64 is not yet supported
    exit /b 1
) else (
    echo %RED%[ERROR]%NC% Unsupported architecture: %PROCESSOR_ARCHITECTURE%
    exit /b 1
)

echo %BLUE%[INFO]%NC% Detected platform: %PLATFORM%

:: Get latest version from GitHub API
echo %BLUE%[INFO]%NC% Fetching latest version...

:: Create temp directory
set "TEMP_DIR=%TEMP%\klaas-install-%RANDOM%"
mkdir "%TEMP_DIR%" 2>nul

:: Download release info
curl -fsSL "https://api.github.com/repos/%GITHUB_REPO%/releases/latest" -o "%TEMP_DIR%\release.json"
if errorlevel 1 (
    echo %RED%[ERROR]%NC% Failed to fetch release information
    goto :cleanup
)

:: Extract version (simple parsing)
for /f "tokens=2 delims=:," %%a in ('findstr /C:"tag_name" "%TEMP_DIR%\release.json"') do (
    set "VERSION=%%~a"
    set "VERSION=!VERSION: =!"
    set "VERSION=!VERSION:"=!"
)

if not defined VERSION (
    echo %RED%[ERROR]%NC% Failed to parse version from release info
    goto :cleanup
)

echo %BLUE%[INFO]%NC% Latest version: %VERSION%

:: Download manifest.json
echo %BLUE%[INFO]%NC% Downloading manifest...
set "MANIFEST_URL=https://github.com/%GITHUB_REPO%/releases/download/%VERSION%/manifest.json"
curl -fsSL "%MANIFEST_URL%" -o "%TEMP_DIR%\manifest.json"
if errorlevel 1 (
    echo %RED%[ERROR]%NC% Failed to download manifest
    goto :cleanup
)

:: Extract checksum from manifest using PowerShell
for /f "delims=" %%a in ('powershell -Command "$m = Get-Content '%TEMP_DIR%\manifest.json' | ConvertFrom-Json; $m.platforms.'%PLATFORM%'.checksum"') do set "EXPECTED_HASH=%%a"
if not defined EXPECTED_HASH (
    echo %RED%[ERROR]%NC% Platform %PLATFORM% not found in manifest
    goto :cleanup
)

:: Build download URL
set "ASSET_NAME=klaas-%PLATFORM%.zip"
set "DOWNLOAD_URL=https://github.com/%GITHUB_REPO%/releases/download/%VERSION%/%ASSET_NAME%"

:: Download binary
echo %BLUE%[INFO]%NC% Downloading %ASSET_NAME%...
curl -fsSL "%DOWNLOAD_URL%" -o "%TEMP_DIR%\%ASSET_NAME%"
if errorlevel 1 (
    echo %RED%[ERROR]%NC% Failed to download binary
    goto :cleanup
)

:: Verify checksum
echo %BLUE%[INFO]%NC% Verifying checksum...

:: Calculate actual hash
for /f "skip=1 tokens=*" %%a in ('certutil -hashfile "%TEMP_DIR%\%ASSET_NAME%" SHA256') do (
    if not defined ACTUAL_HASH set "ACTUAL_HASH=%%a"
)
set "ACTUAL_HASH=!ACTUAL_HASH: =!"

:: Compare (case-insensitive)
if /i "!EXPECTED_HASH!"=="!ACTUAL_HASH!" (
    echo %BLUE%[INFO]%NC% Checksum verified
) else (
    echo %RED%[ERROR]%NC% Checksum verification failed
    goto :cleanup
)

:: Extract
echo %BLUE%[INFO]%NC% Extracting...
powershell -Command "Expand-Archive -Path '%TEMP_DIR%\%ASSET_NAME%' -DestinationPath '%TEMP_DIR%' -Force"
if errorlevel 1 (
    echo %RED%[ERROR]%NC% Failed to extract archive
    goto :cleanup
)

:: Create install directory
if not exist "%INSTALL_DIR%" (
    mkdir "%INSTALL_DIR%"
)

:: Install binary
echo %BLUE%[INFO]%NC% Installing to %INSTALL_DIR%...
move /y "%TEMP_DIR%\%BINARY_NAME%" "%INSTALL_DIR%\%BINARY_NAME%" >nul
if errorlevel 1 (
    echo %RED%[ERROR]%NC% Failed to install binary
    goto :cleanup
)

echo %GREEN%[SUCCESS]%NC% klaas %VERSION% installed successfully!
echo.
echo %GRAY%Run 'klaas' to get started.%NC%
echo.

:: Check if install dir is in PATH
echo %PATH% | findstr /C:"%INSTALL_DIR%" >nul
if errorlevel 1 (
    echo %YELLOW%[WARN]%NC% %INSTALL_DIR% is not in your PATH
    echo.
    echo To add it permanently, run:
    echo   setx PATH "%%PATH%%;%INSTALL_DIR%"
    echo.
    echo Or add manually via System Properties ^> Environment Variables
    echo.
)

:cleanup
:: Clean up temp directory
if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%" 2>nul

endlocal
