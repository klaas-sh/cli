<p align="center">
  <img src="https://raw.githubusercontent.com/klaas-sh/cli/main/logo.svg" alt="klaas" width="80" height="80">
</p>

<h1 align="center">klaas</h1>

<p align="center">
  <strong>Remote access for Claude Code</strong>
</p>

<p align="center">
  <picture>
    <source srcset="https://raw.githubusercontent.com/klaas-sh/cli/main/terminal-animation.avif" type="image/avif">
    <img src="https://raw.githubusercontent.com/klaas-sh/cli/main/terminal-animation.webp" alt="klaas in action" width="600">
  </picture>
</p>

<p align="center">
  <a href="https://klaas.sh">Website</a> ·
  <a href="https://klaas.sh/docs">Docs</a> ·
  <a href="https://github.com/klaas-sh/cli">CLI</a>
</p>

---

**klaas** wraps your Claude Code sessions and streams them to the cloud, giving you remote access from any device.

- Stream terminal output in real-time
- Access sessions from phone, tablet, or another computer
- Monitor long-running autonomous coding tasks
- Share sessions with teammates

### Install

```bash
curl -fsSL https://klaas.sh/install.sh | bash
```

<details>
<summary>More install options</summary>

**Windows PowerShell**
```powershell
irm https://klaas.sh/install.ps1 | iex
```

**Homebrew**
```bash
brew install klaas-sh/tap/klaas
```

**Scoop**
```powershell
scoop bucket add klaas https://github.com/klaas-sh/scoop-bucket
scoop install klaas
```

</details>

### Usage

```bash
klaas  # that's it — replaces 'claude'
```
