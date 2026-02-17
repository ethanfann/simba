# PRD: Repository-as-a-Skill Support

**Date:** 2026-02-16

---

## Problem Statement

### What problem are we solving?
`simba install user/repo` silently fails (prints "No skills found in source.") when the repo IS the skill — i.e., `SKILL.md` lives at the repo root with no `skills/` subdirectory. This is an increasingly common pattern (e.g., `nicobailon/visual-explainer`) where authors publish a single skill as a standalone repo with `references/`, `scripts/`, `prompts/`, and `templates/` directories alongside `SKILL.md`.

`discoverSkills()` checks four discovery strategies — standard dirs, marketplace.json, submodule-as-skill, submodule standard dirs — but never checks the repo root itself for `SKILL.md`.

### Why now?
The "repo-as-skill" pattern is gaining traction in the Claude Code skill ecosystem. Every such repo is currently uninstallable via simba, pushing users to manual copying.

### Who is affected?
- **Primary users:** simba users installing standalone skill repos
- **Secondary users:** Skill authors who structure their repo as a single skill

---

## Proposed Solution

### Overview
Add a fifth discovery strategy to `discoverSkills()` that checks whether `basePath/SKILL.md` exists. If so, treat the entire `basePath` directory as a single skill. This runs as the **lowest-priority** strategy (last), so repos that have both a root `SKILL.md` and a `skills/` directory won't get double-counted.

### User Flow
1. User runs `simba install nicobailon/visual-explainer`
2. Simba clones the repo, calls `discoverSkills(tempDir)`
3. Strategies 1-4 find nothing (no `skills/`, no `marketplace.json`, no `.gitmodules`)
4. Strategy 5 detects `SKILL.md` at repo root
5. Skill name comes from frontmatter `name:` field, falls back to repo name
6. Entire repo root (including `references/`, `scripts/`, `prompts/`, `templates/`, etc.) is the skill directory
7. `relativePath` is set to `"."`
8. User selects/confirms, skill is copied to `~/.simba/skills/<name>/`
9. `installSource.skillPath` is stored as `"."` in registry
10. `simba update` re-clones, `discoverSkills` finds the root skill again, matches on `relativePath === "."`

---

## End State

When this PRD is complete, the following will be true:

- [ ] `discoverSkills()` detects `SKILL.md` at repo root as a valid skill
- [ ] Skill name derived from frontmatter `name:`, fallback to directory basename
- [ ] `relativePath` set to `"."` for root skills
- [ ] All subdirs (`references/`, `scripts/`, `prompts/`, `templates/`, etc.) included via existing recursive copy
- [ ] `simba update` correctly matches and updates root skills via `relativePath === "."`
- [ ] Deduplication: if strategies 1-4 already found skills, root `SKILL.md` is skipped (prevents double-counting repos that use root SKILL.md as a meta-doc)
- [ ] Tests cover root skill discovery, install, relativePath, and deduplication

---

## Acceptance Criteria

### Discovery
- [ ] `discoverSkills("/path/to/repo-with-root-SKILL.md")` returns 1 skill
- [ ] Name comes from frontmatter `name:` field when present
- [ ] Name falls back to last path component of `basePath` when frontmatter has no `name:`
- [ ] `relativePath` is `"."`
- [ ] Root `SKILL.md` is NOT discovered if strategies 1-4 already found skills (dedup guard)

### Install
- [ ] `simba install user/repo` works for repo-as-skill repos
- [ ] Entire directory (including `references/`, `scripts/`, etc.) is copied/symlinked
- [ ] `installSource.skillPath` stored as `"."` in registry
- [ ] `--skill <name>` flag works with repo-as-skill
- [ ] `--all` flag works with repo-as-skill

### Update
- [ ] `simba update` re-discovers root skill and matches on `relativePath === "."`
- [ ] Directory hash comparison detects changes in any file (SKILL.md, references/, etc.)

---

## Technical Context

### Existing Patterns
- `src/commands/install.ts:232-247` — Submodule-as-skill detection (same pattern: check root `SKILL.md`, read frontmatter). Direct model to follow.
- `src/commands/install.ts:203-277` — `discoverSkills()` with dedup via `seenNames` set

### Key Files
- `src/commands/install.ts` — `discoverSkills()` function, main change location
- `src/commands/update.ts` — Uses `discoverSkills()` + `relativePath` matching, no changes needed (already handles arbitrary relativePath values)
- `src/core/skills-store.ts` — `addSkill()` does recursive `cp`, no changes needed
- `tests/commands/install.test.ts` — Add new test cases

### Data Model Changes
None. `InstallSource.skillPath` already accepts arbitrary strings; `"."` is a valid value.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Repo has root SKILL.md AND skills/ dir (double-count) | Low | Med | Only check root if strategies 1-4 found 0 skills |
| Root dir contains .git/, node_modules/, etc. that shouldn't be copied | Med | Low | Existing behavior — `addSkill` copies everything recursively. Consider `.gitignore`-aware copy in future, but out of scope here |
| Repo name collision with existing installed skill | Low | Low | Already handled by existing overwrite-confirmation flow |

---

## Alternatives Considered

### Alternative 1: Check root SKILL.md at highest priority (first)
- **Pros:** Simple, always finds root skill
- **Cons:** Repos with both root SKILL.md and skills/ dir would only surface the root skill, hiding nested skills
- **Decision:** Rejected. Lowest priority + dedup guard is safer.

### Alternative 2: Explicit `--repo-as-skill` flag
- **Pros:** No ambiguity about intent
- **Cons:** Bad UX, user has to know repo structure beforehand
- **Decision:** Rejected. Auto-detection is better.

---

## Non-Goals (v1)

- `.gitignore`-aware copy (filtering out `.git/`, `node_modules/`, etc.) — future enhancement
- Validating or surfacing `references/`/`scripts/` directory structure — just copy as-is
- Supporting `SKILL.md` at arbitrary depth without a `skills/` parent — only root level

---

## CLI

No CLI changes. Existing `simba install <source>` and `simba update` commands work as-is.

---

## Open Questions

| Question | Status |
|----------|--------|
| Should `.git/` dir be excluded from copy? Currently copied as part of recursive cp. | Open |
