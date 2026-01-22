# Simba

<p align="center">
  <img src="assets/simba.jpg" alt="Simba the cat" width="600">
</p>

[![npm version](https://img.shields.io/npm/v/simba-skills)](https://www.npmjs.com/package/simba-skills)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

AI skills manager with a central store and symlink-based distribution across 14+ coding agents.

## Why Simba?

Most skill installers are one-shot: they clone a repo and copy files. Simba is a **skill lifecycle manager**:

- **Central store** → One source of truth at `~/.config/simba/skills/`
- **Registry tracking** → Records install sources, enabling one-command updates
- **Symlink distribution** → No file duplication; changes propagate instantly
- **Multi-agent sync** → Keep Claude, Cursor, Copilot, and others in sync
- **Rollback support** → Automatic snapshots before destructive operations

## Installation

```bash
# Requires Bun runtime
bunx simba-skills detect
```

Or install globally:

```bash
bun install -g simba-skills
```

## Quick Start

```bash
# Detect installed agents
simba detect

# Adopt existing skills into the central store
simba adopt

# Install skills from GitHub
simba install vercel-labs/agent-skills

# Assign skills to specific agents
simba assign my-skill claude,cursor

# Check for updates (uses tracked install sources)
simba update

# View skill matrix across all agents
simba status
```

## Key Features

### Install & Update

```bash
# Install from GitHub (HTTPS)
simba install user/repo

# Install from private repos (SSH)
simba install user/repo --ssh

# Install from local path (creates symlinks, auto-syncs)
simba install ~/my-skills

# Update all installed skills from their sources
simba update
```

Simba records the source repository and path during installation, enabling `simba update` to fetch and compare changes with diffs.

### Assign & Manage

```bash
# Assign skill to multiple agents
simba assign my-skill claude,cursor,copilot

# Interactive TUI for bulk management
simba manage

# Remove skill from agents
simba unassign my-skill claude
```

### Health & Recovery

```bash
# Check symlink integrity
simba doctor

# Auto-repair broken symlinks
simba doctor --fix

# Backup all skills
simba backup ./skills.tar.gz --includeConfig

# Restore from backup
simba restore ./skills.tar.gz

# Undo last operation
simba undo
```

## Supported Agents

| Agent | Global Path | Project Path |
|-------|-------------|--------------|
| Claude Code | `~/.claude/skills` | `.claude/skills` |
| Cursor | `~/.cursor/skills` | `.cursor/skills` |
| Codex | `~/.codex/skills` | `.codex/skills` |
| GitHub Copilot | `~/.copilot/skills` | `.github/skills` |
| Gemini CLI | `~/.gemini/skills` | `.gemini/skills` |
| Windsurf | `~/.codeium/windsurf/skills` | `.windsurf/skills` |
| Amp | `~/.config/agents/skills` | `.agents/skills` |
| Goose | `~/.config/goose/skills` | `.goose/skills` |
| OpenCode | `~/.config/opencode/skill` | `.opencode/skill` |
| Kilo Code | `~/.kilocode/skills` | `.kilocode/skills` |
| Roo Code | `~/.roo/skills` | `.roo/skills` |
| Antigravity | `~/.gemini/antigravity/skills` | `.agent/skills` |
| Clawdbot | `~/.clawdbot/skills` | `skills` |
| Droid | `~/.factory/skills` | `.factory/skills` |

## Architecture

```
~/.config/simba/
├── config.toml           # Settings
├── registry.json         # Skill metadata, sources & assignments
├── skills/               # Central store
│   └── my-skill/
│       └── SKILL.md
└── snapshots/            # Automatic rollback points

~/.claude/skills/
└── my-skill → ~/.config/simba/skills/my-skill  (symlink)

~/.cursor/skills/
└── my-skill → ~/.config/simba/skills/my-skill  (symlink)
```

## All Commands

| Command | Description |
|---------|-------------|
| `detect` | Scan for installed agents |
| `adopt` | Move existing skills into central store |
| `install` | Install from GitHub or local path |
| `uninstall` | Remove skill from store and agents |
| `update` | Check and apply updates from sources |
| `list` | List managed skills |
| `status` | Skill matrix across agents |
| `assign` | Symlink skill to agents |
| `unassign` | Remove skill from agents |
| `manage` | Interactive TUI |
| `sync` | Union merge across agents |
| `migrate` | Copy all skills from one agent to another |
| `doctor` | Verify and repair symlinks |
| `backup` | Export skills to archive |
| `restore` | Restore from backup |
| `snapshots` | List rollback points |
| `undo` | Restore from last snapshot |
| `import` | Copy global skill to project for customization |

## Configuration

Config at `~/.config/simba/config.toml`:

```toml
[snapshots]
maxCount = 10
autoSnapshot = true

[sync]
strategy = "union"  # or "source"
sourceAgent = ""    # for source strategy
```

## License

MIT
