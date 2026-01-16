# simba Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a CLI/TUI tool for syncing AI agent skills across Claude Code, Cursor, Codex, OpenCode, and Antigravity.

**Architecture:** Core modules (AgentRegistry, SkillManager, ConfigStore, Snapshot) expose APIs consumed by CLI commands and TUI. CLI uses citty, TUI uses OpenTUI+Solid.

**Tech Stack:** Bun, TypeScript, citty, @opentui/core, @opentui/solid, smol-toml, tar

---

## Phase 1: Project Setup

### Task 1.1: Initialize Bun Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `bunfig.toml`

**Step 1: Initialize project**

Run: `bun init -y`

**Step 2: Update package.json**

```json
{
  "name": "simba",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "simba": "./src/index.ts"
  },
  "scripts": {
    "dev": "bun run src/index.ts",
    "test": "bun test",
    "lint": "bunx tsc --noEmit"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.0.0"
  },
  "dependencies": {
    "citty": "^0.1.6",
    "smol-toml": "^1.3.0"
  }
}
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

**Step 4: Install dependencies**

Run: `bun install`
Expected: Dependencies installed, node_modules created

**Step 5: Commit**

```bash
git add package.json tsconfig.json bun.lock
git commit -m "chore: initialize bun project with dependencies"
```

---

### Task 1.2: Create Directory Structure

**Files:**
- Create: `src/index.ts`
- Create: `src/core/types.ts`
- Create: `src/commands/.gitkeep`
- Create: `src/tui/.gitkeep`
- Create: `src/utils/.gitkeep`
- Create: `tests/.gitkeep`

**Step 1: Create directories and placeholder files**

```bash
mkdir -p src/commands src/core src/tui src/utils tests
touch src/commands/.gitkeep src/tui/.gitkeep src/utils/.gitkeep tests/.gitkeep
```

**Step 2: Create entry point stub**

`src/index.ts`:
```typescript
#!/usr/bin/env bun

console.log("simba - AI skills sync tool")
```

**Step 3: Verify it runs**

Run: `bun run src/index.ts`
Expected: "simba - AI skills sync tool"

**Step 4: Commit**

```bash
git add src/ tests/
git commit -m "chore: create project directory structure"
```

---

## Phase 2: Core Types and Config

### Task 2.1: Define Core Types

**Files:**
- Create: `src/core/types.ts`
- Test: `tests/core/types.test.ts`

**Step 1: Write type definitions**

`src/core/types.ts`:
```typescript
export interface Agent {
  id: string
  name: string
  globalPath: string
  projectPath: string
  detected: boolean
}

export interface SkillFile {
  path: string
  hash: string
}

export interface SkillInfo {
  name: string
  treeHash: string
  files: SkillFile[]
  origin: string
  lastSeen: Date
  agents: string[]
}

export interface SyncConfig {
  strategy: "union" | "source"
  sourceAgent: string
}

export interface SnapshotConfig {
  maxCount: number
  autoSnapshot: boolean
}

export interface Config {
  agents: Record<string, Agent>
  sync: SyncConfig
  snapshots: SnapshotConfig
  skills: Record<string, SkillInfo>
}

export type SkillStatus = "synced" | "conflict" | "unique" | "missing"

export interface SkillMatrix {
  skillName: string
  agents: Record<string, { present: boolean; hash: string | null }>
  status: SkillStatus
}
```

**Step 2: Verify types compile**

Run: `bunx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/core/types.ts
git commit -m "feat: define core types for config and skills"
```

---

### Task 2.2: Implement Config Store

**Files:**
- Create: `src/core/config-store.ts`
- Test: `tests/core/config-store.test.ts`

**Step 1: Write the failing test**

`tests/core/config-store.test.ts`:
```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { ConfigStore } from "../../src/core/config-store"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("ConfigStore", () => {
  let tempDir: string
  let configPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "simba-test-"))
    configPath = join(tempDir, "config.toml")
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true })
  })

  test("creates default config if none exists", async () => {
    const store = new ConfigStore(configPath)
    const config = await store.load()

    expect(config.agents.claude).toBeDefined()
    expect(config.agents.claude.globalPath).toBe("~/.claude/skills")
    expect(config.sync.strategy).toBe("union")
  })

  test("saves and loads config", async () => {
    const store = new ConfigStore(configPath)
    const config = await store.load()

    config.agents.claude.detected = true
    await store.save(config)

    const store2 = new ConfigStore(configPath)
    const loaded = await store2.load()

    expect(loaded.agents.claude.detected).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/core/config-store.test.ts`
Expected: FAIL - Cannot find module

**Step 3: Write implementation**

`src/core/config-store.ts`:
```typescript
import { parse, stringify } from "smol-toml"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import type { Config, Agent } from "./types"

const DEFAULT_AGENTS: Record<string, Agent> = {
  claude: {
    id: "claude",
    name: "Claude Code",
    globalPath: "~/.claude/skills",
    projectPath: ".claude/skills",
    detected: false,
  },
  cursor: {
    id: "cursor",
    name: "Cursor",
    globalPath: "~/.cursor/skills",
    projectPath: ".cursor/skills",
    detected: false,
  },
  codex: {
    id: "codex",
    name: "Codex",
    globalPath: "~/.codex/skills",
    projectPath: ".codex/skills",
    detected: false,
  },
  opencode: {
    id: "opencode",
    name: "OpenCode",
    globalPath: "~/.config/opencode/skill",
    projectPath: ".opencode/skill",
    detected: false,
  },
  antigravity: {
    id: "antigravity",
    name: "Antigravity",
    globalPath: "~/.gemini/antigravity/skills",
    projectPath: ".agent/skills",
    detected: false,
  },
}

function createDefaultConfig(): Config {
  return {
    agents: { ...DEFAULT_AGENTS },
    sync: {
      strategy: "union",
      sourceAgent: "",
    },
    snapshots: {
      maxCount: 10,
      autoSnapshot: true,
    },
    skills: {},
  }
}

export class ConfigStore {
  constructor(private configPath: string) {}

  async load(): Promise<Config> {
    try {
      const content = await readFile(this.configPath, "utf-8")
      const parsed = parse(content) as unknown as Config
      return this.mergeWithDefaults(parsed)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return createDefaultConfig()
      }
      throw err
    }
  }

  async save(config: Config): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true })
    const toml = stringify(config as unknown as Record<string, unknown>)
    await writeFile(this.configPath, toml)
  }

  private mergeWithDefaults(parsed: Partial<Config>): Config {
    const defaults = createDefaultConfig()
    return {
      agents: { ...defaults.agents, ...parsed.agents },
      sync: { ...defaults.sync, ...parsed.sync },
      snapshots: { ...defaults.snapshots, ...parsed.snapshots },
      skills: parsed.skills ?? {},
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/core/config-store.test.ts`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add src/core/config-store.ts tests/core/config-store.test.ts
git commit -m "feat: implement ConfigStore with TOML persistence"
```

---

### Task 2.3: Implement Path Utilities

**Files:**
- Create: `src/utils/paths.ts`
- Test: `tests/utils/paths.test.ts`

**Step 1: Write the failing test**

`tests/utils/paths.test.ts`:
```typescript
import { describe, test, expect } from "bun:test"
import { expandPath, getConfigDir, getConfigPath } from "../../src/utils/paths"
import { homedir } from "node:os"

describe("paths", () => {
  test("expandPath expands tilde", () => {
    const result = expandPath("~/.claude/skills")
    expect(result).toBe(`${homedir()}/.claude/skills`)
  })

  test("expandPath handles absolute paths", () => {
    const result = expandPath("/absolute/path")
    expect(result).toBe("/absolute/path")
  })

  test("getConfigDir returns XDG path", () => {
    const result = getConfigDir()
    expect(result).toContain("simba")
  })

  test("getConfigPath returns config.toml path", () => {
    const result = getConfigPath()
    expect(result).toEndWith("config.toml")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/utils/paths.test.ts`
Expected: FAIL - Cannot find module

**Step 3: Write implementation**

`src/utils/paths.ts`:
```typescript
import { homedir } from "node:os"
import { join } from "node:path"

export function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2))
  }
  return path
}

export function getConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(xdgConfig, "simba")
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.toml")
}

export function getSnapshotsDir(): string {
  return join(getConfigDir(), "snapshots")
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/utils/paths.test.ts`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/utils/paths.ts tests/utils/paths.test.ts
git commit -m "feat: add path utilities with XDG support"
```

---

## Phase 3: Core Modules

### Task 3.1: Implement Hash Utility

**Files:**
- Create: `src/utils/hash.ts`
- Test: `tests/utils/hash.test.ts`

**Step 1: Write the failing test**

`tests/utils/hash.test.ts`:
```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { hashFile, hashTree } from "../../src/utils/hash"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("hash", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "simba-hash-"))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true })
  })

  test("hashFile produces consistent SHA-256 hash", async () => {
    const filePath = join(tempDir, "test.txt")
    await writeFile(filePath, "hello world")

    const hash1 = await hashFile(filePath)
    const hash2 = await hashFile(filePath)

    expect(hash1).toBe(hash2)
    expect(hash1).toMatch(/^[a-f0-9]{64}$/)
  })

  test("hashTree produces git-style tree hash", async () => {
    const skillDir = join(tempDir, "my-skill")
    await mkdir(skillDir)
    await writeFile(join(skillDir, "SKILL.md"), "# My Skill")
    await mkdir(join(skillDir, "scripts"))
    await writeFile(join(skillDir, "scripts", "run.sh"), "#!/bin/bash")

    const { treeHash, files } = await hashTree(skillDir)

    expect(treeHash).toMatch(/^[a-f0-9]{64}$/)
    expect(files).toHaveLength(2)
    expect(files.map((f) => f.path).sort()).toEqual(["SKILL.md", "scripts/run.sh"])
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/utils/hash.test.ts`
Expected: FAIL - Cannot find module

**Step 3: Write implementation**

`src/utils/hash.ts`:
```typescript
import { readFile, readdir, stat } from "node:fs/promises"
import { join, relative } from "node:path"
import { createHash } from "node:crypto"
import type { SkillFile } from "../core/types"

export async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath)
  return createHash("sha256").update(content).digest("hex")
}

