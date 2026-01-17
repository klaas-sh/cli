#!/usr/bin/env node

/**
 * @fileoverview Stub binary that shows deprecation notice
 *
 * This npm package is deprecated. This stub exists to inform users
 * who installed via npm that they need to use the native installer.
 */

import { red, cyan, bold } from 'barva';

const isWindows = process.platform === 'win32';

console.error();
console.error(red.bold`Error: npm installation of klaas is deprecated`);
console.error();
console.error('Please install klaas using the native installer:');
console.error();

if (isWindows) {
  console.error(cyan`Windows PowerShell:`);
  console.error('  irm https://klaas.sh/install.ps1 | iex');
  console.error();
  console.error(cyan`Windows CMD:`);
  console.error(
    '  curl -fsSL https://klaas.sh/install.cmd -o install.cmd && install.cmd'
  );
} else {
  console.error(cyan`macOS / Linux / WSL:`);
  console.error('  curl -fsSL https://klaas.sh/install.sh | bash');
}

console.error();
console.error('Then uninstall this npm package:');
console.error('  npm uninstall -g klaas');
console.error();

process.exit(1);
