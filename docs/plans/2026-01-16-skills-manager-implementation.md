# Skills Manager Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform Simba from a sync tool into a skills authority with symlink-based management and matrix TUI.

**Architecture:** Simba owns skills in `~/.config/simba/skills/`. Agents consume via symlinks. Registry tracks assignments. TUI provides matrix view.

**Tech Stack:** Bun, citty, terminal-kit, @clack/prompts, simple-git, gray-matter

---

## Task 1: Add Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Add new dependencies**

Run:
```bash
cd /home/ecfann/experiments/simba/.worktrees/skills-manager && bun add terminal-kit simple-git gray-matter
```

**Step 2: Add type dependencies**

Run:
```bash
bun add -d @types/gray-matter
```

**Step 3: Verify install**

Run: `bun install`
Expected: No errors

**Step 4: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore: add terminal-kit, simple-git, gray-matter deps"
```

---

## Task 2: Add Path Helpers

**Files:**
- Modify: `src/utils/paths.ts`
- Test: `src/utils/paths.test.ts`

**Step 1: Write failing test**

Create `src/utils/paths.test.ts`:

```typescript
import { test, expect, describe } from "bun:test"
import { getSkillsDir, getRegistryPath } from "./paths"
import { join } from "node:path"
import { homedir } from "node:os"

