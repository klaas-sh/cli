{
  description = "klaas - Remote access wrapper for AI coding agents";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # Read version from Cargo.toml
        cargoToml = builtins.fromTOML (builtins.readFile ./Cargo.toml);
        version = cargoToml.package.version;
      in
      {
        packages = {
          klaas = pkgs.rustPlatform.buildRustPackage {
            pname = "klaas";
            inherit version;

            src = ./.;

            cargoLock.lockFile = ./Cargo.lock;

            # Native dependencies for building
            nativeBuildInputs = with pkgs; [
              pkg-config
            ];

            # Runtime dependencies
            buildInputs = with pkgs; [
              openssl
            ] ++ lib.optionals stdenv.isDarwin [
              darwin.apple_sdk.frameworks.Security
              darwin.apple_sdk.frameworks.SystemConfiguration
            ];

            # Create analytics marker file after installation
            postInstall = ''
              # Create version file for the wrapper to use
              mkdir -p $out/share/klaas
              echo "${version}" > $out/share/klaas/version

              # Install a wrapper script that creates the install marker
              # on first run (for analytics tracking)
              mv $out/bin/klaas $out/bin/.klaas-wrapped
              cat > $out/bin/klaas << 'WRAPPER'
#!/bin/sh
# Create install marker in user's data directory on first Nix install
# The marker is created once, then klaas detects it, sends the install
# event, and deletes it.
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/klaas"
NIX_SETUP_MARKER="$DATA_DIR/.nix-setup-done"
INSTALL_MARKER="$DATA_DIR/.installed"
VERSION_FILE="$(dirname "$(dirname "$(readlink -f "$0")")")/share/klaas/version"

# Only create install marker if this is the first time running via Nix
if [ -f "$VERSION_FILE" ] && [ ! -f "$NIX_SETUP_MARKER" ]; then
  mkdir -p "$DATA_DIR"
  cp "$VERSION_FILE" "$INSTALL_MARKER"
  touch "$NIX_SETUP_MARKER"
fi

exec "$(dirname "$0")/.klaas-wrapped" "$@"
WRAPPER
              chmod +x $out/bin/klaas
            '';

            meta = with pkgs.lib; {
              description = "Remote access wrapper for AI coding agents";
              longDescription = ''
                klaas wraps your AI coding agent sessions and streams them
                to the cloud, enabling remote access from any device via a
                web interface. Supports Claude Code, Gemini CLI, Codex,
                Aider, and more.
              '';
              homepage = "https://klaas.sh";
              license = licenses.mit;
              maintainers = [];
              mainProgram = "klaas";
              platforms = platforms.unix;
            };
          };

          default = self.packages.${system}.klaas;
        };

        # Development shell with Rust toolchain
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            cargo
            rustc
            rust-analyzer
            rustfmt
            clippy
            pkg-config
            openssl
          ] ++ lib.optionals stdenv.isDarwin [
            darwin.apple_sdk.frameworks.Security
            darwin.apple_sdk.frameworks.SystemConfiguration
          ];

          RUST_SRC_PATH = "${pkgs.rust.packages.stable.rustPlatform.rustLibSrc}";
        };

        # Allow running directly with `nix run`
        apps.default = flake-utils.lib.mkApp {
          drv = self.packages.${system}.klaas;
        };
      }
    );
}
