# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in `klaas`, please report it responsibly.

**Do not open a public issue.**

Instead, email us at **security@klaas.sh** with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes (optional)

We aim to respond within 48 hours and will work with you to understand and resolve the issue promptly.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |

## Security Measures

klaas is designed with security in mind:

- All communication with klaas.sh is encrypted via TLS
- Authentication uses industry-standard OAuth 2.0 Device Flow
- Session tokens are stored securely in your system's credential store
- No terminal data is stored on our servers longer than necessary for streaming