describe("paths", () => {
  test("getSkillsDir returns XDG-compliant path", () => {
    const expected = join(homedir(), ".config", "simba", "skills")
    expect(getSkillsDir()).toBe(expected)
  })

  test("getRegistryPath returns registry.json path", () => {
    const expected = join(homedir(), ".config", "simba", "registry.json")
    expect(getRegistryPath()).toBe(expected)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test src/utils/paths.test.ts`
Expected: FAIL - functions not defined

**Step 3: Implement functions**

Add to `src/utils/paths.ts`:

```typescript
export function getSkillsDir(): string {
  return join(getConfigDir(), "skills")
}

export function getRegistryPath(): string {
  return join(getConfigDir(), "registry.json")
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/utils/paths.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/paths.ts src/utils/paths.test.ts
git commit -m "feat: add getSkillsDir and getRegistryPath helpers"
```

---

## Task 3: Create Registry Types

**Files:**
- Modify: `src/core/types.ts`

**Step 1: Add registry types**

Add to `src/core/types.ts`:

```typescript
export interface SkillAssignment {
  type: "directory" | "file"
  target?: string  // For file type, which file to symlink (e.g., "rule.mdc")
}

export interface ManagedSkill {
  name: string
  source: string  // "adopted:claude", "installed:vercel-labs/agent-skills", etc.
  installedAt: string  // ISO date
  assignments: Record<string, SkillAssignment>  // agentId -> assignment
}

export interface Registry {
  version: 1
  skills: Record<string, ManagedSkill>
}
```

**Step 2: Commit**

```bash
git add src/core/types.ts
git commit -m "feat: add Registry and ManagedSkill types"
```

---

## Task 4: Create Registry Store

**Files:**
- Create: `src/core/registry-store.ts`
- Test: `src/core/registry-store.test.ts`

**Step 1: Write failing test**

Create `src/core/registry-store.test.ts`:

```typescript
import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { RegistryStore } from "./registry-store"

const testDir = join(tmpdir(), "simba-registry-test-" + Date.now())
const registryPath = join(testDir, "registry.json")

describe("RegistryStore", () => {
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("load returns empty registry when file missing", async () => {
    const store = new RegistryStore(registryPath)
    const registry = await store.load()
    expect(registry.version).toBe(1)
    expect(registry.skills).toEqual({})
  })

  test("save and load round-trips registry", async () => {
    const store = new RegistryStore(registryPath)
    const registry = {
      version: 1 as const,
      skills: {
        "test-skill": {
          name: "test-skill",
          source: "adopted:claude",
          installedAt: "2026-01-16T00:00:00Z",
          assignments: { claude: { type: "directory" as const } }
        }
      }
    }
    await store.save(registry)
    const loaded = await store.load()
    expect(loaded).toEqual(registry)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test src/core/registry-store.test.ts`
Expected: FAIL - module not found

**Step 3: Implement RegistryStore**

Create `src/core/registry-store.ts`:

```typescript
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import type { Registry } from "./types"

function createEmptyRegistry(): Registry {
  return { version: 1, skills: {} }
}

export class RegistryStore {
  constructor(private registryPath: string) {}

  async load(): Promise<Registry> {
    try {
      const content = await readFile(this.registryPath, "utf-8")
      return JSON.parse(content) as Registry
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return createEmptyRegistry()
      }
      throw err
    }
  }

  async save(registry: Registry): Promise<void> {
    await mkdir(dirname(this.registryPath), { recursive: true })
    await writeFile(this.registryPath, JSON.stringify(registry, null, 2))
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/core/registry-store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/registry-store.ts src/core/registry-store.test.ts
git commit -m "feat: add RegistryStore for managing skill assignments"
```

---

## Task 5: Create Symlink Utilities

**Files:**
- Create: `src/utils/symlinks.ts`
- Test: `src/utils/symlinks.test.ts`

**Step 1: Write failing test**

Create `src/utils/symlinks.test.ts`:

```typescript
import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, writeFile, readlink, lstat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createSymlink, isSymlink, removeSymlink, getSymlinkTarget } from "./symlinks"

const testDir = join(tmpdir(), "simba-symlink-test-" + Date.now())

describe("symlinks", () => {
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("createSymlink creates directory symlink", async () => {
    const source = join(testDir, "source")
    const target = join(testDir, "target")
    await mkdir(source)
    await writeFile(join(source, "file.txt"), "test")

    await createSymlink(source, target)

    const stat = await lstat(target)
    expect(stat.isSymbolicLink()).toBe(true)
    expect(await readlink(target)).toBe(source)
  })

  test("isSymlink returns true for symlinks", async () => {
    const source = join(testDir, "source")
    const target = join(testDir, "target")
    await mkdir(source)
    await createSymlink(source, target)

    expect(await isSymlink(target)).toBe(true)
  })

  test("isSymlink returns false for regular files", async () => {
    const file = join(testDir, "file.txt")
    await writeFile(file, "test")

    expect(await isSymlink(file)).toBe(false)
  })

  test("removeSymlink removes symlink", async () => {
    const source = join(testDir, "source")
    const target = join(testDir, "target")
    await mkdir(source)
    await createSymlink(source, target)

    await removeSymlink(target)

    expect(await isSymlink(target)).toBe(false)
  })

  test("getSymlinkTarget returns target path", async () => {
    const source = join(testDir, "source")
    const target = join(testDir, "target")
    await mkdir(source)
    await createSymlink(source, target)

    expect(await getSymlinkTarget(target)).toBe(source)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test src/utils/symlinks.test.ts`
Expected: FAIL - module not found

**Step 3: Implement symlink utilities**

Create `src/utils/symlinks.ts`:

```typescript
import { symlink, unlink, readlink, lstat, mkdir } from "node:fs/promises"
import { dirname } from "node:path"

export async function createSymlink(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  await symlink(source, target)
}

export async function isSymlink(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path)
    return stat.isSymbolicLink()
  } catch {
    return false
  }
}

export async function removeSymlink(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err
    }
  }
}

export async function getSymlinkTarget(path: string): Promise<string | null> {
  try {
    return await readlink(path)
  } catch {
    return null
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/utils/symlinks.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/symlinks.ts src/utils/symlinks.test.ts
git commit -m "feat: add symlink utility functions"
```

---

## Task 6: Create Skills Store

**Files:**
- Create: `src/core/skills-store.ts`
- Test: `src/core/skills-store.test.ts`

**Step 1: Write failing test**

Create `src/core/skills-store.test.ts`:

```typescript
import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, writeFile, readdir, readlink, lstat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { SkillsStore } from "./skills-store"

const testDir = join(tmpdir(), "simba-skills-store-test-" + Date.now())
const skillsDir = join(testDir, "skills")
const registryPath = join(testDir, "registry.json")
const agentDir = join(testDir, "agent-skills")

async function createSkill(dir: string, name: string, content: string = "# Test") {
  const skillDir = join(dir, name)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, "SKILL.md"), content)
}

describe("SkillsStore", () => {
  beforeEach(async () => {
    await mkdir(skillsDir, { recursive: true })
    await mkdir(agentDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("listSkills returns skills in store", async () => {
    await createSkill(skillsDir, "skill-a")
    await createSkill(skillsDir, "skill-b")

    const store = new SkillsStore(skillsDir, registryPath)
    const skills = await store.listSkills()

    expect(skills).toContain("skill-a")
    expect(skills).toContain("skill-b")
  })

  test("assignSkill creates symlink", async () => {
    await createSkill(skillsDir, "my-skill")

    const store = new SkillsStore(skillsDir, registryPath)
    await store.assignSkill("my-skill", agentDir, { type: "directory" })

    const symlinkPath = join(agentDir, "my-skill")
    const stat = await lstat(symlinkPath)
    expect(stat.isSymbolicLink()).toBe(true)
    expect(await readlink(symlinkPath)).toBe(join(skillsDir, "my-skill"))
  })

  test("unassignSkill removes symlink", async () => {
    await createSkill(skillsDir, "my-skill")
    const store = new SkillsStore(skillsDir, registryPath)
    await store.assignSkill("my-skill", agentDir, { type: "directory" })
    await store.unassignSkill("my-skill", agentDir)

    const entries = await readdir(agentDir)
    expect(entries).not.toContain("my-skill")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test src/core/skills-store.test.ts`
Expected: FAIL - module not found

**Step 3: Implement SkillsStore**

Create `src/core/skills-store.ts`:

```typescript
import { readdir, access, mkdir, cp, rm } from "node:fs/promises"
import { join } from "node:path"
import { createSymlink, removeSymlink } from "../utils/symlinks"
import type { SkillAssignment } from "./types"

export class SkillsStore {
  constructor(
    private skillsDir: string,
    private registryPath: string
  ) {}

  async ensureDir(): Promise<void> {
    await mkdir(this.skillsDir, { recursive: true })
  }

  async listSkills(): Promise<string[]> {
    try {
      const entries = await readdir(this.skillsDir, { withFileTypes: true })
      return entries.filter(e => e.isDirectory()).map(e => e.name)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return []
      }
      throw err
    }
  }

  async hasSkill(name: string): Promise<boolean> {
    try {
      await access(join(this.skillsDir, name))
      return true
    } catch {
      return false
    }
  }

  async addSkill(name: string, sourcePath: string): Promise<void> {
    await this.ensureDir()
    const destPath = join(this.skillsDir, name)
    await cp(sourcePath, destPath, { recursive: true })
  }

  async removeSkill(name: string): Promise<void> {
    const skillPath = join(this.skillsDir, name)
    await rm(skillPath, { recursive: true })
  }

  async assignSkill(
    name: string,
    agentSkillsDir: string,
    assignment: SkillAssignment
  ): Promise<void> {
    const sourcePath = join(this.skillsDir, name)

    if (assignment.type === "directory") {
      const targetPath = join(agentSkillsDir, name)
      await createSymlink(sourcePath, targetPath)
    } else {
      const sourceFile = join(sourcePath, assignment.target!)
      const targetPath = join(agentSkillsDir, `${name}.${assignment.target!.split(".").pop()}`)
      await createSymlink(sourceFile, targetPath)
    }
  }

  async unassignSkill(name: string, agentSkillsDir: string): Promise<void> {
    const targetPath = join(agentSkillsDir, name)
    await removeSymlink(targetPath)
  }

  getSkillPath(name: string): string {
    return join(this.skillsDir, name)
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/core/skills-store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/skills-store.ts src/core/skills-store.test.ts
git commit -m "feat: add SkillsStore for managing canonical skills"
```

---

## Task 7: Implement Adopt Command

**Files:**
- Create: `src/commands/adopt.ts`
- Test: `src/commands/adopt.test.ts`
- Modify: `src/index.ts`

**Step 1: Write failing test**

Create `src/commands/adopt.test.ts`:

```typescript
import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, writeFile, readdir, readlink, lstat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

const testDir = join(tmpdir(), "simba-adopt-test-" + Date.now())
const skillsDir = join(testDir, "skills")
const registryPath = join(testDir, "registry.json")
const configPath = join(testDir, "config.toml")
const claudeDir = join(testDir, "claude-skills")

async function createSkill(dir: string, name: string, content: string = "# Test") {
  const skillDir = join(dir, name)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, "SKILL.md"), content)
}

describe("adopt command", () => {
  beforeEach(async () => {
    await mkdir(skillsDir, { recursive: true })
    await mkdir(claudeDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("adopts skills from agent into store", async () => {
    await createSkill(claudeDir, "my-skill", "# My Skill")

    const { runAdopt } = await import("./adopt")

    await runAdopt({
      skillsDir,
      registryPath,
      configPath,
      agents: {
        claude: {
          id: "claude",
          name: "Claude",
          globalPath: claudeDir,
          projectPath: ".claude/skills",
          detected: true,
        }
      },
      dryRun: false,
      onConflict: async () => "claude",
    })

    // Skill should be in store
    const storeSkills = await readdir(skillsDir)
    expect(storeSkills).toContain("my-skill")

    // Original should be replaced with symlink
    const stat = await lstat(join(claudeDir, "my-skill"))
    expect(stat.isSymbolicLink()).toBe(true)
    expect(await readlink(join(claudeDir, "my-skill"))).toBe(join(skillsDir, "my-skill"))
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test src/commands/adopt.test.ts`
Expected: FAIL - module not found

**Step 3: Implement adopt command**

Create `src/commands/adopt.ts`:

```typescript
import { defineCommand } from "citty"
import { readdir, rm, access } from "node:fs/promises"
import { join } from "node:path"
import * as p from "@clack/prompts"
import { ConfigStore } from "../core/config-store"
import { RegistryStore } from "../core/registry-store"
import { SkillsStore } from "../core/skills-store"
import { AgentRegistry } from "../core/agent-registry"
import { getConfigPath, getSkillsDir, getRegistryPath } from "../utils/paths"
import { isSymlink, createSymlink } from "../utils/symlinks"
import type { Agent, ManagedSkill } from "../core/types"

export interface AdoptOptions {
  skillsDir: string
  registryPath: string
  configPath: string
  agents: Record<string, Agent>
  dryRun: boolean
  onConflict: (skillName: string, agents: string[]) => Promise<string>
}

interface DiscoveredSkill {
  name: string
  agentId: string
  path: string
}

export async function runAdopt(options: AdoptOptions): Promise<void> {
  const skillsStore = new SkillsStore(options.skillsDir, options.registryPath)
  const registryStore = new RegistryStore(options.registryPath)
  const registry = await registryStore.load()

  // Discover skills from all agents
  const discovered: DiscoveredSkill[] = []
  for (const [agentId, agent] of Object.entries(options.agents)) {
    if (!agent.detected) continue

    try {
      const entries = await readdir(agent.globalPath, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const skillPath = join(agent.globalPath, entry.name)

        // Skip if already a symlink (already adopted)
        if (await isSymlink(skillPath)) continue

        // Check for SKILL.md
        try {
          await access(join(skillPath, "SKILL.md"))
        } catch {
          continue
        }

        discovered.push({
          name: entry.name,
          agentId,
          path: skillPath,
        })
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err
      }
    }
  }

  // Group by skill name to detect conflicts
  const byName = new Map<string, DiscoveredSkill[]>()
  for (const skill of discovered) {
    if (!byName.has(skill.name)) {
      byName.set(skill.name, [])
    }
    byName.get(skill.name)!.push(skill)
  }

  // Filter out already-adopted skills
  const toAdopt: Array<{ name: string; skill: DiscoveredSkill }> = []
  for (const [name, skills] of byName) {
    if (await skillsStore.hasSkill(name)) {
      console.log(`  Skipping ${name} (already in store)`)
      continue
    }

    if (skills.length === 1) {
      toAdopt.push({ name, skill: skills[0] })
    } else {
      // Conflict - ask user
      const chosenAgent = await options.onConflict(name, skills.map(s => s.agentId))
      const chosen = skills.find(s => s.agentId === chosenAgent)!
      toAdopt.push({ name, skill: chosen })
    }
  }

  if (toAdopt.length === 0) {
    console.log("\nNo new skills to adopt.")
    return
  }

  console.log(`\nAdopting ${toAdopt.length} skills...`)

  if (options.dryRun) {
    for (const { name, skill } of toAdopt) {
      console.log(`  Would adopt: ${name} (from ${skill.agentId})`)
    }
    console.log("\n(dry run - no changes made)")
    return
  }

  // Adopt each skill
  for (const { name, skill } of toAdopt) {
    // Copy to store
    await skillsStore.addSkill(name, skill.path)

    // Remove original and create symlink
    await rm(skill.path, { recursive: true })
    await createSymlink(join(options.skillsDir, name), skill.path)

    // Update registry
    const managedSkill: ManagedSkill = {
      name,
      source: `adopted:${skill.agentId}`,
      installedAt: new Date().toISOString(),
      assignments: {
        [skill.agentId]: { type: "directory" }
      }
    }
    registry.skills[name] = managedSkill

    console.log(`  Adopted: ${name} (from ${skill.agentId})`)
  }

  await registryStore.save(registry)
  console.log("\nAdoption complete!")
}

export default defineCommand({
  meta: {
    name: "adopt",
    description: "Adopt skills from agents into Simba's store",
  },
  args: {
    dryRun: {
      type: "boolean",
      alias: "n",
      description: "Preview changes without applying",
      default: false,
    },
  },
  async run({ args }) {
    const configStore = new ConfigStore(getConfigPath())
    const config = await configStore.load()

    const agentRegistry = new AgentRegistry(config.agents)
    const detected = await agentRegistry.detectAgents()

    const detectedAgents = Object.fromEntries(
      Object.entries(detected).filter(([, a]) => a.detected)
    )

    if (Object.keys(detectedAgents).length === 0) {
      console.log("No agents detected. Run 'simba detect' first.")
      return
    }

    console.log("\nScanning agents for skills...")
    for (const [id, agent] of Object.entries(detectedAgents)) {
      console.log(`  ${agent.name}`)
    }

    await runAdopt({
      skillsDir: getSkillsDir(),
      registryPath: getRegistryPath(),
      configPath: getConfigPath(),
      agents: detectedAgents,
      dryRun: args.dryRun,
      onConflict: async (skillName, agents) => {
        const result = await p.select({
          message: `Conflict: "${skillName}" exists in multiple agents. Which version?`,
          options: agents.map(a => ({ value: a, label: a })),
        })
        if (p.isCancel(result)) {
          process.exit(0)
        }
        return result as string
      },
    })
  },
})
```

**Step 4: Run test to verify it passes**

Run: `bun test src/commands/adopt.test.ts`
Expected: PASS

**Step 5: Add to index.ts**

In `src/index.ts`, add to subCommands:

```typescript
adopt: () => import("./commands/adopt").then((m) => m.default),
```

**Step 6: Run all tests**

Run: `bun test`
Expected: All tests pass

**Step 7: Commit**

```bash
git add src/commands/adopt.ts src/commands/adopt.test.ts src/index.ts
git commit -m "feat: implement adopt command for skill migration"
```

---

## Task 8: Implement Doctor Command

**Files:**
- Create: `src/commands/doctor.ts`
- Test: `src/commands/doctor.test.ts`
- Modify: `src/index.ts`

**Step 1: Write failing test**

Create `src/commands/doctor.test.ts`:

```typescript
import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, writeFile, symlink } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

const testDir = join(tmpdir(), "simba-doctor-test-" + Date.now())
const skillsDir = join(testDir, "skills")
const registryPath = join(testDir, "registry.json")
const claudeDir = join(testDir, "claude-skills")

async function createSkill(dir: string, name: string) {
  const skillDir = join(dir, name)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, "SKILL.md"), "# Test")
}

describe("doctor command", () => {
  beforeEach(async () => {
    await mkdir(skillsDir, { recursive: true })
    await mkdir(claudeDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("detects healthy symlinks", async () => {
    await createSkill(skillsDir, "my-skill")
    await symlink(join(skillsDir, "my-skill"), join(claudeDir, "my-skill"))

    const registry = {
      version: 1,
      skills: {
        "my-skill": {
          name: "my-skill",
          source: "adopted:claude",
          installedAt: "2026-01-16T00:00:00Z",
          assignments: { claude: { type: "directory" } }
        }
      }
    }
    await writeFile(registryPath, JSON.stringify(registry))

    const { runDoctor } = await import("./doctor")
    const results = await runDoctor({
      skillsDir,
      registryPath,
      agents: {
        claude: {
          id: "claude",
          name: "Claude",
          globalPath: claudeDir,
          projectPath: ".claude/skills",
          detected: true,
        }
      }
    })

    expect(results.healthy).toContain("my-skill")
    expect(results.broken.length).toBe(0)
    expect(results.rogue.length).toBe(0)
  })

  test("detects broken symlinks", async () => {
    // Create symlink to non-existent target
    await symlink(join(skillsDir, "missing-skill"), join(claudeDir, "missing-skill"))

    const registry = {
      version: 1,
      skills: {
        "missing-skill": {
          name: "missing-skill",
          source: "adopted:claude",
          installedAt: "2026-01-16T00:00:00Z",
          assignments: { claude: { type: "directory" } }
        }
      }
    }
    await writeFile(registryPath, JSON.stringify(registry))

    const { runDoctor } = await import("./doctor")
    const results = await runDoctor({
      skillsDir,
      registryPath,
      agents: {
        claude: {
          id: "claude",
          name: "Claude",
          globalPath: claudeDir,
          projectPath: ".claude/skills",
          detected: true,
        }
      }
    })

    expect(results.broken.some(b => b.skill === "missing-skill")).toBe(true)
  })

  test("detects rogue files", async () => {
    await createSkill(skillsDir, "my-skill")
    // Create real directory instead of symlink
    await createSkill(claudeDir, "my-skill")

    const registry = {
      version: 1,
      skills: {
        "my-skill": {
          name: "my-skill",
          source: "adopted:claude",
          installedAt: "2026-01-16T00:00:00Z",
          assignments: { claude: { type: "directory" } }
        }
      }
    }
    await writeFile(registryPath, JSON.stringify(registry))

    const { runDoctor } = await import("./doctor")
    const results = await runDoctor({
      skillsDir,
      registryPath,
      agents: {
        claude: {
          id: "claude",
          name: "Claude",
          globalPath: claudeDir,
          projectPath: ".claude/skills",
          detected: true,
        }
      }
    })

    expect(results.rogue.some(r => r.skill === "my-skill")).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test src/commands/doctor.test.ts`
Expected: FAIL - module not found

**Step 3: Implement doctor command**

Create `src/commands/doctor.ts`:

```typescript
import { defineCommand } from "citty"
import { access } from "node:fs/promises"
import { join } from "node:path"
import * as p from "@clack/prompts"
import { ConfigStore } from "../core/config-store"
import { RegistryStore } from "../core/registry-store"
import { AgentRegistry } from "../core/agent-registry"
import { getConfigPath, getSkillsDir, getRegistryPath } from "../utils/paths"
import { isSymlink, getSymlinkTarget, createSymlink, removeSymlink } from "../utils/symlinks"
import { expandPath } from "../utils/paths"
import type { Agent } from "../core/types"

interface BrokenLink {
  skill: string
  agent: string
  path: string
  reason: string
}

interface RogueFile {
  skill: string
  agent: string
  path: string
}

export interface DoctorResults {
  healthy: string[]
  broken: BrokenLink[]
  rogue: RogueFile[]
}

export interface DoctorOptions {
  skillsDir: string
  registryPath: string
  agents: Record<string, Agent>
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorResults> {
  const registryStore = new RegistryStore(options.registryPath)
  const registry = await registryStore.load()

  const results: DoctorResults = {
    healthy: [],
    broken: [],
    rogue: [],
  }

  for (const [skillName, skill] of Object.entries(registry.skills)) {
    let skillHealthy = true

    for (const [agentId, assignment] of Object.entries(skill.assignments)) {
      const agent = options.agents[agentId]
      if (!agent || !agent.detected) continue

      const agentSkillsDir = expandPath(agent.globalPath)
      const expectedPath = join(agentSkillsDir, skillName)
      const expectedTarget = join(options.skillsDir, skillName)

      // Check if path exists
      const pathIsSymlink = await isSymlink(expectedPath)

      if (!pathIsSymlink) {
        // Check if it's a real file/directory
        try {
          await access(expectedPath)
          // It exists but is not a symlink - rogue
          results.rogue.push({
            skill: skillName,
            agent: agentId,
            path: expectedPath,
          })
          skillHealthy = false
        } catch {
          // Doesn't exist at all - broken
          results.broken.push({
            skill: skillName,
            agent: agentId,
            path: expectedPath,
            reason: "symlink missing",
          })
          skillHealthy = false
        }
        continue
      }

      // It is a symlink - check target
      const target = await getSymlinkTarget(expectedPath)

      // Check if target exists
      try {
        await access(target!)
      } catch {
        results.broken.push({
          skill: skillName,
          agent: agentId,
          path: expectedPath,
          reason: "target missing",
        })
        skillHealthy = false
        continue
      }

      // Check if target is correct
      if (target !== expectedTarget) {
        results.broken.push({
          skill: skillName,
          agent: agentId,
          path: expectedPath,
          reason: `wrong target: ${target}`,
        })
        skillHealthy = false
      }
    }

    if (skillHealthy) {
      results.healthy.push(skillName)
    }
  }

  return results
}

export default defineCommand({
  meta: {
    name: "doctor",
    description: "Verify symlink integrity",
  },
  args: {
    fix: {
      type: "boolean",
      description: "Automatically fix issues",
      default: false,
    },
  },
  async run({ args }) {
    const configStore = new ConfigStore(getConfigPath())
    const config = await configStore.load()

    const agentRegistry = new AgentRegistry(config.agents)
    const detected = await agentRegistry.detectAgents()

    console.log("\nChecking symlink integrity...\n")

    const results = await runDoctor({
      skillsDir: getSkillsDir(),
      registryPath: getRegistryPath(),
      agents: detected,
    })

    // Print results
    for (const skill of results.healthy) {
      console.log(`✓ ${skill}`)
    }

    for (const broken of results.broken) {
      console.log(`✗ ${broken.skill}`)
      console.log(`  └─ ${broken.agent}: BROKEN (${broken.reason})`)
    }

    for (const rogue of results.rogue) {
      console.log(`⚠ ${rogue.skill}`)
      console.log(`  └─ ${rogue.agent}: ROGUE (real file, not symlink)`)
    }

    console.log(`\nSummary: ${results.broken.length} broken, ${results.rogue.length} rogue, ${results.healthy.length} healthy`)

    if (results.broken.length === 0 && results.rogue.length === 0) {
      console.log("\nAll symlinks healthy!")
      return
    }

    if (!args.fix) {
      const shouldFix = await p.confirm({
        message: "Fix issues?",
      })
      if (p.isCancel(shouldFix) || !shouldFix) {
        return
      }
    }

    // Fix broken symlinks
    for (const broken of results.broken) {
      const agent = detected[broken.agent]
      if (!agent) continue

      const expectedTarget = join(getSkillsDir(), broken.skill)
      await removeSymlink(broken.path)
      await createSymlink(expectedTarget, broken.path)
      console.log(`Fixed: ${broken.skill} (${broken.agent})`)
    }

    console.log("\nRepairs complete!")
  },
})
```

**Step 4: Run test to verify it passes**

Run: `bun test src/commands/doctor.test.ts`
Expected: PASS

**Step 5: Add to index.ts**

In `src/index.ts`, add to subCommands:

```typescript
doctor: () => import("./commands/doctor").then((m) => m.default),
```

**Step 6: Commit**

```bash
git add src/commands/doctor.ts src/commands/doctor.test.ts src/index.ts
git commit -m "feat: implement doctor command for symlink verification"
```

---

## Task 9: Implement Install Command

**Files:**
- Create: `src/commands/install.ts`
- Test: `src/commands/install.test.ts`
- Modify: `src/index.ts`

**Step 1: Write failing test**

Create `src/commands/install.test.ts`:

```typescript
import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, writeFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

const testDir = join(tmpdir(), "simba-install-test-" + Date.now())
const skillsDir = join(testDir, "skills")
const registryPath = join(testDir, "registry.json")
const sourceDir = join(testDir, "source-repo")

async function createSourceSkill(name: string, content: string = "---\nname: test\ndescription: test skill\n---\n# Test") {
  const skillDir = join(sourceDir, "skills", name)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, "SKILL.md"), content)
}

describe("install command", () => {
  beforeEach(async () => {
    await mkdir(skillsDir, { recursive: true })
    await mkdir(sourceDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("installs skill from local path", async () => {
    await createSourceSkill("cool-skill")

    const { runInstall } = await import("./install")

    await runInstall({
      source: sourceDir,
      skillsDir,
      registryPath,
      onSelect: async (skills) => skills.map(s => s.name),
    })

    const installed = await readdir(skillsDir)
    expect(installed).toContain("cool-skill")
  })

  test("discovers skills in standard locations", async () => {
    await createSourceSkill("skill-a")
    await createSourceSkill("skill-b")

    const { discoverSkills } = await import("./install")
    const skills = await discoverSkills(sourceDir)

    expect(skills.length).toBe(2)
    expect(skills.map(s => s.name)).toContain("skill-a")
    expect(skills.map(s => s.name)).toContain("skill-b")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test src/commands/install.test.ts`
Expected: FAIL - module not found

**Step 3: Implement install command**

Create `src/commands/install.ts`:

```typescript
import { defineCommand } from "citty"
import { readdir, access, readFile } from "node:fs/promises"
import { join, basename } from "node:path"
import * as p from "@clack/prompts"
import matter from "gray-matter"
import simpleGit from "simple-git"
import { tmpdir } from "node:os"
import { mkdir, rm } from "node:fs/promises"
import { RegistryStore } from "../core/registry-store"
import { SkillsStore } from "../core/skills-store"
import { getSkillsDir, getRegistryPath } from "../utils/paths"
import type { ManagedSkill } from "../core/types"

interface DiscoveredSkill {
  name: string
  path: string
  description?: string
}

const SKILL_DIRS = ["skills", ".claude/skills", ".cursor/skills", ".codex/skills"]

export async function discoverSkills(basePath: string): Promise<DiscoveredSkill[]> {
  const skills: DiscoveredSkill[] = []

  for (const dir of SKILL_DIRS) {
    const skillsPath = join(basePath, dir)
    try {
      const entries = await readdir(skillsPath, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const skillPath = join(skillsPath, entry.name)
        const skillMdPath = join(skillPath, "SKILL.md")

        try {
          await access(skillMdPath)
          const content = await readFile(skillMdPath, "utf-8")
          const { data } = matter(content)

          skills.push({
            name: entry.name,
            path: skillPath,
            description: data.description,
          })
        } catch {
          continue
        }
      }
    } catch {
      continue
    }
  }

  return skills
}

export interface InstallOptions {
  source: string
  skillsDir: string
  registryPath: string
  onSelect: (skills: DiscoveredSkill[]) => Promise<string[]>
}

export async function runInstall(options: InstallOptions): Promise<void> {
  const skillsStore = new SkillsStore(options.skillsDir, options.registryPath)
  const registryStore = new RegistryStore(options.registryPath)
  const registry = await registryStore.load()

  let sourcePath = options.source
  let isTemp = false

  // Check if it's a git URL or GitHub shorthand
  if (options.source.includes("/") && !options.source.startsWith("/") && !options.source.startsWith(".")) {
    const url = options.source.includes("://")
      ? options.source
      : `https://github.com/${options.source}`

    const tempDir = join(tmpdir(), `simba-install-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
    isTemp = true

    console.log(`Cloning ${url}...`)
    const git = simpleGit()
    await git.clone(url, tempDir, ["--depth", "1"])
    sourcePath = tempDir
  }

  try {
    const discovered = await discoverSkills(sourcePath)

    if (discovered.length === 0) {
      console.log("No skills found in source.")
      return
    }

    console.log(`\nFound ${discovered.length} skills:`)
    for (const skill of discovered) {
      console.log(`  • ${skill.name}${skill.description ? ` - ${skill.description}` : ""}`)
    }

    const selected = await options.onSelect(discovered)

    if (selected.length === 0) {
      console.log("No skills selected.")
      return
    }

    for (const name of selected) {
      const skill = discovered.find(s => s.name === name)!

      if (await skillsStore.hasSkill(name)) {
        console.log(`  Skipping ${name} (already installed)`)
        continue
      }

      await skillsStore.addSkill(name, skill.path)

      const managedSkill: ManagedSkill = {
        name,
        source: `installed:${options.source}`,
        installedAt: new Date().toISOString(),
        assignments: {}
      }
      registry.skills[name] = managedSkill

      console.log(`  Installed: ${name}`)
    }

    await registryStore.save(registry)
    console.log("\nInstallation complete!")
  } finally {
    if (isTemp) {
      await rm(sourcePath, { recursive: true, force: true })
    }
  }
}

export default defineCommand({
  meta: {
    name: "install",
    description: "Install skills from GitHub or local path",
  },
  args: {
    source: {
      type: "positional",
      description: "GitHub repo (user/repo) or local path",
      required: true,
    },
  },
  async run({ args }) {
    await runInstall({
      source: args.source,
      skillsDir: getSkillsDir(),
      registryPath: getRegistryPath(),
      onSelect: async (skills) => {
        const result = await p.multiselect({
          message: "Select skills to install:",
          options: skills.map(s => ({
            value: s.name,
            label: s.name,
            hint: s.description,
          })),
        })

        if (p.isCancel(result)) {
          process.exit(0)
        }

        return result as string[]
      },
    })
  },
})
```

**Step 4: Run test to verify it passes**

Run: `bun test src/commands/install.test.ts`
Expected: PASS

**Step 5: Add to index.ts**

In `src/index.ts`, add to subCommands:

```typescript
install: () => import("./commands/install").then((m) => m.default),
```

**Step 6: Commit**

```bash
git add src/commands/install.ts src/commands/install.test.ts src/index.ts
git commit -m "feat: implement install command for external skills"
```

---

## Task 10: Implement Assign/Unassign Commands

**Files:**
- Create: `src/commands/assign.ts`
- Create: `src/commands/unassign.ts`
- Test: `src/commands/assign.test.ts`
- Modify: `src/index.ts`

**Step 1: Write failing test**

Create `src/commands/assign.test.ts`:

```typescript
import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, writeFile, readlink, lstat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

const testDir = join(tmpdir(), "simba-assign-test-" + Date.now())
const skillsDir = join(testDir, "skills")
const registryPath = join(testDir, "registry.json")
const claudeDir = join(testDir, "claude-skills")

async function createSkill(dir: string, name: string) {
  const skillDir = join(dir, name)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, "SKILL.md"), "# Test")
}

describe("assign command", () => {
  beforeEach(async () => {
    await mkdir(skillsDir, { recursive: true })
    await mkdir(claudeDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("assigns skill to agent", async () => {
    await createSkill(skillsDir, "my-skill")

    const registry = {
      version: 1,
      skills: {
        "my-skill": {
          name: "my-skill",
          source: "adopted:cursor",
          installedAt: "2026-01-16T00:00:00Z",
          assignments: {}
        }
      }
    }
    await writeFile(registryPath, JSON.stringify(registry))

    const { runAssign } = await import("./assign")
    await runAssign({
      skill: "my-skill",
      agents: ["claude"],
      skillsDir,
      registryPath,
      agentPaths: { claude: claudeDir }
    })

    const stat = await lstat(join(claudeDir, "my-skill"))
    expect(stat.isSymbolicLink()).toBe(true)
  })

  test("unassigns skill from agent", async () => {
    await createSkill(skillsDir, "my-skill")

    const registry = {
      version: 1,
      skills: {
        "my-skill": {
          name: "my-skill",
          source: "adopted:claude",
          installedAt: "2026-01-16T00:00:00Z",
          assignments: { claude: { type: "directory" } }
        }
      }
    }
    await writeFile(registryPath, JSON.stringify(registry))

    // Create symlink first
    const { runAssign } = await import("./assign")
    await runAssign({
      skill: "my-skill",
      agents: ["claude"],
      skillsDir,
      registryPath,
      agentPaths: { claude: claudeDir }
    })

    const { runUnassign } = await import("./unassign")
    await runUnassign({
      skill: "my-skill",
      agents: ["claude"],
      skillsDir,
      registryPath,
      agentPaths: { claude: claudeDir }
    })

    let exists = true
    try {
      await lstat(join(claudeDir, "my-skill"))
    } catch {
      exists = false
    }
    expect(exists).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test src/commands/assign.test.ts`
Expected: FAIL - module not found

**Step 3: Implement assign command**

Create `src/commands/assign.ts`:

```typescript
import { defineCommand } from "citty"
import { RegistryStore } from "../core/registry-store"
import { SkillsStore } from "../core/skills-store"
import { ConfigStore } from "../core/config-store"
import { getSkillsDir, getRegistryPath, getConfigPath, expandPath } from "../utils/paths"

export interface AssignOptions {
  skill: string
  agents: string[]
  skillsDir: string
  registryPath: string
  agentPaths: Record<string, string>
}

export async function runAssign(options: AssignOptions): Promise<void> {
  const skillsStore = new SkillsStore(options.skillsDir, options.registryPath)
  const registryStore = new RegistryStore(options.registryPath)
  const registry = await registryStore.load()

  const skill = registry.skills[options.skill]
  if (!skill) {
    console.error(`Skill not found: ${options.skill}`)
    process.exit(1)
  }

  for (const agentId of options.agents) {
    const agentPath = options.agentPaths[agentId]
    if (!agentPath) {
      console.error(`Unknown agent: ${agentId}`)
      continue
    }

    await skillsStore.assignSkill(options.skill, agentPath, { type: "directory" })
    skill.assignments[agentId] = { type: "directory" }
    console.log(`Assigned ${options.skill} to ${agentId}`)
  }

  await registryStore.save(registry)
}

export default defineCommand({
  meta: {
    name: "assign",
    description: "Assign a skill to agents",
  },
  args: {
    skill: {
      type: "positional",
      description: "Skill name",
      required: true,
    },
    agents: {
      type: "positional",
      description: "Agent IDs",
      required: true,
    },
  },
  async run({ args }) {
    const configStore = new ConfigStore(getConfigPath())
    const config = await configStore.load()

    const agentPaths: Record<string, string> = {}
    for (const [id, agent] of Object.entries(config.agents)) {
      if (agent.detected) {
        agentPaths[id] = expandPath(agent.globalPath)
      }
    }

    const agents = (args.agents as string).split(",").map(a => a.trim())

    await runAssign({
      skill: args.skill,
      agents,
      skillsDir: getSkillsDir(),
      registryPath: getRegistryPath(),
      agentPaths,
    })
  },
})
```

**Step 4: Implement unassign command**

Create `src/commands/unassign.ts`:

```typescript
import { defineCommand } from "citty"
import { RegistryStore } from "../core/registry-store"
import { SkillsStore } from "../core/skills-store"
import { ConfigStore } from "../core/config-store"
import { getSkillsDir, getRegistryPath, getConfigPath, expandPath } from "../utils/paths"

export interface UnassignOptions {
  skill: string
  agents: string[]
  skillsDir: string
  registryPath: string
  agentPaths: Record<string, string>
}

export async function runUnassign(options: UnassignOptions): Promise<void> {
  const skillsStore = new SkillsStore(options.skillsDir, options.registryPath)
  const registryStore = new RegistryStore(options.registryPath)
  const registry = await registryStore.load()

  const skill = registry.skills[options.skill]
  if (!skill) {
    console.error(`Skill not found: ${options.skill}`)
    process.exit(1)
  }

  for (const agentId of options.agents) {
    const agentPath = options.agentPaths[agentId]
    if (!agentPath) {
      console.error(`Unknown agent: ${agentId}`)
      continue
    }

    await skillsStore.unassignSkill(options.skill, agentPath)
    delete skill.assignments[agentId]
    console.log(`Unassigned ${options.skill} from ${agentId}`)
  }

  await registryStore.save(registry)
}

export default defineCommand({
  meta: {
    name: "unassign",
    description: "Remove a skill from agents",
  },
  args: {
    skill: {
      type: "positional",
      description: "Skill name",
      required: true,
    },
    agents: {
      type: "positional",
      description: "Agent IDs",
      required: true,
    },
  },
  async run({ args }) {
    const configStore = new ConfigStore(getConfigPath())
    const config = await configStore.load()

    const agentPaths: Record<string, string> = {}
    for (const [id, agent] of Object.entries(config.agents)) {
      if (agent.detected) {
        agentPaths[id] = expandPath(agent.globalPath)
      }
    }

    const agents = (args.agents as string).split(",").map(a => a.trim())

    await runUnassign({
      skill: args.skill,
      agents,
      skillsDir: getSkillsDir(),
      registryPath: getRegistryPath(),
      agentPaths,
    })
  },
})
```

**Step 5: Run test to verify it passes**

Run: `bun test src/commands/assign.test.ts`
Expected: PASS

**Step 6: Add to index.ts**

In `src/index.ts`, add to subCommands:

```typescript
assign: () => import("./commands/assign").then((m) => m.default),
unassign: () => import("./commands/unassign").then((m) => m.default),
```

**Step 7: Commit**

```bash
git add src/commands/assign.ts src/commands/unassign.ts src/commands/assign.test.ts src/index.ts
git commit -m "feat: implement assign and unassign commands"
```

---

## Task 11: Implement List Command

**Files:**
- Create: `src/commands/list.ts`
- Modify: `src/index.ts`

**Step 1: Implement list command**

Create `src/commands/list.ts`:

```typescript
import { defineCommand } from "citty"
import { RegistryStore } from "../core/registry-store"
import { ConfigStore } from "../core/config-store"
import { getRegistryPath, getConfigPath } from "../utils/paths"

export default defineCommand({
  meta: {
    name: "list",
    description: "List all managed skills",
  },
  async run() {
    const registryStore = new RegistryStore(getRegistryPath())
    const registry = await registryStore.load()

    const configStore = new ConfigStore(getConfigPath())
    const config = await configStore.load()

    const skills = Object.values(registry.skills)

    if (skills.length === 0) {
      console.log("No skills managed. Run 'simba adopt' to get started.")
      return
    }

    console.log("\nManaged skills:\n")

    for (const skill of skills) {
      const assignments = Object.keys(skill.assignments)
      const agentNames = assignments.map(id => config.agents[id]?.name || id)

      console.log(`  ${skill.name}`)
      if (agentNames.length > 0) {
        console.log(`    └─ ${agentNames.join(", ")}`)
      } else {
        console.log(`    └─ (not assigned)`)
      }
    }

    console.log(`\nTotal: ${skills.length} skills`)
  },
})
```

**Step 2: Add to index.ts**

In `src/index.ts`, add to subCommands:

```typescript
list: () => import("./commands/list").then((m) => m.default),
```

**Step 3: Commit**

```bash
git add src/commands/list.ts src/index.ts
git commit -m "feat: implement list command"
```

---

## Task 12: Implement Matrix TUI

**Files:**
- Create: `src/tui/matrix.ts`
- Create: `src/commands/manage.ts`
- Modify: `src/index.ts`

**Step 1: Implement matrix TUI**

Create `src/tui/matrix.ts`:

```typescript
import termkit from "terminal-kit"
import { RegistryStore } from "../core/registry-store"
import { SkillsStore } from "../core/skills-store"
import { ConfigStore } from "../core/config-store"
import { getRegistryPath, getSkillsDir, getConfigPath, expandPath } from "../utils/paths"
import type { Agent, Registry } from "../core/types"

const term = termkit.terminal

interface MatrixState {
  skills: string[]
  agents: Agent[]
  registry: Registry
  cursorRow: number
  cursorCol: number
}

export async function runMatrixTUI(): Promise<void> {
  const registryStore = new RegistryStore(getRegistryPath())
  const registry = await registryStore.load()

  const configStore = new ConfigStore(getConfigPath())
  const config = await configStore.load()

  const skillsStore = new SkillsStore(getSkillsDir(), getRegistryPath())

  const detectedAgents = Object.values(config.agents).filter(a => a.detected)
  const skills = Object.keys(registry.skills)

  if (skills.length === 0) {
    term.yellow("\nNo skills managed yet. Run 'simba adopt' first.\n")
    process.exit(0)
  }

  const state: MatrixState = {
    skills,
    agents: detectedAgents,
    registry,
    cursorRow: 0,
    cursorCol: 0,
  }

  term.clear()
  term.hideCursor()

  const render = () => {
    term.moveTo(1, 1)
    term.eraseLine()
    term.bold.cyan("Simba - Skills Manager")
    term("                              ")
    term.dim("[?] Help\n\n")

    // Header row
    term("                     ")
    for (let i = 0; i < state.agents.length; i++) {
      const agent = state.agents[i]
      const name = agent.name.slice(0, 8).padEnd(10)
      if (i === state.cursorCol && state.cursorRow === -1) {
        term.bgWhite.black(name)
      } else {
        term.bold(name)
      }
    }
    term("\n")
    term("─".repeat(21 + state.agents.length * 10) + "\n")

    // Skill rows
    for (let row = 0; row < state.skills.length; row++) {
      const skillName = state.skills[row]
      const skill = state.registry.skills[skillName]
      const displayName = skillName.slice(0, 18).padEnd(20)

      if (row === state.cursorRow) {
        term.bgWhite.black(displayName)
      } else {
        term(displayName)
      }
      term(" ")

      for (let col = 0; col < state.agents.length; col++) {
        const agent = state.agents[col]
        const isAssigned = !!skill.assignments[agent.id]
        const symbol = isAssigned ? "●" : "○"

        const isCursor = row === state.cursorRow && col === state.cursorCol

        if (isCursor) {
          term.bgYellow.black(` ${symbol} `.padEnd(10))
        } else if (isAssigned) {
          term.green(` ${symbol} `.padEnd(10))
        } else {
          term.dim(` ${symbol} `.padEnd(10))
        }
      }
      term("\n")
    }

    term("\n")
    term("─".repeat(21 + state.agents.length * 10) + "\n")
    term.dim("[Space] Toggle  [a] Assign all  [n] None  [q] Quit\n")
  }

  const toggle = async () => {
    const skillName = state.skills[state.cursorRow]
    const agent = state.agents[state.cursorCol]
    const skill = state.registry.skills[skillName]

    if (skill.assignments[agent.id]) {
      await skillsStore.unassignSkill(skillName, expandPath(agent.globalPath))
      delete skill.assignments[agent.id]
    } else {
      await skillsStore.assignSkill(skillName, expandPath(agent.globalPath), { type: "directory" })
      skill.assignments[agent.id] = { type: "directory" }
    }

    await registryStore.save(state.registry)
  }

  const assignAll = async () => {
    const skillName = state.skills[state.cursorRow]
    const skill = state.registry.skills[skillName]

    for (const agent of state.agents) {
      if (!skill.assignments[agent.id]) {
        await skillsStore.assignSkill(skillName, expandPath(agent.globalPath), { type: "directory" })
        skill.assignments[agent.id] = { type: "directory" }
      }
    }

    await registryStore.save(state.registry)
  }

  const unassignAll = async () => {
    const skillName = state.skills[state.cursorRow]
    const skill = state.registry.skills[skillName]

    for (const agent of state.agents) {
      if (skill.assignments[agent.id]) {
        await skillsStore.unassignSkill(skillName, expandPath(agent.globalPath))
        delete skill.assignments[agent.id]
      }
    }

    await registryStore.save(state.registry)
  }

  render()

  term.grabInput(true)

  term.on("key", async (key: string) => {
    switch (key) {
      case "UP":
        state.cursorRow = Math.max(0, state.cursorRow - 1)
        break
      case "DOWN":
        state.cursorRow = Math.min(state.skills.length - 1, state.cursorRow + 1)
        break
      case "LEFT":
        state.cursorCol = Math.max(0, state.cursorCol - 1)
        break
      case "RIGHT":
        state.cursorCol = Math.min(state.agents.length - 1, state.cursorCol + 1)
        break
      case " ":
        await toggle()
        break
      case "a":
        await assignAll()
        break
      case "n":
        await unassignAll()
        break
      case "q":
      case "CTRL_C":
        term.clear()
        term.showCursor()
        term.grabInput(false)
        process.exit(0)
    }

    render()
  })
}
```

**Step 2: Implement manage command**

Create `src/commands/manage.ts`:

```typescript
import { defineCommand } from "citty"
import { runMatrixTUI } from "../tui/matrix"

export default defineCommand({
  meta: {
    name: "manage",
    description: "Open interactive skill management TUI",
  },
  async run() {
    await runMatrixTUI()
  },
})
```

**Step 3: Update index.ts for default TUI**

Replace `src/index.ts`:

```typescript
#!/usr/bin/env bun

import { defineCommand, runMain } from "citty"

const main = defineCommand({
  meta: {
    name: "simba",
    version: "0.2.0",
    description: "AI skills manager",
  },
  subCommands: {
    adopt: () => import("./commands/adopt").then((m) => m.default),
    assign: () => import("./commands/assign").then((m) => m.default),
    backup: () => import("./commands/backup").then((m) => m.default),
    detect: () => import("./commands/detect").then((m) => m.default),
    doctor: () => import("./commands/doctor").then((m) => m.default),
    import: () => import("./commands/import").then((m) => m.default),
    install: () => import("./commands/install").then((m) => m.default),
    list: () => import("./commands/list").then((m) => m.default),
    manage: () => import("./commands/manage").then((m) => m.default),
    migrate: () => import("./commands/migrate").then((m) => m.default),
    restore: () => import("./commands/restore").then((m) => m.default),
    snapshots: () => import("./commands/snapshots").then((m) => m.default),
    status: () => import("./commands/status").then((m) => m.default),
    sync: () => import("./commands/sync").then((m) => m.default),
    unassign: () => import("./commands/unassign").then((m) => m.default),
    undo: () => import("./commands/undo").then((m) => m.default),
  },
  async run() {
    // Default action: open TUI
    const { runMatrixTUI } = await import("./tui/matrix")
    await runMatrixTUI()
  },
})

runMain(main)
```

**Step 4: Run all tests**

Run: `bun test`
Expected: All tests pass

**Step 5: Manual test TUI**

Run: `bun run src/index.ts`
Expected: Matrix TUI opens (or shows message to adopt first)

**Step 6: Commit**

```bash
git add src/tui/matrix.ts src/commands/manage.ts src/index.ts
git commit -m "feat: implement matrix TUI for skill management"
```

---

## Task 13: Final Integration & Cleanup

**Files:**
- Modify: `README.md`

**Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 2: Run type check**

Run: `bun run tsc --noEmit`
Expected: No type errors

**Step 3: Test manual workflow**

```bash
bun run src/index.ts detect
bun run src/index.ts adopt --dry-run
bun run src/index.ts list
bun run src/index.ts doctor
bun run src/index.ts
```

**Step 4: Commit final changes**

```bash
git add -A
git commit -m "chore: final integration and cleanup"
```

---

## Summary

13 tasks total:
1. Add dependencies
2. Path helpers
3. Registry types
4. Registry store
5. Symlink utilities
6. Skills store
7. Adopt command
8. Doctor command
9. Install command
10. Assign/Unassign commands
11. List command
12. Matrix TUI
13. Final integration

Each task is self-contained with tests and commits.
