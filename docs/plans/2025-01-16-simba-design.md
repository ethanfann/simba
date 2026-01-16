# simba - AI Skills Sync/Backup/Migrate Tool

Personal power-user CLI/TUI for managing AI agent skills across Claude Code, Cursor, Codex, OpenCode, and Antigravity.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        simba                            │
├─────────────┬─────────────┬─────────────────────────────┤
│   CLI       │    TUI      │         Core                │
│  (citty)    │ (OpenTUI)   │                             │
├─────────────┴─────────────┼─────────────────────────────┤
│      Commands             │  AgentRegistry              │
│      ├─ detect            │  ├─ detect agents           │
│      ├─ status            │  ├─ read/write skills       │
│      ├─ sync              │  └─ path resolution         │
│      ├─ migrate           │                             │
│      ├─ backup            │  SkillManager               │
│      ├─ restore           │  ├─ hash/compare            │
│      ├─ import            │  └─ copy/merge              │
│      ├─ undo              │                             │
│      ├─ snapshots         │  ConfigStore                │
│      └─ tui               │  └─ ~/.config/simba/        │
└───────────────────────────┴─────────────────────────────┘
```

## Tech Stack

| Component | Choice |
|-----------|--------|
| Runtime | Bun |
| Language | TypeScript |
| CLI | citty |
| TUI | OpenTUI + SolidJS |
| Config | TOML (smol-toml) |
| Backup | tar |

## Configuration

Location: `~/.config/simba/config.toml`

```toml
[agents.claude]
name = "Claude Code"
global_path = "~/.claude/skills"
project_path = ".claude/skills"
detected = true

[agents.cursor]
name = "Cursor"
global_path = "~/.cursor/skills"
project_path = ".cursor/skills"
detected = true

[agents.codex]
name = "Codex"
global_path = "~/.codex/skills"
project_path = ".codex/skills"
detected = false

[agents.opencode]
name = "OpenCode"
global_path = "~/.config/opencode/skill"
project_path = ".opencode/skill"
detected = true

[agents.antigravity]
name = "Antigravity"
global_path = "~/.gemini/antigravity/skills"
project_path = ".agent/skills"
detected = false

[sync]
strategy = "union"
source_agent = ""

[snapshots]
max_count = 10
auto_snapshot = true

[skills.pdf-processing]
hash = "sha256:a1b2c3d4..."
origin = "claude"
last_seen = 2025-01-15T10:30:00Z
agents = ["claude", "cursor", "opencode"]
```

## CLI Commands

```
simba <command> [options]

Commands:
  detect              Scan for installed agents and skills
  status              Show skill matrix across agents
  sync                Sync skills (union merge)
  migrate <from> <to> Copy skills from one agent to another
  backup <path>       Export skills to .tar.gz
  restore <path>      Restore from backup
  import <skill>      Copy global skill to current project
  undo                Restore from most recent snapshot
  snapshots           List available snapshots
  tui                 Launch interactive dashboard

Global options:
  --config <path>     Override config location
  --verbose, -v       Verbose output
  --dry-run, -n       Preview changes
  --help, -h          Show help
```

### Command Details

| Command | Key Flags | Behavior |
|---------|-----------|----------|
| `detect` | `--refresh` | Scan agent paths, update config |
| `status` | `--agent <name>` | Print skill matrix |
| `sync` | `--source <agent>` | Union merge; with flag, one-way |
| `migrate` | (positional) | Copy all skills A→B, skip existing |
| `backup` | `--include-config` | Tar skills + optionally config |
| `restore` | `--to <agent>` | Restore to all or specific agent |
| `import` | `--to <dir>` | Copy to project skills dir |
| `undo` | none | Restore most recent snapshot |
| `snapshots` | none | List snapshots with timestamps |

## Sync Algorithm

```
simba sync
    │
    ├─► 1. Scan all detected agents for skills
    │       └─► Build map: skill_name → { agent → hash }
    │
    ├─► 2. Categorize each skill
    │       ├─► UNIQUE: exists in one agent only
    │       ├─► SYNCED: exists in multiple, hashes match
    │       └─► CONFLICT: exists in multiple, hashes differ
    │
    ├─► 3. Process by category
    │       ├─► UNIQUE: copy to all other agents
    │       ├─► SYNCED: no action
    │       └─► CONFLICT: prompt user
    │
    └─► 4. Update config with new hashes
```

### Conflict Resolution

```
⚠ Conflict: code-review
  claude:   sha256:aaa... (modified 2025-01-15)
  cursor:   sha256:bbb... (modified 2025-01-10)

  [1] Keep claude version (newer)
  [2] Keep cursor version
  [3] View diff
  [4] Skip (resolve later)
