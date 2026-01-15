#!/usr/bin/env node

/**
 * @fileoverview Post-install script showing deprecation notice
 *
 * This npm package is a placeholder to prevent name squatting.
 * Users should install klaas using the native installer instead.
 */

import { yellow, cyan, bold } from 'barva';

const isWindows = process.platform === 'win32';

console.log();
console.log(yellow.bold`╔══════════════════════════════════════════════════════════════╗`);
console.log(yellow.bold`║                                                              ║`);
console.log(yellow.bold`║   ⚠️  npm installation of klaas is DEPRECATED               ║`);
console.log(yellow.bold`║                                                              ║`);
console.log(yellow.bold`║   Please uninstall and use the native installer instead:    ║`);
console.log(yellow.bold`║                                                              ║`);
console.log(yellow.bold`╚══════════════════════════════════════════════════════════════╝`);
console.log();

if (isWindows) {
  console.log(cyan`Windows PowerShell:`);
  console.log('  irm https://klaas.sh/install.ps1 | iex');
  console.log();
  console.log(cyan`Windows CMD:`);
  console.log(
    '  curl -fsSL https://klaas.sh/install.cmd -o install.cmd && install.cmd'
  );
} else {
  console.log(cyan`macOS / Linux / WSL:`);
  console.log('  curl -fsSL https://klaas.sh/install.sh | bash');
}

console.log();
console.log(cyan`Homebrew (macOS/Linux):`);
console.log('  brew install klaas-sh/tap/klaas');
console.log();
console.log(`Learn more: ${cyan`https://klaas.sh`}`);
console.log();
