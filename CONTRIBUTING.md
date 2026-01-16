# Contributing to `klaas`

Thanks for your interest in contributing to `klaas`!

## Getting Started

1. Fork the repository
2. Clone your fork
3. Install Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
4. Build: `cargo build`
5. Run tests: `cargo test`

## Development

```bash
# Build
cargo build

# Run with debug logging
RUST_LOG=klaas=debug cargo run

# Format code
cargo fmt

# Lint
cargo clippy -- -D warnings
```

## Pull Requests

1. Create a branch for your changes
2. Make your changes
3. Ensure tests pass: `cargo test`
4. Ensure code is formatted: `cargo fmt --check`
5. Ensure no lint warnings: `cargo clippy -- -D warnings`
6. Open a pull request

## Code Style

- Follow Rust conventions
- Run `cargo fmt` before committing
- No clippy warnings

## Reporting Issues

- Use GitHub Issues for bugs and feature requests
- For security issues, see [SECURITY.md](SECURITY.md)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
