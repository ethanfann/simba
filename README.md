# Simba

Sync AI coding assistant skills across Claude Code and Cursor.

## Overview

Simba keeps your custom skills in sync between different AI coding assistants. When you create a skill in Claude Code, Simba can automatically propagate it to Cursor (and vice versa), ensuring your workflows stay consistent regardless of which assistant you're using.

## Installation

```bash
bun install
```

## Quick Start

```bash
# Detect installed agents
simba detect

# View skill status across agents
simba status

# Sync all skills (union merge)
simba sync
```

## Commands

### `detect`

Scan for installed agents and their skills.

```bash
simba detect
simba detect --refresh  # Force rescan
```

### `status`

Display a matrix of skills across all detected agents.

```bash
simba status
simba status --agent claude  # Filter to specific agent
```

### `sync`

Synchronize skills across agents using union merge (skills present in one agent are copied to others).

```bash
simba sync
simba sync --dry-run          # Preview changes
simba sync --source claude    # Use Claude as source of truth for conflicts
```

### `migrate`

One-way copy of skills from one agent to another.

```bash
simba migrate --from claude --to cursor
simba migrate --from claude --to cursor --dry-run
```

### `backup`

Export all skills to a portable archive.

```bash
simba backup ./my-skills.tar.gz
simba backup ./my-skills.tar.gz --includeConfig
```

### `restore`

Restore skills from a backup archive or snapshot.

```bash
simba restore ./my-skills.tar.gz
simba restore ./my-skills.tar.gz --to cursor  # Restore to specific agent
simba restore --snapshot <id>                  # Restore from snapshot
simba restore --dry-run                        # Preview changes
```

### `import`

Copy a global skill into the current project for local customization.

```bash
simba import my-skill
simba import my-skill --to ./custom/path
simba import my-skill --agent cursor  # Import from specific agent
```

### `snapshots`

List available snapshots (automatically created before destructive operations).

```bash
simba snapshots
```

### `undo`

Restore from the most recent snapshot.

```bash
simba undo
simba undo --dry-run
```

## Supported Agents

| Agent | Global Skills Path | Project Skills Path |
|-------|-------------------|---------------------|
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

## How It Works

1. **Detection**: Simba scans for installed agents by checking if their config directories exist
2. **Hashing**: Each skill is identified by a tree hash of its contents, enabling conflict detection
3. **Snapshots**: Before any destructive operation, Simba creates a snapshot for easy rollback
4. **Sync Strategy**: Union merge copies skills that exist in one agent but not others; conflicts (same skill name, different content) require manual resolution or `--source` flag

## Configuration

Config is stored at `~/.config/simba/config.toml`:

```toml
[snapshots]
maxCount = 10
autoSnapshot = true
```

## License

MIT
