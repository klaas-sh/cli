#!/usr/bin/env node

/**
 * @fileoverview Stub binary that shows deprecation notice
 *
 * This npm package is deprecated. This stub exists to inform users
 * who installed via npm that they need to use the native installer.
 */

const isWindows = process.platform === 'win32';

const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

console.error();
console.error(`${RED}${BOLD}Error: npm installation of klaas is deprecated` +
  `${RESET}`);
console.error();
console.error('The npm package is a placeholder only. ' +
  'Please install klaas using the native installer:');
console.error();

if (isWindows) {
  console.error(`${CYAN}Windows PowerShell:${RESET}`);
  console.error('  irm https://klaas.sh/install.ps1 | iex');
  console.error();
  console.error(`${CYAN}Windows CMD:${RESET}`);
  console.error(
    '  curl -fsSL https://klaas.sh/install.cmd -o install.cmd && install.cmd'
  );
} else {
  console.error(`${CYAN}macOS / Linux / WSL:${RESET}`);
  console.error('  curl -fsSL https://klaas.sh/install.sh | bash');
}

console.error();
console.error('Then uninstall this npm package:');
console.error('  npm uninstall -g klaas');
console.error();

process.exit(1);
