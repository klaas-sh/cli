# Teleportation.dev: A Remote Approval Tool for Claude Code

**Teleportation.dev is a developer tool that lets you approve AI coding agent actions directly from your phone**, solving the problem of developers being tethered to their desk while AI agents run. The tool wraps Claude Code with a remote approval system, and building a basic web-only alternative is **highly feasible in 1-2 weeks** using Claude Code's official hooks API.

## Core functionality and value proposition

Teleportation.dev addresses a specific pain point: developers using Claude Code must stay at their terminal to respond to permission prompts. The tool intercepts these prompts and routes them to a mobile/web interface, enabling true "walk away" AI-assisted development.

**Key features include:**

- **Remote approval/denial** of Claude Code actions via iOS app or web interface
- **Smart permission rules** that auto-approve safe reads while requiring confirmation for writes
- **Context persistence** that maintains memory between sessions and shares it across agents
- **Audit trail** with full approval history, timeline views, and enterprise-ready logging

The installation is remarkably simple: a single `curl` command to install, then `teleportation start` to launch Claude Code with remote approval enabled. The tool works on macOS and Linux.

---

## Open Source Alternatives

Several open source projects provide similar functionality, though none match Teleportation.dev's dedicated mobile app experience.

### Claude-Code-Remote

**GitHub:** https://github.com/JessyTsui/Claude-Code-Remote  
**Stars:** 929 | **License:** MIT

The most mature alternative. Supports multi-platform notifications via Telegram, Discord, Email, and LINE, offering two-way control where users can reply to messages to send new commands. The interactive Telegram bot includes smart buttons for common actions, and full execution traces are captured in notifications.

**Limitation:** No native mobile app—users interact through existing messaging platforms rather than a purpose-built interface.

### AFK

**GitHub:** https://github.com/probelabs/afk  
**License:** MIT

Takes a privacy-first approach with zero cloud dependencies, routing everything through Telegram. Offers three operational modes:

- **Remote** – full approval required
- **Local** – default Claude behavior  
- **Read-Only** – monitoring only

Includes smart permission patterns that can auto-create rules from one-time approvals. Framework-agnostic—works with any AI system, not just Claude.

### HumanLayer

**Stars:** 8,535

Enterprise-focused SDK (Python, TypeScript, JavaScript) for adding human approval to any AI agent workflow. Features `@require_approval` decorator and multi-channel notifications (Slack, Email, Discord). Requires integration work rather than working out-of-the-box with Claude Code.

### gotoHuman

**GitHub:** https://github.com/gotohuman/gotohuman-mcp-server

Managed solution with a free tier, featuring customizable approval forms and an "Agent Inbox" for pending reviews. MCP server integration works with Claude Desktop and Cursor. The platform itself is commercial rather than fully open source.

### Comparison Summary

| Tool | Mobile App | Platforms | Self-Hosted | License |
|------|------------|-----------|-------------|---------|
| Teleportation.dev | ✅ iOS | Web, iOS | ❌ | Commercial |
| Claude-Code-Remote | ❌ | Telegram, Discord, Email, LINE | ✅ | MIT |
| AFK | ❌ | Telegram | ✅ | MIT |
| HumanLayer | ❌ | Slack, Email, Discord | ✅ | Open Source |
| gotoHuman | ❌ | Web | Partial | Commercial |

**Key gap:** No open source alternative provides a dedicated mobile app or the same polished UX with timeline/audit views.

---

## Building a Web-Only Clone

Claude Code's official **hooks system** makes building an alternative highly feasible. The `PermissionRequest` hook (introduced in v2.0.45) provides exactly the interception point needed.

### How the Hooks Work

When Claude Code would show a permission dialog, the hook fires and can programmatically `allow`, `deny`, or pass through to the user. Hooks receive JSON via stdin containing `session_id`, `tool_name`, `tool_input`, and other context. They return JSON with the decision:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {"behavior": "allow"}
  }
}
```

### Architecture

```
Claude Code triggers hook
       ↓
Hook script makes HTTP request to backend
       ↓
Backend pushes to connected web clients (WebSocket)
       ↓
User approves/denies in browser
       ↓
Response flows back through the chain
```

### Recommended Technology Stack

| Component | Options |
|-----------|---------|
| WebSocket | Socket.io or native `ws` |
| Backend | Node.js/Express or Python/FastAPI |
| Storage | SQLite or PostgreSQL |
| Frontend | React, Vue, or vanilla JS |
| Mobile | PWA with Web Push API + Service Workers |

### Implementation Timeline

| Component | Effort |
|-----------|--------|
| Hook script | 2-4 hours (~50 lines) |
| Backend server | 1-2 days (~500 lines) |
| Web dashboard | 2-3 days (~300 lines) |
| Auth + audit logging | 1.5 days |
| **Total MVP** | **1-2 weeks** |
| With polish | 2-4 weeks |

### Key Technical Challenges

1. **Timeout handling** – hooks default to 60 seconds
2. **Session correlation** – between web clients and Claude Code instances
3. **Multi-device coordination** – when users have multiple clients open

None of these are blockers—just implementation details to address.

### No Proprietary APIs Needed

Everything works through documented, official Claude Code features. Useful reference resources:

- [claude-code-hooks-mastery](https://github.com/disler/claude-code-hooks-mastery) – example implementations
- [@abdo-el-mobayad/claude-code-fast-permission-hook](https://www.npmjs.com/package/@abdo-el-mobayad/claude-code-fast-permission-hook) – npm package reference

---

## Recommended Approach

**Use Claude Code's native hooks system** rather than trying to replace the CLI. A Python or Node.js script configured in `~/.claude/settings.json` intercepts permission requests, makes HTTP calls to your backend, and returns decisions. This preserves the familiar Claude Code experience while adding remote approval.

### Deployment Options

- **Self-hosted VPS** – Node.js + nginx
- **Serverless** – Vercel or Railway with WebSocket support
- **Local only** – localhost for personal use

A Progressive Web App frontend can provide mobile-like functionality without building native apps.

---

## Conclusion

Teleportation.dev solves a real workflow friction point for Claude Code users, but the technical barrier to building an alternative is low. The official hooks API is well-documented, and multiple open source projects demonstrate the pattern.

**For free/open alternatives today:** Claude-Code-Remote offers the best combination of maturity and features.

**For complete control:** A basic web-only clone is achievable in 1-2 weeks using standard web technologies and the documented hooks system.
