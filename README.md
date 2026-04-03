# Simba

<p align="center">
  <img src="assets/simba.jpg" alt="Simba the cat" width="600">
</p>

[![npm version](https://img.shields.io/npm/v/simba-skills)](https://www.npmjs.com/package/simba-skills)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

AI skills manager with a central store and symlink-based distribution across universal XDG agents, Claude Code, and pi.

## Why Simba?

Most skill installers are one-shot: they clone a repo and copy files. Simba is a **skill lifecycle manager**:

- **Central store** → One source of truth at `~/.config/agents/skills/`
- **Registry tracking** → Records install sources, enabling one-command updates
- **Symlink distribution** → No file duplication; changes propagate instantly
- **Multi-agent sync** → Keep universal XDG agents, Claude Code, and pi in sync
- **Rollback support** → Automatic snapshots before destructive operations

## Installation

```bash
# Requires Bun runtime
bunx simba-skills init
```

Or install globally:

```bash
bun install -g simba-skills
```

## Quick Start

```bash
# Initialize: detect installed agents
simba init

# Scan agents and adopt existing skills into the central store
simba scan

# Install skills from GitHub
simba install vercel-labs/agent-skills

# Link skills to specific install locations
simba link my-skill universal,claude

# Check for updates (uses tracked install sources)
simba update

# View skill matrix across all agents
simba list --matrix
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

### Link & Manage

```bash
# Link skill to multiple install locations
simba link my-skill universal,claude,pi

# Interactive TUI for bulk management
simba manage

# Remove skill from install locations
simba unlink my-skill claude
```

### Health & Recovery

```bash
# Check symlink integrity
simba doctor

# Auto-repair broken symlinks
simba doctor --fix

# Backup all skills
simba snapshot backup ./skills.tar.gz --includeConfig

# Restore from backup
simba snapshot restore ./skills.tar.gz

# Undo last operation
simba snapshot undo
```

## Supported Install Targets

Supports three install targets:

- `universal` → `~/.config/agents/skills` for XDG-compliant agents using `.agents/skills`
- `claude` → `~/.claude/skills`
- `pi` → `~/.pi/agent/skills`

See full agent definitions and paths in [`src/core/config-store.ts`](./src/core/config-store.ts).

## Architecture

```
~/.config/simba/
├── config.toml           # Settings
├── registry.json         # Skill metadata, sources & assignments
└── snapshots/            # Automatic rollback points

~/.config/agents/skills/  # Canonical skill store
└── my-skill/
    └── SKILL.md

~/.claude/skills/
└── my-skill → ~/.config/agents/skills/my-skill  (symlink)

~/.pi/agent/skills/
└── my-skill → ~/.config/agents/skills/my-skill  (symlink)
```

## All Commands

| Command | Description |
|---------|-------------|
| `init` | Detect installed agents and scan skills |
| `scan` | Scan agents and adopt skills into central store |
| `install` | Install from GitHub or local path |
| `uninstall` | Remove skill from store and agents |
| `update` | Check and apply updates from sources |
| `list` | List managed skills |
| `list --matrix` | Skill matrix across agents |
| `link` | Link skill to install locations |
| `unlink` | Remove skill from install locations |
| `manage` | Interactive TUI |
| `sync` | Union merge across agents |
| `migrate` | Copy all skills from one agent to another |
| `doctor` | Verify and repair symlinks |
| `snapshot backup` | Export skills to archive |
| `snapshot restore` | Restore from backup or snapshot |
| `snapshot list` | List rollback points |
| `snapshot undo` | Restore from last snapshot |
| `copy` | Copy global skill to project for customization |
| `bootstrap` | Restore all skills from registry on new machine |

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