export async function hashTree(
  dirPath: string
): Promise<{ treeHash: string; files: SkillFile[] }> {
  const files: SkillFile[] = []
  await collectFiles(dirPath, dirPath, files)

  // Sort for deterministic ordering
  files.sort((a, b) => a.path.localeCompare(b.path))

  // Git-style: hash of "path:hash\n" entries
  const treeContent = files.map((f) => `${f.path}:${f.hash}`).join("\n")
  const treeHash = createHash("sha256").update(treeContent).digest("hex")

  return { treeHash, files }
}

async function collectFiles(
  basePath: string,
  currentPath: string,
  files: SkillFile[]
): Promise<void> {
  const entries = await readdir(currentPath, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(currentPath, entry.name)

    if (entry.isDirectory()) {
      await collectFiles(basePath, fullPath, files)
    } else if (entry.isFile()) {
      const hash = await hashFile(fullPath)
      files.push({
        path: relative(basePath, fullPath),
        hash,
      })
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/utils/hash.test.ts`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add src/utils/hash.ts tests/utils/hash.test.ts
git commit -m "feat: implement git-style tree hashing"
```

---

### Task 3.2: Implement Agent Registry

**Files:**
- Create: `src/core/agent-registry.ts`
- Test: `tests/core/agent-registry.test.ts`

**Step 1: Write the failing test**

`tests/core/agent-registry.test.ts`:
```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { AgentRegistry } from "../../src/core/agent-registry"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { Agent } from "../../src/core/types"

describe("AgentRegistry", () => {
  let tempDir: string
  let mockAgents: Record<string, Agent>

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "simba-registry-"))

    mockAgents = {
      testagent: {
        id: "testagent",
        name: "Test Agent",
        globalPath: join(tempDir, ".testagent/skills"),
        projectPath: ".testagent/skills",
        detected: false,
      },
    }
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true })
  })

  test("detectAgents finds agent when directory exists", async () => {
    // Create the agent directory
    await mkdir(join(tempDir, ".testagent"), { recursive: true })

    const registry = new AgentRegistry(mockAgents)
    const detected = await registry.detectAgents()

    expect(detected.testagent.detected).toBe(true)
  })

  test("detectAgents marks missing agent as not detected", async () => {
    const registry = new AgentRegistry(mockAgents)
    const detected = await registry.detectAgents()

    expect(detected.testagent.detected).toBe(false)
  })

  test("listSkills returns skills in agent directory", async () => {
    const skillsDir = join(tempDir, ".testagent/skills")
    await mkdir(join(skillsDir, "my-skill"), { recursive: true })
    await writeFile(
      join(skillsDir, "my-skill", "SKILL.md"),
      "---\nname: my-skill\ndescription: Test\n---\n# My Skill"
    )

    const registry = new AgentRegistry(mockAgents)
    const skills = await registry.listSkills("testagent")

    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe("my-skill")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/core/agent-registry.test.ts`
Expected: FAIL - Cannot find module

**Step 3: Write implementation**

`src/core/agent-registry.ts`:
```typescript
import { access, readdir, mkdir, cp, rm } from "node:fs/promises"
import { join, dirname } from "node:path"
import { expandPath } from "../utils/paths"
import { hashTree } from "../utils/hash"
import type { Agent, SkillInfo } from "./types"

export class AgentRegistry {
  constructor(private agents: Record<string, Agent>) {}

  async detectAgents(): Promise<Record<string, Agent>> {
    const results: Record<string, Agent> = {}

    for (const [id, agent] of Object.entries(this.agents)) {
      const globalPath = expandPath(agent.globalPath)
      const parentDir = dirname(globalPath)

      let detected = false
      try {
        await access(parentDir)
        detected = true
      } catch {
        detected = false
      }

      results[id] = { ...agent, detected }
    }

    return results
  }

  async listSkills(agentId: string): Promise<SkillInfo[]> {
    const agent = this.agents[agentId]
    if (!agent) throw new Error(`Unknown agent: ${agentId}`)

    const skillsPath = expandPath(agent.globalPath)
    const skills: SkillInfo[] = []

    try {
      const entries = await readdir(skillsPath, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const skillPath = join(skillsPath, entry.name)
        const skillMdPath = join(skillPath, "SKILL.md")

        try {
          await access(skillMdPath)
        } catch {
          continue // Skip directories without SKILL.md
        }

        const { treeHash, files } = await hashTree(skillPath)

        skills.push({
          name: entry.name,
          treeHash,
          files,
          origin: agentId,
          lastSeen: new Date(),
          agents: [agentId],
        })
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err
      }
    }

    return skills
  }

  async copySkill(
    skillName: string,
    fromAgent: string,
    toAgent: string
  ): Promise<void> {
    const from = this.agents[fromAgent]
    const to = this.agents[toAgent]

    if (!from || !to) {
      throw new Error(`Unknown agent: ${fromAgent} or ${toAgent}`)
    }

    const sourcePath = join(expandPath(from.globalPath), skillName)
    const destPath = join(expandPath(to.globalPath), skillName)

    await mkdir(dirname(destPath), { recursive: true })
    await cp(sourcePath, destPath, { recursive: true })
  }

  async deleteSkill(skillName: string, agentId: string): Promise<void> {
    const agent = this.agents[agentId]
    if (!agent) throw new Error(`Unknown agent: ${agentId}`)

    const skillPath = join(expandPath(agent.globalPath), skillName)
    await rm(skillPath, { recursive: true })
  }

  getSkillPath(skillName: string, agentId: string): string {
    const agent = this.agents[agentId]
    if (!agent) throw new Error(`Unknown agent: ${agentId}`)
    return join(expandPath(agent.globalPath), skillName)
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/core/agent-registry.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/core/agent-registry.ts tests/core/agent-registry.test.ts
git commit -m "feat: implement AgentRegistry for skill detection"
```

---

### Task 3.3: Implement Skill Manager

**Files:**
- Create: `src/core/skill-manager.ts`
- Test: `tests/core/skill-manager.test.ts`

**Step 1: Write the failing test**

`tests/core/skill-manager.test.ts`:
```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { SkillManager } from "../../src/core/skill-manager"
import { AgentRegistry } from "../../src/core/agent-registry"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { Agent } from "../../src/core/types"

describe("SkillManager", () => {
  let tempDir: string
  let mockAgents: Record<string, Agent>
  let registry: AgentRegistry
  let manager: SkillManager

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "simba-manager-"))

    mockAgents = {
      agent1: {
        id: "agent1",
        name: "Agent 1",
        globalPath: join(tempDir, "agent1/skills"),
        projectPath: ".agent1/skills",
        detected: true,
      },
      agent2: {
        id: "agent2",
        name: "Agent 2",
        globalPath: join(tempDir, "agent2/skills"),
        projectPath: ".agent2/skills",
        detected: true,
      },
    }

    registry = new AgentRegistry(mockAgents)
    manager = new SkillManager(registry, mockAgents)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true })
  })

  test("buildMatrix returns unique status for skill in one agent", async () => {
    await mkdir(join(tempDir, "agent1/skills/my-skill"), { recursive: true })
    await writeFile(
      join(tempDir, "agent1/skills/my-skill/SKILL.md"),
      "---\nname: my-skill\ndescription: Test\n---"
    )

    const matrix = await manager.buildMatrix()

    expect(matrix).toHaveLength(1)
    expect(matrix[0].skillName).toBe("my-skill")
    expect(matrix[0].status).toBe("unique")
    expect(matrix[0].agents.agent1.present).toBe(true)
    expect(matrix[0].agents.agent2.present).toBe(false)
  })

  test("buildMatrix returns synced status when hashes match", async () => {
    const skillContent = "---\nname: shared-skill\ndescription: Test\n---"

    await mkdir(join(tempDir, "agent1/skills/shared-skill"), { recursive: true })
    await writeFile(join(tempDir, "agent1/skills/shared-skill/SKILL.md"), skillContent)

    await mkdir(join(tempDir, "agent2/skills/shared-skill"), { recursive: true })
    await writeFile(join(tempDir, "agent2/skills/shared-skill/SKILL.md"), skillContent)

    const matrix = await manager.buildMatrix()

    expect(matrix).toHaveLength(1)
    expect(matrix[0].status).toBe("synced")
  })

  test("buildMatrix returns conflict status when hashes differ", async () => {
    await mkdir(join(tempDir, "agent1/skills/diff-skill"), { recursive: true })
    await writeFile(
      join(tempDir, "agent1/skills/diff-skill/SKILL.md"),
      "---\nname: diff-skill\ndescription: Version A\n---"
    )

    await mkdir(join(tempDir, "agent2/skills/diff-skill"), { recursive: true })
    await writeFile(
      join(tempDir, "agent2/skills/diff-skill/SKILL.md"),
      "---\nname: diff-skill\ndescription: Version B\n---"
    )

    const matrix = await manager.buildMatrix()

    expect(matrix).toHaveLength(1)
    expect(matrix[0].status).toBe("conflict")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/core/skill-manager.test.ts`
Expected: FAIL - Cannot find module

**Step 3: Write implementation**

`src/core/skill-manager.ts`:
```typescript
import type { Agent, SkillMatrix, SkillStatus } from "./types"
import type { AgentRegistry } from "./agent-registry"

export class SkillManager {
  constructor(
    private registry: AgentRegistry,
    private agents: Record<string, Agent>
  ) {}

  async buildMatrix(): Promise<SkillMatrix[]> {
    const detectedAgents = Object.entries(this.agents).filter(
      ([_, agent]) => agent.detected
    )

    // Collect all skills from all agents
    const skillMap = new Map<
      string,
      Map<string, { present: boolean; hash: string | null }>
    >()

    for (const [agentId] of detectedAgents) {
      const skills = await this.registry.listSkills(agentId)

      for (const skill of skills) {
        if (!skillMap.has(skill.name)) {
          skillMap.set(skill.name, new Map())
        }
        skillMap.get(skill.name)!.set(agentId, {
          present: true,
          hash: skill.treeHash,
        })
      }
    }

    // Build matrix with status
    const matrix: SkillMatrix[] = []

    for (const [skillName, agentHashes] of skillMap) {
      const agents: Record<string, { present: boolean; hash: string | null }> =
        {}

      // Initialize all agents as not present
      for (const [agentId] of detectedAgents) {
        agents[agentId] = agentHashes.get(agentId) ?? {
          present: false,
          hash: null,
        }
      }

      const status = this.computeStatus(agentHashes)

      matrix.push({ skillName, agents, status })
    }

    return matrix.sort((a, b) => a.skillName.localeCompare(b.skillName))
  }

  private computeStatus(
    agentHashes: Map<string, { present: boolean; hash: string | null }>
  ): SkillStatus {
    const presentAgents = Array.from(agentHashes.entries()).filter(
      ([_, v]) => v.present
    )

    if (presentAgents.length === 0) {
      return "missing"
    }

    if (presentAgents.length === 1) {
      return "unique"
    }

    const hashes = new Set(presentAgents.map(([_, v]) => v.hash))
    return hashes.size === 1 ? "synced" : "conflict"
  }

  async syncUnique(skillName: string, sourceAgent: string): Promise<string[]> {
    const targetAgents = Object.entries(this.agents)
      .filter(([id, agent]) => agent.detected && id !== sourceAgent)
      .map(([id]) => id)

    for (const targetAgent of targetAgents) {
      await this.registry.copySkill(skillName, sourceAgent, targetAgent)
    }

    return targetAgents
  }

  async resolveConflict(
    skillName: string,
    winnerAgent: string,
    loserAgents: string[]
  ): Promise<void> {
    for (const loserAgent of loserAgents) {
      await this.registry.deleteSkill(skillName, loserAgent)
      await this.registry.copySkill(skillName, winnerAgent, loserAgent)
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/core/skill-manager.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/core/skill-manager.ts tests/core/skill-manager.test.ts
git commit -m "feat: implement SkillManager with matrix and sync"
```

---

### Task 3.4: Implement Snapshot Manager

**Files:**
- Create: `src/core/snapshot.ts`
- Test: `tests/core/snapshot.test.ts`

**Step 1: Write the failing test**

`tests/core/snapshot.test.ts`:
```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { SnapshotManager } from "../../src/core/snapshot"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("SnapshotManager", () => {
  let tempDir: string
  let snapshotsDir: string
  let skillsDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "simba-snapshot-"))
    snapshotsDir = join(tempDir, "snapshots")
    skillsDir = join(tempDir, "skills")

    await mkdir(join(skillsDir, "my-skill"), { recursive: true })
    await writeFile(join(skillsDir, "my-skill/SKILL.md"), "# Original")
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true })
  })

  test("createSnapshot saves skill state", async () => {
    const manager = new SnapshotManager(snapshotsDir, 10)
    const id = await manager.createSnapshot([join(skillsDir, "my-skill")], "test")

    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/)

    const snapshotPath = join(snapshotsDir, id, "skills/my-skill/SKILL.md")
    const content = await readFile(snapshotPath, "utf-8")
    expect(content).toBe("# Original")
  })

  test("listSnapshots returns available snapshots", async () => {
    const manager = new SnapshotManager(snapshotsDir, 10)
    await manager.createSnapshot([join(skillsDir, "my-skill")], "test1")
    await manager.createSnapshot([join(skillsDir, "my-skill")], "test2")

    const list = await manager.listSnapshots()
    expect(list).toHaveLength(2)
  })

  test("restore recovers skill from snapshot", async () => {
    const manager = new SnapshotManager(snapshotsDir, 10)
    const id = await manager.createSnapshot([join(skillsDir, "my-skill")], "test")

    // Modify original
    await writeFile(join(skillsDir, "my-skill/SKILL.md"), "# Modified")

    // Restore
    await manager.restore(id, skillsDir)

    const content = await readFile(join(skillsDir, "my-skill/SKILL.md"), "utf-8")
    expect(content).toBe("# Original")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/core/snapshot.test.ts`
Expected: FAIL - Cannot find module

**Step 3: Write implementation**

`src/core/snapshot.ts`:
```typescript
import { mkdir, cp, readdir, writeFile, readFile, rm } from "node:fs/promises"
import { join, basename, dirname } from "node:path"

export interface SnapshotManifest {
  id: string
  reason: string
  created: string
  skills: string[]
}

export class SnapshotManager {
  constructor(
    private snapshotsDir: string,
    private maxCount: number
  ) {}

  async createSnapshot(skillPaths: string[], reason: string): Promise<string> {
    const id = this.generateId()
    const snapshotDir = join(this.snapshotsDir, id)
    const skillsBackupDir = join(snapshotDir, "skills")

    await mkdir(skillsBackupDir, { recursive: true })

    const skillNames: string[] = []

    for (const skillPath of skillPaths) {
      const skillName = basename(skillPath)
      skillNames.push(skillName)
      await cp(skillPath, join(skillsBackupDir, skillName), { recursive: true })
    }

    const manifest: SnapshotManifest = {
      id,
      reason,
      created: new Date().toISOString(),
      skills: skillNames,
    }

    await writeFile(
      join(snapshotDir, "manifest.json"),
      JSON.stringify(manifest, null, 2)
    )

    await this.pruneOldSnapshots()

    return id
  }

  async listSnapshots(): Promise<SnapshotManifest[]> {
    try {
      const entries = await readdir(this.snapshotsDir, { withFileTypes: true })
      const manifests: SnapshotManifest[] = []

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        try {
          const manifestPath = join(this.snapshotsDir, entry.name, "manifest.json")
          const content = await readFile(manifestPath, "utf-8")
          manifests.push(JSON.parse(content))
        } catch {
          continue
        }
      }

      return manifests.sort(
        (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()
      )
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return []
      }
      throw err
    }
  }

  async restore(snapshotId: string, targetDir: string): Promise<void> {
    const snapshotDir = join(this.snapshotsDir, snapshotId)
    const skillsBackupDir = join(snapshotDir, "skills")
    const manifestPath = join(snapshotDir, "manifest.json")

    const manifest: SnapshotManifest = JSON.parse(
      await readFile(manifestPath, "utf-8")
    )

    for (const skillName of manifest.skills) {
      const sourcePath = join(skillsBackupDir, skillName)
      const targetPath = join(targetDir, skillName)

      // Ensure parent exists, remove old version if present
      await mkdir(dirname(targetPath), { recursive: true })
      try {
        await rm(targetPath, { recursive: true })
      } catch {
        // Ignore if doesn't exist
      }

      await cp(sourcePath, targetPath, { recursive: true })
    }
  }

  async getLatestSnapshot(): Promise<SnapshotManifest | null> {
    const list = await this.listSnapshots()
    return list[0] ?? null
  }

  private generateId(): string {
    const now = new Date()
    return now.toISOString().replace(/[:.]/g, "-").slice(0, 19)
  }

  private async pruneOldSnapshots(): Promise<void> {
    const list = await this.listSnapshots()

    if (list.length <= this.maxCount) return

    const toDelete = list.slice(this.maxCount)
    for (const snapshot of toDelete) {
      await rm(join(this.snapshotsDir, snapshot.id), { recursive: true })
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/core/snapshot.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/core/snapshot.ts tests/core/snapshot.test.ts
git commit -m "feat: implement SnapshotManager for undo support"
```

---

## Phase 4: CLI Commands

### Task 4.1: Set Up CLI Framework

**Files:**
- Modify: `src/index.ts`

**Step 1: Create CLI entry point**

`src/index.ts`:
```typescript
#!/usr/bin/env bun

import { defineCommand, runMain } from "citty"

const main = defineCommand({
  meta: {
    name: "simba",
    version: "0.1.0",
    description: "AI skills sync/backup/migrate tool",
  },
  subCommands: {
    detect: () => import("./commands/detect").then((m) => m.default),
    status: () => import("./commands/status").then((m) => m.default),
    sync: () => import("./commands/sync").then((m) => m.default),
    migrate: () => import("./commands/migrate").then((m) => m.default),
    backup: () => import("./commands/backup").then((m) => m.default),
    restore: () => import("./commands/restore").then((m) => m.default),
    import: () => import("./commands/import").then((m) => m.default),
    undo: () => import("./commands/undo").then((m) => m.default),
    snapshots: () => import("./commands/snapshots").then((m) => m.default),
  },
})

runMain(main)
```

**Step 2: Verify it runs**

Run: `bun run src/index.ts --help`
Expected: Shows help with subcommands listed

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: set up CLI framework with citty"
```

---

### Task 4.2: Implement detect Command

**Files:**
- Create: `src/commands/detect.ts`

**Step 1: Write detect command**

`src/commands/detect.ts`:
```typescript
import { defineCommand } from "citty"
import { ConfigStore } from "../core/config-store"
import { AgentRegistry } from "../core/agent-registry"
import { getConfigPath } from "../utils/paths"

export default defineCommand({
  meta: {
    name: "detect",
    description: "Scan for installed agents and skills",
  },
  args: {
    refresh: {
      type: "boolean",
      description: "Force rescan even if already detected",
      default: false,
    },
  },
  async run({ args }) {
    const configStore = new ConfigStore(getConfigPath())
    const config = await configStore.load()

    const registry = new AgentRegistry(config.agents)
    const detected = await registry.detectAgents()

    // Update config with detection results
    for (const [id, agent] of Object.entries(detected)) {
      config.agents[id] = agent
    }

    // Scan skills from detected agents
    let totalSkills = 0
    for (const [id, agent] of Object.entries(detected)) {
      if (!agent.detected) continue

      const skills = await registry.listSkills(id)
      totalSkills += skills.length

      for (const skill of skills) {
        config.skills[skill.name] = {
          ...config.skills[skill.name],
          ...skill,
          agents: [
            ...new Set([
              ...(config.skills[skill.name]?.agents ?? []),
              id,
            ]),
          ],
        }
      }
    }

    await configStore.save(config)

    // Output results
    console.log("\nDetected agents:")
    for (const [id, agent] of Object.entries(detected)) {
      const status = agent.detected ? "✓" : "─"
      console.log(`  ${status} ${agent.name}`)
    }

    console.log(`\nTotal skills found: ${totalSkills}`)
  },
})
```

**Step 2: Verify it runs**

Run: `bun run src/index.ts detect`
Expected: Shows detected agents and skill count

**Step 3: Commit**

```bash
git add src/commands/detect.ts
git commit -m "feat: implement detect command"
```

---

### Task 4.3: Implement status Command

**Files:**
- Create: `src/commands/status.ts`

**Step 1: Write status command**

`src/commands/status.ts`:
```typescript
import { defineCommand } from "citty"
import { ConfigStore } from "../core/config-store"
import { AgentRegistry } from "../core/agent-registry"
import { SkillManager } from "../core/skill-manager"
import { getConfigPath } from "../utils/paths"

export default defineCommand({
  meta: {
    name: "status",
    description: "Show skill matrix across agents",
  },
  args: {
    agent: {
      type: "string",
      description: "Filter to specific agent",
    },
  },
  async run({ args }) {
    const configStore = new ConfigStore(getConfigPath())
    const config = await configStore.load()

    const registry = new AgentRegistry(config.agents)
    const manager = new SkillManager(registry, config.agents)

    const matrix = await manager.buildMatrix()

    // Get detected agents
    const detectedAgents = Object.entries(config.agents)
      .filter(([_, a]) => a.detected)
      .filter(([id]) => !args.agent || id === args.agent)

    if (detectedAgents.length === 0) {
      console.log("No agents detected. Run 'simba detect' first.")
      return
    }

    // Print header
    const agentNames = detectedAgents.map(([_, a]) => a.name.slice(0, 8).padEnd(8))
    console.log(`\n${"Skill".padEnd(24)} ${agentNames.join(" ")}`)
    console.log("─".repeat(24 + agentNames.length * 9))

    // Print matrix
    const statusSymbols = {
      synced: "✓",
      conflict: "⚠",
      unique: "●",
      missing: "─",
    }

    for (const row of matrix) {
      const cells = detectedAgents.map(([id]) => {
        const cell = row.agents[id]
        if (!cell?.present) return "─".padStart(4).padEnd(8)
        if (row.status === "conflict") return "⚠".padStart(4).padEnd(8)
        return "✓".padStart(4).padEnd(8)
      })

      const skillName = row.skillName.slice(0, 23).padEnd(24)
      console.log(`${skillName} ${cells.join(" ")}`)
    }

    // Summary
    const synced = matrix.filter((m) => m.status === "synced").length
    const conflicts = matrix.filter((m) => m.status === "conflict").length
    const unique = matrix.filter((m) => m.status === "unique").length

    console.log("\n─".repeat(24 + agentNames.length * 9))
    console.log(`✓ synced: ${synced}  ⚠ conflict: ${conflicts}  ● unique: ${unique}`)
  },
})
```

**Step 2: Verify it runs**

Run: `bun run src/index.ts status`
Expected: Shows skill matrix or "No agents detected" message

**Step 3: Commit**

```bash
git add src/commands/status.ts
git commit -m "feat: implement status command with skill matrix"
```

---

### Task 4.4: Implement sync Command

**Files:**
- Create: `src/commands/sync.ts`

**Step 1: Write sync command**

`src/commands/sync.ts`:
```typescript
import { defineCommand } from "citty"
import { ConfigStore } from "../core/config-store"
import { AgentRegistry } from "../core/agent-registry"
import { SkillManager } from "../core/skill-manager"
import { SnapshotManager } from "../core/snapshot"
import { getConfigPath, getSnapshotsDir } from "../utils/paths"
import * as readline from "node:readline"

export default defineCommand({
  meta: {
    name: "sync",
    description: "Sync skills across agents (union merge)",
  },
  args: {
    source: {
      type: "string",
      description: "Source of truth agent (one-way sync)",
    },
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

    const registry = new AgentRegistry(config.agents)
    const manager = new SkillManager(registry, config.agents)
    const snapshots = new SnapshotManager(
      getSnapshotsDir(),
      config.snapshots.maxCount
    )

    const matrix = await manager.buildMatrix()

    const unique = matrix.filter((m) => m.status === "unique")
    const conflicts = matrix.filter((m) => m.status === "conflict")

    if (unique.length === 0 && conflicts.length === 0) {
      console.log("All skills are synced!")
      return
    }

    // Show what will happen
    if (unique.length > 0) {
      console.log("\nWill copy:")
      for (const skill of unique) {
        const source = Object.entries(skill.agents).find(([_, v]) => v.present)?.[0]
        const targets = Object.entries(skill.agents)
          .filter(([_, v]) => !v.present)
          .map(([id]) => id)
        console.log(`  ${skill.skillName}  →  ${targets.join(", ")}`)
      }
    }

    if (conflicts.length > 0 && !args.source) {
      console.log("\nConflicts (resolve manually):")
      for (const skill of conflicts) {
        const agents = Object.entries(skill.agents)
          .filter(([_, v]) => v.present)
          .map(([id]) => id)
        console.log(`  ${skill.skillName}: ${agents.join(" ≠ ")}`)
      }
    }

    if (args.dryRun) {
      console.log("\n(dry run - no changes made)")
      return
    }

    // Create snapshot before changes
    if (config.snapshots.autoSnapshot && (unique.length > 0 || conflicts.length > 0)) {
      const skillPaths = [...unique, ...conflicts].flatMap((skill) =>
        Object.entries(skill.agents)
          .filter(([_, v]) => v.present)
          .map(([agentId]) => registry.getSkillPath(skill.skillName, agentId))
      )
      await snapshots.createSnapshot(skillPaths, "pre-sync")
      console.log("\nSnapshot created.")
    }

    // Sync unique skills
    for (const skill of unique) {
      const source = Object.entries(skill.agents).find(([_, v]) => v.present)?.[0]
      if (!source) continue

      const synced = await manager.syncUnique(skill.skillName, source)
      console.log(`Synced ${skill.skillName} to ${synced.join(", ")}`)
    }

    // Handle conflicts with --source flag
    if (args.source && conflicts.length > 0) {
      for (const skill of conflicts) {
        const losers = Object.entries(skill.agents)
          .filter(([id, v]) => v.present && id !== args.source)
          .map(([id]) => id)

        await manager.resolveConflict(skill.skillName, args.source, losers)
        console.log(`Resolved ${skill.skillName} using ${args.source}`)
      }
    }

    console.log("\nSync complete!")
  },
})
```

**Step 2: Verify it runs**

Run: `bun run src/index.ts sync --dry-run`
Expected: Shows what would be synced

**Step 3: Commit**

```bash
git add src/commands/sync.ts
git commit -m "feat: implement sync command with union merge"
```

---

### Task 4.5: Implement migrate Command

**Files:**
- Create: `src/commands/migrate.ts`

**Step 1: Write migrate command**

`src/commands/migrate.ts`:
```typescript
import { defineCommand } from "citty"
import { ConfigStore } from "../core/config-store"
import { AgentRegistry } from "../core/agent-registry"
import { SnapshotManager } from "../core/snapshot"
import { getConfigPath, getSnapshotsDir } from "../utils/paths"

export default defineCommand({
  meta: {
    name: "migrate",
    description: "Copy all skills from one agent to another",
  },
  args: {
    from: {
      type: "positional",
      description: "Source agent",
      required: true,
    },
    to: {
      type: "positional",
      description: "Target agent",
      required: true,
    },
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

    const fromAgent = config.agents[args.from]
    const toAgent = config.agents[args.to]

    if (!fromAgent) {
      console.error(`Unknown agent: ${args.from}`)
      process.exit(1)
    }
    if (!toAgent) {
      console.error(`Unknown agent: ${args.to}`)
      process.exit(1)
    }
    if (!fromAgent.detected) {
      console.error(`Agent not detected: ${args.from}`)
      process.exit(1)
    }
    if (!toAgent.detected) {
      console.error(`Agent not detected: ${args.to}`)
      process.exit(1)
    }

    const registry = new AgentRegistry(config.agents)
    const snapshots = new SnapshotManager(
      getSnapshotsDir(),
      config.snapshots.maxCount
    )

    const sourceSkills = await registry.listSkills(args.from)
    const targetSkills = await registry.listSkills(args.to)
    const targetNames = new Set(targetSkills.map((s) => s.name))

    const toCopy = sourceSkills.filter((s) => !targetNames.has(s.name))
    const skipped = sourceSkills.filter((s) => targetNames.has(s.name))

    console.log(`\nMigrating from ${fromAgent.name} to ${toAgent.name}`)
    console.log(`\nWill copy: ${toCopy.length} skills`)
    for (const skill of toCopy) {
      console.log(`  ${skill.name}`)
    }

    if (skipped.length > 0) {
      console.log(`\nSkipping (already exist): ${skipped.length} skills`)
      for (const skill of skipped) {
        console.log(`  ${skill.name}`)
      }
    }

    if (args.dryRun) {
      console.log("\n(dry run - no changes made)")
      return
    }

    if (toCopy.length === 0) {
      console.log("\nNothing to migrate.")
      return
    }

    // Create snapshot
    if (config.snapshots.autoSnapshot) {
      const skillPaths = toCopy.map((s) =>
        registry.getSkillPath(s.name, args.from)
      )
      await snapshots.createSnapshot(skillPaths, `migrate-${args.from}-${args.to}`)
      console.log("\nSnapshot created.")
    }

    // Copy skills
    for (const skill of toCopy) {
      await registry.copySkill(skill.name, args.from, args.to)
      console.log(`Copied: ${skill.name}`)
    }

    console.log("\nMigration complete!")
  },
})
```

**Step 2: Verify it runs**

Run: `bun run src/index.ts migrate --help`
Expected: Shows help for migrate command

**Step 3: Commit**

```bash
git add src/commands/migrate.ts
git commit -m "feat: implement migrate command"
```

---

### Task 4.6: Implement backup Command

**Files:**
- Create: `src/commands/backup.ts`

**Step 1: Write backup command**

`src/commands/backup.ts`:
```typescript
import { defineCommand } from "citty"
import { ConfigStore } from "../core/config-store"
import { AgentRegistry } from "../core/agent-registry"
import { getConfigPath, expandPath } from "../utils/paths"
import { mkdir, writeFile, readFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import * as tar from "tar"

export default defineCommand({
  meta: {
    name: "backup",
    description: "Export all skills to archive",
  },
  args: {
    path: {
      type: "positional",
      description: "Output path (.tar.gz)",
      required: true,
    },
    includeConfig: {
      type: "boolean",
      description: "Include simba config in backup",
      default: false,
    },
  },
  async run({ args }) {
    const configStore = new ConfigStore(getConfigPath())
    const config = await configStore.load()
    const registry = new AgentRegistry(config.agents)

    // Collect all unique skills
    const allSkills = new Map<string, { path: string; origin: string }>()

    for (const [agentId, agent] of Object.entries(config.agents)) {
      if (!agent.detected) continue

      const skills = await registry.listSkills(agentId)
      for (const skill of skills) {
        if (!allSkills.has(skill.name)) {
          allSkills.set(skill.name, {
            path: registry.getSkillPath(skill.name, agentId),
            origin: agentId,
          })
        }
      }
    }

    if (allSkills.size === 0) {
      console.log("No skills to backup.")
      return
    }

    // Create temp directory for backup structure
    const tempDir = join(dirname(args.path), `.simba-backup-${Date.now()}`)
    const skillsDir = join(tempDir, "skills")
    await mkdir(skillsDir, { recursive: true })

    // Copy skills to temp structure
    const manifest = {
      version: "1",
      created: new Date().toISOString(),
      simba_version: "0.1.0",
      source_agents: [...new Set(Array.from(allSkills.values()).map((s) => s.origin))],
      skills: {} as Record<string, { hash: string; origin: string; files: string[] }>,
      includes_config: args.includeConfig,
    }

    for (const [name, { path, origin }] of allSkills) {
      const destPath = join(skillsDir, name)
      await Bun.$`cp -r ${path} ${destPath}`

      const skill = (await registry.listSkills(origin)).find((s) => s.name === name)
      if (skill) {
        manifest.skills[name] = {
          hash: skill.treeHash,
          origin,
          files: skill.files.map((f) => f.path),
        }
      }
    }

    // Write manifest
    await writeFile(
      join(tempDir, "manifest.json"),
      JSON.stringify(manifest, null, 2)
    )

    // Include config if requested
    if (args.includeConfig) {
      const configContent = await readFile(getConfigPath(), "utf-8")
      await writeFile(join(tempDir, "config.toml"), configContent)
    }

    // Create tar.gz
    await tar.create(
      {
        gzip: true,
        file: args.path,
        cwd: tempDir,
      },
      ["manifest.json", "skills", ...(args.includeConfig ? ["config.toml"] : [])]
    )

    // Cleanup temp
    await Bun.$`rm -rf ${tempDir}`

    console.log(`\nBackup created: ${args.path}`)
    console.log(`Skills: ${allSkills.size}`)
    console.log(`Config included: ${args.includeConfig}`)
  },
})
```

**Step 2: Add tar dependency**

Run: `bun add tar && bun add -d @types/tar`

**Step 3: Verify it runs**

Run: `bun run src/index.ts backup --help`
Expected: Shows help for backup command

**Step 4: Commit**

```bash
git add src/commands/backup.ts package.json bun.lock
git commit -m "feat: implement backup command"
```

---

### Task 4.7: Implement restore Command

**Files:**
- Create: `src/commands/restore.ts`

**Step 1: Write restore command**

`src/commands/restore.ts`:
```typescript
import { defineCommand } from "citty"
import { ConfigStore } from "../core/config-store"
import { AgentRegistry } from "../core/agent-registry"
import { SnapshotManager } from "../core/snapshot"
import { getConfigPath, getSnapshotsDir, expandPath } from "../utils/paths"
import { mkdir, readFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import * as tar from "tar"

export default defineCommand({
  meta: {
    name: "restore",
    description: "Restore skills from backup",
  },
  args: {
    path: {
      type: "positional",
      description: "Backup path (.tar.gz)",
      required: true,
    },
    to: {
      type: "string",
      description: "Restore to specific agent only",
    },
    snapshot: {
      type: "string",
      description: "Restore from snapshot ID instead of backup file",
    },
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

    // Handle snapshot restore
    if (args.snapshot) {
      const snapshots = new SnapshotManager(
        getSnapshotsDir(),
        config.snapshots.maxCount
      )
      const list = await snapshots.listSnapshots()
      const snapshot = list.find((s) => s.id === args.snapshot)

      if (!snapshot) {
        console.error(`Snapshot not found: ${args.snapshot}`)
        process.exit(1)
      }

      console.log(`\nRestoring from snapshot: ${snapshot.id}`)
      console.log(`Skills: ${snapshot.skills.join(", ")}`)

      if (args.dryRun) {
        console.log("\n(dry run - no changes made)")
        return
      }

      // Restore to all detected agents or specific one
      const targetAgents = args.to
        ? [args.to]
        : Object.entries(config.agents)
            .filter(([_, a]) => a.detected)
            .map(([id]) => id)

      for (const agentId of targetAgents) {
        const agent = config.agents[agentId]
        if (!agent) continue
        await snapshots.restore(args.snapshot, expandPath(agent.globalPath))
        console.log(`Restored to ${agent.name}`)
      }

      console.log("\nRestore complete!")
      return
    }

    // Handle backup file restore
    const tempDir = join(dirname(args.path), `.simba-restore-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })

    // Extract backup
    await tar.extract({
      file: args.path,
      cwd: tempDir,
    })

    // Read manifest
    const manifest = JSON.parse(
      await readFile(join(tempDir, "manifest.json"), "utf-8")
    )

    console.log(`\nRestoring from backup: ${args.path}`)
    console.log(`Created: ${manifest.created}`)
    console.log(`Skills: ${Object.keys(manifest.skills).length}`)

    if (args.dryRun) {
      console.log("\nWould restore:")
      for (const skillName of Object.keys(manifest.skills)) {
        console.log(`  ${skillName}`)
      }
      console.log("\n(dry run - no changes made)")
      await Bun.$`rm -rf ${tempDir}`
      return
    }

    // Determine target agents
    const targetAgents = args.to
      ? [args.to]
      : Object.entries(config.agents)
          .filter(([_, a]) => a.detected)
          .map(([id]) => id)

    // Copy skills to targets
    for (const agentId of targetAgents) {
      const agent = config.agents[agentId]
      if (!agent) continue

      const skillsPath = expandPath(agent.globalPath)
      await mkdir(skillsPath, { recursive: true })

      for (const skillName of Object.keys(manifest.skills)) {
        const sourcePath = join(tempDir, "skills", skillName)
        const destPath = join(skillsPath, skillName)
        await Bun.$`cp -r ${sourcePath} ${destPath}`
      }

      console.log(`Restored to ${agent.name}`)
    }

    // Cleanup temp
    await Bun.$`rm -rf ${tempDir}`

    console.log("\nRestore complete!")
  },
})
```

**Step 2: Verify it runs**

Run: `bun run src/index.ts restore --help`
Expected: Shows help for restore command

**Step 3: Commit**

```bash
git add src/commands/restore.ts
git commit -m "feat: implement restore command"
```

---

### Task 4.8: Implement import Command

**Files:**
- Create: `src/commands/import.ts`

**Step 1: Write import command**

`src/commands/import.ts`:
```typescript
import { defineCommand } from "citty"
import { ConfigStore } from "../core/config-store"
import { AgentRegistry } from "../core/agent-registry"
import { getConfigPath, expandPath } from "../utils/paths"
import { mkdir, access } from "node:fs/promises"
import { join } from "node:path"

export default defineCommand({
  meta: {
    name: "import",
    description: "Copy a global skill into current project",
  },
  args: {
    skill: {
      type: "positional",
      description: "Skill name to import",
      required: true,
    },
    to: {
      type: "string",
      description: "Target directory (defaults to detected agent's project path)",
    },
    agent: {
      type: "string",
      description: "Source agent (defaults to first detected with skill)",
    },
  },
  async run({ args }) {
    const configStore = new ConfigStore(getConfigPath())
    const config = await configStore.load()
    const registry = new AgentRegistry(config.agents)

    // Find skill source
    let sourceAgent: string | null = null
    let sourcePath: string | null = null

    if (args.agent) {
      const agent = config.agents[args.agent]
      if (!agent || !agent.detected) {
        console.error(`Agent not found or not detected: ${args.agent}`)
        process.exit(1)
      }

      const skillPath = registry.getSkillPath(args.skill, args.agent)
      try {
        await access(join(skillPath, "SKILL.md"))
        sourceAgent = args.agent
        sourcePath = skillPath
      } catch {
        console.error(`Skill not found in ${args.agent}: ${args.skill}`)
        process.exit(1)
      }
    } else {
      // Find first agent with this skill
      for (const [agentId, agent] of Object.entries(config.agents)) {
        if (!agent.detected) continue

        const skillPath = registry.getSkillPath(args.skill, agentId)
        try {
          await access(join(skillPath, "SKILL.md"))
          sourceAgent = agentId
          sourcePath = skillPath
          break
        } catch {
          continue
        }
      }
    }

    if (!sourceAgent || !sourcePath) {
      console.error(`Skill not found: ${args.skill}`)
      process.exit(1)
    }

    // Determine target path
    let targetPath: string

    if (args.to) {
      targetPath = join(args.to, args.skill)
    } else {
      // Use project path of source agent
      const agent = config.agents[sourceAgent]
      targetPath = join(process.cwd(), agent.projectPath, args.skill)
    }

    // Check if target exists
    try {
      await access(targetPath)
      console.error(`Skill already exists at: ${targetPath}`)
      process.exit(1)
    } catch {
      // Good, doesn't exist
    }

    // Copy skill
    await mkdir(join(targetPath, ".."), { recursive: true })
    await Bun.$`cp -r ${sourcePath} ${targetPath}`

    console.log(`\nImported: ${args.skill}`)
    console.log(`From: ${config.agents[sourceAgent].name}`)
    console.log(`To: ${targetPath}`)
  },
})
```

**Step 2: Verify it runs**

Run: `bun run src/index.ts import --help`
Expected: Shows help for import command

**Step 3: Commit**

```bash
git add src/commands/import.ts
git commit -m "feat: implement import command for project-level skills"
```

---

### Task 4.9: Implement undo Command

**Files:**
- Create: `src/commands/undo.ts`

**Step 1: Write undo command**

`src/commands/undo.ts`:
```typescript
import { defineCommand } from "citty"
import { ConfigStore } from "../core/config-store"
import { SnapshotManager } from "../core/snapshot"
import { getConfigPath, getSnapshotsDir, expandPath } from "../utils/paths"

export default defineCommand({
  meta: {
    name: "undo",
    description: "Restore from most recent snapshot",
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

    const snapshots = new SnapshotManager(
      getSnapshotsDir(),
      config.snapshots.maxCount
    )

    const latest = await snapshots.getLatestSnapshot()

    if (!latest) {
      console.log("No snapshots available.")
      return
    }

    console.log(`\nLatest snapshot: ${latest.id}`)
    console.log(`Reason: ${latest.reason}`)
    console.log(`Created: ${latest.created}`)
    console.log(`Skills: ${latest.skills.join(", ")}`)

    if (args.dryRun) {
      console.log("\n(dry run - no changes made)")
      return
    }

    // Restore to all detected agents
    const targetAgents = Object.entries(config.agents)
      .filter(([_, a]) => a.detected)
      .map(([id, a]) => ({ id, path: expandPath(a.globalPath) }))

    for (const { id, path } of targetAgents) {
      await snapshots.restore(latest.id, path)
      console.log(`Restored to ${config.agents[id].name}`)
    }

    console.log("\nUndo complete!")
  },
})
```

**Step 2: Verify it runs**

Run: `bun run src/index.ts undo --help`
Expected: Shows help for undo command

**Step 3: Commit**

```bash
git add src/commands/undo.ts
git commit -m "feat: implement undo command"
```

---

### Task 4.10: Implement snapshots Command

**Files:**
- Create: `src/commands/snapshots.ts`

**Step 1: Write snapshots command**

`src/commands/snapshots.ts`:
```typescript
import { defineCommand } from "citty"
import { ConfigStore } from "../core/config-store"
import { SnapshotManager } from "../core/snapshot"
import { getConfigPath, getSnapshotsDir } from "../utils/paths"

export default defineCommand({
  meta: {
    name: "snapshots",
    description: "List available snapshots",
  },
  async run() {
    const configStore = new ConfigStore(getConfigPath())
    const config = await configStore.load()

    const snapshots = new SnapshotManager(
      getSnapshotsDir(),
      config.snapshots.maxCount
    )

    const list = await snapshots.listSnapshots()

    if (list.length === 0) {
      console.log("No snapshots available.")
      return
    }

    console.log("\nAvailable snapshots:\n")

    for (const snapshot of list) {
      console.log(`  ${snapshot.id}`)
      console.log(`    Reason: ${snapshot.reason}`)
      console.log(`    Skills: ${snapshot.skills.length}`)
      console.log("")
    }

    console.log(`Total: ${list.length} snapshots`)
    console.log(`\nUse 'simba restore --snapshot <id>' to restore`)
  },
})
```

**Step 2: Verify it runs**

Run: `bun run src/index.ts snapshots`
Expected: Shows "No snapshots available" or list of snapshots

**Step 3: Commit**

```bash
git add src/commands/snapshots.ts
git commit -m "feat: implement snapshots command"
```

---

## Phase 5: Export paths utility fix

### Task 5.1: Fix paths export

**Files:**
- Modify: `src/utils/paths.ts`

**Step 1: Add expandPath to exports used by commands**

Check `src/utils/paths.ts` includes all needed exports. Add if missing:

```typescript
export { expandPath, getConfigDir, getConfigPath, getSnapshotsDir }
```

**Step 2: Run all tests**

Run: `bun test`
Expected: All tests pass

**Step 3: Commit if changes made**

```bash
git add src/utils/paths.ts
git commit -m "fix: ensure all path utilities are exported"
```

---

## Phase 6: Integration Testing

### Task 6.1: Run Full Test Suite

**Step 1: Run all tests**

Run: `bun test`
Expected: All tests pass (9+ tests)

**Step 2: Test CLI manually**

```bash
bun run src/index.ts --help
bun run src/index.ts detect
bun run src/index.ts status
bun run src/index.ts sync --dry-run
```

**Step 3: Commit any fixes**

---

## Phase 7: TUI (Deferred)

TUI implementation using OpenTUI + Solid is deferred to a separate implementation plan. Core CLI is complete and functional.

---

## Summary

**Files created:**
- `src/index.ts` - CLI entry
- `src/core/types.ts` - Type definitions
- `src/core/config-store.ts` - TOML config persistence
- `src/core/agent-registry.ts` - Agent/skill detection
- `src/core/skill-manager.ts` - Sync/matrix logic
- `src/core/snapshot.ts` - Undo/snapshot support
- `src/utils/paths.ts` - XDG path utilities
- `src/utils/hash.ts` - Git-style hashing
- `src/commands/*.ts` - All CLI commands

**Tests:**
- `tests/core/config-store.test.ts`
- `tests/core/agent-registry.test.ts`
- `tests/core/skill-manager.test.ts`
- `tests/core/snapshot.test.ts`
- `tests/utils/paths.test.ts`
- `tests/utils/hash.test.ts`

**Commands implemented:**
- `simba detect` - Scan for agents/skills
- `simba status` - Show skill matrix
- `simba sync` - Union merge skills
- `simba migrate` - Copy skills between agents
- `simba backup` - Export to tar.gz
- `simba restore` - Restore from backup
- `simba import` - Copy to project
- `simba undo` - Restore latest snapshot
- `simba snapshots` - List snapshots