```

### Source Mode

```bash
simba sync --source claude  # one-way, claude wins all
```

## Hashing

Git-style tree hash:
1. Hash each file individually (SHA-256)
2. Sort filenames
3. Hash concatenated `filename:hash` pairs

```
SKILL.md        → sha256:aaa...
scripts/run.sh  → sha256:bbb...
tree_hash       → sha256("SKILL.md:aaa...\nscripts/run.sh:bbb...")
```

## TUI Dashboard

### Matrix View

```
┌─ simba ──────────────────────────────────────────────────────┐
│                                                              │
│  Skills                 Claude  Cursor  Codex  OpenCode      │
│  ─────────────────────────────────────────────────────────   │
│  pdf-processing           ✓       ✓       ✓       ✓         │
│  data-viz                 ✓       ✓       ─       ─         │
│► code-review              ✓       ⚠       ✓       ✓         │
│  git-workflow             ─       ✓       ─       ─         │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  ✓ synced   ⚠ conflict   ─ missing                          │
│  [s]ync  [d]etect  [b]ackup  [q]uit  [enter] resolve         │
└──────────────────────────────────────────────────────────────┘
```

### Diff View

```
┌─ code-review: claude ↔ cursor ───────────────────────────────┐
│  claude (2025-01-15)         │  cursor (2025-01-10)          │
│  ────────────────────────────│───────────────────────────    │
│  name: code-review           │  name: code-review            │
│  description: Review code    │  description: Review code     │
│    for bugs and style        │    for bugs                   │
│                              │                               │
│  ## Steps                    │  ## Steps                     │
│  1. Check for errors         │  1. Check for errors          │
│+ 2. Check style guidelines   │                               │
│  3. Suggest improvements     │  2. Suggest improvements      │
├──────────────────────────────────────────────────────────────┤
│  [1] keep claude  [2] keep cursor  [esc] back                │
└──────────────────────────────────────────────────────────────┘
```

### Keybindings

- `j/k` or arrows: navigate
- `enter`: view/resolve
- `s`: sync
- `d`: detect
- `b`: backup
- `q`: quit

## Snapshots & Undo

Auto-snapshot before destructive operations.

```
~/.config/simba/
├── config.toml
└── snapshots/
    ├── 2025-01-15T10-30-00/
    │   ├── manifest.json
    │   └── skills/
    │       └── code-review/
    └── 2025-01-15T09-00-00/
        └── ...
```

## Backup Format

```
simba-backup-2025-01-15T10-30-00.tar.gz
├── manifest.json
├── config.toml          # with --include-config
└── skills/
    ├── pdf-processing/
    │   └── SKILL.md
    └── code-review/
        ├── SKILL.md
        └── scripts/
```

### manifest.json

```json
{
  "version": "1",
  "created": "2025-01-15T10:30:00Z",
  "simba_version": "0.1.0",
  "source_agents": ["claude", "cursor", "opencode"],
  "skills": {
    "pdf-processing": {
      "hash": "sha256:aaa...",
      "origin": "claude",
      "files": ["SKILL.md"]
    }
  },
  "includes_config": false
}
```

## Agent Detection

```typescript
const AGENT_SIGNATURES = {
  claude: {
    global: ["~/.claude"],
    skills: "~/.claude/skills",
  },
  cursor: {
    global: ["~/.cursor"],
    skills: "~/.cursor/skills",
  },
  codex: {
    global: ["~/.codex"],
    skills: "~/.codex/skills",
  },
  opencode: {
    global: ["~/.config/opencode", "~/.opencode"],
    skills: "~/.config/opencode/skill",
  },
  antigravity: {
    global: ["~/.gemini"],
    skills: "~/.gemini/antigravity/skills",
  },
}
```

Detection: check if global dir exists → mark detected → scan skills dir.

Edge cases:
- Agent dir exists, skills dir doesn't → create on first sync
- Skill missing SKILL.md → warn, skip
- Unreadable permissions → warn, skip

## Project Structure

```
simba/
├── package.json
├── tsconfig.json
├── bunfig.toml
├── src/
│   ├── index.ts
│   ├── commands/
│   │   ├── detect.ts
│   │   ├── status.ts
│   │   ├── sync.ts
│   │   ├── migrate.ts
│   │   ├── backup.ts
│   │   ├── restore.ts
│   │   ├── import.ts
│   │   ├── undo.ts
│   │   ├── snapshots.ts
│   │   └── tui.ts
│   ├── core/
│   │   ├── agent-registry.ts
│   │   ├── skill-manager.ts
│   │   ├── config-store.ts
│   │   ├── snapshot.ts
│   │   └── types.ts
│   ├── tui/
│   │   ├── app.ts
│   │   ├── matrix-view.ts
│   │   ├── diff-view.ts
│   │   └── components/
│   └── utils/
│       ├── hash.ts
│       ├── fs.ts
│       └── paths.ts
├── tests/
└── docs/
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `citty` | CLI framework |
| `@opentui/core` | TUI rendering |
| `@opentui/solid` | TUI components |
| `smol-toml` | TOML parsing |
| `tar` | Backup archives |

## Out of Scope (v1)

- Skill discovery/registry
- Installing from URLs
- Version tracking/updates
- Project-level skill management (except `import`)
