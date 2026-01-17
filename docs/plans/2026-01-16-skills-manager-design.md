# Simba Skills Manager Design

Transform Simba from a sync tool into a skills authority. Simba owns canonical skills; agents consume via symlinks.

## Core Architecture

### Storage

```
~/.config/simba/
├── skills/
│   ├── commit-helper/
│   │   ├── SKILL.md        # Required: name, description in frontmatter
│   │   └── ...
│   └── code-review/
└── registry.json
```

### Registry Schema

```json
{
  "skills": {
    "commit-helper": {
      "source": "adopted:claude",
      "installedAt": "2026-01-15T...",
      "assignments": {
        "claude": { "type": "directory" },
        "cursor": { "type": "file", "target": "rule.mdc" }
      }
    }
  }
}
```

### Symlink Model

Agent directories contain only symlinks to Simba's store:

```
~/.claude/skills/commit-helper -> ~/.config/simba/skills/commit-helper
~/.cursor/rules/code-review.mdc -> ~/.config/simba/skills/code-review/rule.mdc
```

Key invariant: After adoption, agent skill dirs should contain *only* Simba-managed symlinks.

## Commands

### `simba` (no args)

Opens matrix TUI for skill management.

```
┌─────────────────────────────────────────────────────────┐
│  Simba - Skills Manager                          [?] Help │
├─────────────────────────────────────────────────────────┤
│                     │ Claude │ Cursor │ Windsurf │ Codex │
│─────────────────────┼────────┼────────┼──────────┼───────│
│ commit-helper       │   ●    │   ●    │    ○     │   ○   │
│ code-review         │   ●    │   ○    │    ○     │   ○   │
│ test-runner         │   ○    │   ●    │    ●     │   ○   │
├─────────────────────────────────────────────────────────┤
│ [Space] Toggle  [a] Assign all  [n] None  [Enter] Edit  │
│ [/] Search  [i] Install  [d] Delete  [q] Quit           │
└─────────────────────────────────────────────────────────┘
```

Built with `terminal-kit`.

### `simba adopt`

Scan agents, adopt new skills into Simba's store.

1. Scan all detected agents for skills
2. Identify skills not yet in Simba's store
3. Detect duplicates (same name, different content across agents)
4. Resolve conflicts: show diff, user picks which version
5. Move to `~/.config/simba/skills/<name>/`
6. Replace originals with symlinks
7. Update registry (preserves original assignments)

Incremental: can re-run to adopt newly created skills.

### `simba install <source>`

Install skills from external sources.

```bash
simba install vercel-labs/agent-skills      # GitHub shorthand
simba install https://github.com/foo/bar    # Full URL
simba install ./local/path                  # Local directory
```

Process:
1. Clone repo (or read local path)
2. Find `SKILL.md` files with YAML frontmatter
3. Present multi-select via `@clack/prompts`
4. Copy to Simba's store
5. Prompt to assign to agents

### `simba doctor`

Verify symlink integrity.

```
$ simba doctor

✓ commit-helper
  ├─ Claude: OK
  └─ Cursor: OK

✗ code-review
  └─ Claude: BROKEN (target missing)

⚠ test-runner
  └─ Cursor: ROGUE (real file, not symlink)

Summary: 1 broken, 1 rogue, 10 healthy
Fix issues? [y/n]
```

Auto-fix:
- Broken symlinks: re-create
- Rogue files: offer to adopt or delete

### `simba assign <skill> <agents...>`

CLI shortcut for assignment.

```bash
simba assign commit-helper claude cursor
```

### `simba unassign <skill> <agents...>`

Remove assignments.

```bash
simba unassign commit-helper cursor
```

### `simba list`

Non-interactive list of skills with assignment status.

### Kept Commands

- `simba detect` - Show installed agents
- `simba backup` - Backs up `~/.config/simba/`
- `simba restore` - Restore from backup
- `simba snapshots` - List snapshots
- `simba undo` - Restore from snapshot

### Deprecated Commands

- `simba sync` - Replaced by symlink model
- `simba migrate` - Replaced by `adopt` + `assign`

## Agent-Specific Handling

| Agent | Skill Location | Symlink Type |
|-------|---------------|--------------|
| Claude | `~/.claude/skills/<name>/` | Directory |
| Cursor | `~/.cursor/rules/<name>.mdc` | File |
| Others | TBD per agent | Varies |

## Dependencies

- `terminal-kit` - Matrix TUI
- `simple-git` - Clone repos for install
- `gray-matter` - Parse SKILL.md frontmatter
- `@clack/prompts` - Already installed, for selections

## Edge Cases

- **Agent not installed:** Skip during assign, warn in doctor
- **Skill deleted outside Simba:** Doctor detects orphan symlinks
- **Permission errors:** Surface clearly with fix suggestions
- **Circular symlinks:** Validate on adopt
- **File vs directory agents:** Registry tracks per-agent symlink type
