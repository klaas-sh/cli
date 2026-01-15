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
set "MAGENTA=%ESC%[35m"
set "GRAY=%ESC%[90m"
set "NC=%ESC%[0m"

:: Banner
echo.
echo %MAGENTA%  _    _                %NC%
echo %MAGENTA% ^| ^| _^| ^| __ _  __ _ ___%NC%
echo %MAGENTA% ^| ^|/ / ^|/ _` ^|/ _` / __^|%NC%
echo %MAGENTA% ^|   ^<^| ^| (_^| ^| (_^| \__ \%NC%
echo %MAGENTA% ^|_^|\_\_^|\__,_^|\__,_^|___/%NC%
echo.
echo %GRAY% Remote access for Claude Code%NC%
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

:: Build download URL
set "ASSET_NAME=klaas-%PLATFORM%.exe.zip"
set "DOWNLOAD_URL=https://github.com/%GITHUB_REPO%/releases/download/%VERSION%/%ASSET_NAME%"
set "CHECKSUM_URL=%DOWNLOAD_URL%.sha256"

:: Download binary
echo %BLUE%[INFO]%NC% Downloading %ASSET_NAME%...
curl -fsSL "%DOWNLOAD_URL%" -o "%TEMP_DIR%\%ASSET_NAME%"
if errorlevel 1 (
    echo %RED%[ERROR]%NC% Failed to download binary
    goto :cleanup
)

:: Download and verify checksum (optional)
curl -fsSL "%CHECKSUM_URL%" -o "%TEMP_DIR%\%ASSET_NAME%.sha256" 2>nul
if not errorlevel 1 (
    echo %BLUE%[INFO]%NC% Verifying checksum...

    :: Get expected hash from file
    for /f "tokens=1" %%a in (%TEMP_DIR%\%ASSET_NAME%.sha256) do set "EXPECTED_HASH=%%a"

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
) else (
    echo %YELLOW%[WARN]%NC% Checksum file not available, skipping verification
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
