#!/usr/bin/env node

/**
 * @fileoverview Post-install script showing deprecation notice
 *
 * This npm package is a placeholder to prevent name squatting.
 * Users should install klaas using the native installer instead.
 */

const isWindows = process.platform === 'win32';

const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

console.log();
console.log(`${YELLOW}${BOLD}` +
  '╔══════════════════════════════════════════════════════════════╗');
console.log(
  '║                                                              ║');
console.log(
  '║   ⚠️  npm installation of klaas is DEPRECATED               ║');
console.log(
  '║                                                              ║');
console.log(
  '║   Please uninstall and use the native installer instead:    ║');
console.log(
  '║                                                              ║');
console.log(
  '╚══════════════════════════════════════════════════════════════╝' +
  `${RESET}`);
console.log();

if (isWindows) {
  console.log(`${CYAN}Windows PowerShell:${RESET}`);
  console.log('  irm https://klaas.sh/install.ps1 | iex');
  console.log();
  console.log(`${CYAN}Windows CMD:${RESET}`);
  console.log(
    '  curl -fsSL https://klaas.sh/install.cmd -o install.cmd && install.cmd'
  );
} else {
  console.log(`${CYAN}macOS / Linux / WSL:${RESET}`);
  console.log('  curl -fsSL https://klaas.sh/install.sh | bash');
}

console.log();
console.log(`${CYAN}Homebrew (macOS/Linux):${RESET}`);
console.log('  brew install --cask klaas');
console.log();
console.log(`Learn more: ${CYAN}https://klaas.sh${RESET}`);
console.log();
