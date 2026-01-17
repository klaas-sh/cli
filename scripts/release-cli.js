#!/usr/bin/env node

/**
 * CLI Release Script for klaas
 *
 * Updates version in Cargo.toml and npm package, creates git tag, and pushes.
 */

import { createInterface } from 'readline';
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { yellow, green, red, cyan, bold, dim } from 'barva';

// Amber color (closest barva equivalent is yellow)
const amber = yellow;

// ASCII art logo (matching CLI)
const LOGO = [
  '╭────────╮',
  '├────────┤',
  '│ ❯ __   │',
  '╰────────╯',
];

/**
 * Displays the klaas logo in amber color.
 */
function displayLogo() {
  console.log();
  for (const line of LOGO) {
    console.log(amber`  ${line}`);
  }
}

/**
 * Prompts the user for input with a default value.
 * @param {string} question - The question to ask
 * @param {string} defaultValue - The default value if user presses enter
 * @returns {Promise<string>} The user's input or default value
 */
function prompt(question, defaultValue) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const promptText = defaultValue
      ? `${question} [${defaultValue}]: `
      : `${question}: `;

    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

/**
 * Reads the current version from Cargo.toml.
 * @returns {string} The current version
 */
function getCurrentVersion() {
  const cargoToml = readFileSync('packages/cli/Cargo.toml', 'utf-8');
  const match = cargoToml.match(/^version = "(.+)"$/m);
  if (!match) {
    throw new Error('Could not find version in Cargo.toml');
  }
  return match[1];
}

/**
 * Updates the version in Cargo.toml.
 * @param {string} version - The new version
 */
function updateCargoToml(version) {
  const path = 'packages/cli/Cargo.toml';
  let content = readFileSync(path, 'utf-8');
  content = content.replace(/^version = ".+"$/m, `version = "${version}"`);
  writeFileSync(path, content);
  console.log(dim`  Updated ${path}`);
}

/**
 * Updates the version in the npm package.json.
 * @param {string} version - The new version
 */
function updateNpmPackage(version) {
  const path = 'packages/npm/package.json';
  const pkg = JSON.parse(readFileSync(path, 'utf-8'));
  pkg.version = version;
  writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  console.log(dim`  Updated ${path}`);
}

/**
 * Runs a shell command and returns the output.
 * @param {string} command - The command to run
 * @param {boolean} silent - Whether to suppress output
 * @returns {string} The command output
 */
function run(command, silent = false) {
  try {
    const output = execSync(command, {
      encoding: 'utf-8',
      stdio: silent ? 'pipe' : 'inherit',
      shell: '/bin/bash',
    });
    return output;
  } catch (error) {
    if (error.stdout) return error.stdout;
    throw error;
  }
}

/**
 * Validates a semantic version string.
 * @param {string} version - The version to validate
 * @returns {boolean} True if valid
 */
function isValidVersion(version) {
  return /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(version);
}

/**
 * Bumps a version by type (major, minor, patch).
 * @param {string} version - Current version (e.g., "1.2.3")
 * @param {'major' | 'minor' | 'patch'} type - Bump type
 * @returns {string} New version
 */
function bumpVersion(version, type) {
  const [major, minor, patch] = version.split('-')[0].split('.').map(Number);
  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      return version;
  }
}

/**
 * Parses user input to resolve version.
 * Supports shortcuts: M/major, m/minor, p/patch
 * @param {string} input - User input
 * @param {string} currentVersion - Current version for bump calculation
 * @returns {string} Resolved version
 */
function resolveVersion(input, currentVersion) {
  const lower = input.toLowerCase();
  if (lower === 'm' || lower === 'major') {
    return bumpVersion(currentVersion, 'major');
  }
  if (lower === 'n' || lower === 'minor') {
    return bumpVersion(currentVersion, 'minor');
  }
  if (lower === 'p' || lower === 'patch') {
    return bumpVersion(currentVersion, 'patch');
  }
  return input;
}

/**
 * Main release function.
 */
async function main() {
  displayLogo();
  console.log(bold.yellow`  klaas CLI Release`);

  // Get current version
  const currentVersion = getCurrentVersion();
  console.log(dim`  Current version: ${cyan`v${currentVersion}`}`);
  console.log();

  // Show shortcuts
  const patchVersion = bumpVersion(currentVersion, 'patch');
  const minorVersion = bumpVersion(currentVersion, 'minor');
  const majorVersion = bumpVersion(currentVersion, 'major');
  console.log(dim`  Shortcuts: ${cyan`p`}atch → ${patchVersion}, mi${cyan`n`}or → ${minorVersion}, ${cyan`m`}ajor → ${majorVersion}`);
  console.log();

  // Prompt for new version
  const input = await prompt(
    amber`  Enter new version`,
    'p'
  );

  // Resolve shortcuts
  const newVersion = resolveVersion(input, currentVersion);

  // Validate version
  if (!isValidVersion(newVersion)) {
    console.log();
    console.log(red`  Error: Invalid version format "${input}"`);
    console.log(dim`  Expected: X.Y.Z, or shortcut (p/n/m)`);
    process.exit(1);
  }

  // Check if version changed
  if (newVersion === currentVersion) {
    console.log();
    console.log(amber`  Version unchanged. Nothing to do.`);
    process.exit(0);
  }

  console.log();
  console.log(amber`  Releasing v${newVersion}...`);
  console.log();

  // Update files
  console.log(dim`  Updating version files...`);
  updateCargoToml(newVersion);
  updateNpmPackage(newVersion);

  // Verify Cargo.toml is valid
  console.log();
  console.log(dim`  Verifying Cargo.toml...`);
  try {
    run('source ~/.cargo/env 2>/dev/null; cd packages/cli && cargo check --quiet', true);
    console.log(green`  ✓ Cargo.toml is valid`);
  } catch {
    console.log(red`  ✗ Cargo.toml validation failed`);
    process.exit(1);
  }

  // Git operations
  console.log();
  console.log(dim`  Creating git commit...`);
  run(`git add packages/cli/Cargo.toml packages/npm/package.json`, true);
  run(
    `git commit -m "chore(cli): bump version to ${newVersion}"`,
    true
  );
  console.log(green`  ✓ Created commit`);

  console.log();
  console.log(dim`  Creating annotated tag...`);
  run(
    `git tag -a v${newVersion} -m "Release v${newVersion}"`,
    true
  );
  console.log(green`  ✓ Created tag v${newVersion}`);

  // Push
  console.log();
  console.log(dim`  Pushing to origin...`);
  run('git push origin main', true);
  run(`git push origin v${newVersion}`, true);
  console.log(green`  ✓ Pushed to origin`);

  // Push CLI subtree
  console.log();
  console.log(dim`  Pushing CLI to public repo...`);
  run('git subtree push --prefix=packages/cli cli main', true);
  run(`git push cli v${newVersion}`, true);
  console.log(green`  ✓ Pushed to klaas-sh/cli`);

  // Summary
  console.log();
  console.log(bold.green`  ✓ Release v${newVersion} complete!`);
  console.log();
  console.log(dim`  The GitHub Action will now build and publish the release.`);
  console.log(
    dim`  Check: ${cyan`https://github.com/klaas-sh/cli/actions`}`
  );
  console.log();
}

main().catch((error) => {
  console.error();
  console.error(red`  Error: ${error.message}`);
  process.exit(1);
});
