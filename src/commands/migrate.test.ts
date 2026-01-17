import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { mkdir, writeFile, rm, readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

// Test fixtures
const testDir = join(tmpdir(), "simba-migrate-test-" + Date.now())
const configDir = join(testDir, "config")
const snapshotsDir = join(testDir, "snapshots")
const claudeSkillsDir = join(testDir, "claude-skills")
const cursorSkillsDir = join(testDir, "cursor-skills")

async function createSkill(baseDir: string, skillName: string, content: string) {
  const skillDir = join(baseDir, skillName)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, "SKILL.md"), content)
}

// Helper to create test config
function createTestConfig(overrides: Partial<{
  claudeDetected: boolean,
  cursorDetected: boolean,
  autoSnapshot: boolean,
}> = {}) {
  const { claudeDetected = true, cursorDetected = true, autoSnapshot = false } = overrides
  return {
    agents: {
      claude: {
        id: "claude",
        name: "Claude Code",
        globalPath: claudeSkillsDir,
        projectPath: ".claude/skills",
        detected: claudeDetected,
      },
      cursor: {
        id: "cursor",
        name: "Cursor",
        globalPath: cursorSkillsDir,
        projectPath: ".cursor/skills",
        detected: cursorDetected,
      },
    },
    sync: { strategy: "union" as const, sourceAgent: "" },
    snapshots: { maxCount: 10, autoSnapshot },
    skills: {},
  }
}

describe("migrate command", () => {
  beforeEach(async () => {
    await mkdir(configDir, { recursive: true })
    await mkdir(snapshotsDir, { recursive: true })
    await mkdir(claudeSkillsDir, { recursive: true })
    await mkdir(cursorSkillsDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("copies skills from source agent to target agent", async () => {
    // Setup: Create a skill in claude that doesn't exist in cursor
    await createSkill(claudeSkillsDir, "my-skill", "# My Skill")

    const { ConfigStore } = await import("../core/config-store")
    const configStore = new ConfigStore(join(configDir, "config.toml"))
    await configStore.save(createTestConfig())

    // Import and run the command with test dependencies
    const { runMigrate } = await import("./migrate")

    const logs: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => logs.push(args.join(" "))

    try {
      await runMigrate({
        from: "claude",
        to: "cursor",
        dryRun: false,
        configPath: join(configDir, "config.toml"),
        snapshotsDir,
      })
    } finally {
      console.log = originalLog
    }

    // Verify skill was copied to cursor
    const cursorEntries = await readdir(cursorSkillsDir)
    expect(cursorEntries).toContain("my-skill")

    // Verify content
    const copiedContent = await readFile(join(cursorSkillsDir, "my-skill", "SKILL.md"), "utf-8")
    expect(copiedContent).toBe("# My Skill")
  })

  test("skips skills that already exist in target", async () => {
    // Setup: Create same skill in both agents
    await createSkill(claudeSkillsDir, "shared-skill", "# From Claude")
    await createSkill(cursorSkillsDir, "shared-skill", "# From Cursor")

    const { ConfigStore } = await import("../core/config-store")
    const configStore = new ConfigStore(join(configDir, "config.toml"))
    await configStore.save(createTestConfig())

    const { runMigrate } = await import("./migrate")

    const logs: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => logs.push(args.join(" "))

    try {
      await runMigrate({
        from: "claude",
        to: "cursor",
        dryRun: false,
        configPath: join(configDir, "config.toml"),
        snapshotsDir,
      })
    } finally {
      console.log = originalLog
    }

    // Verify cursor skill content wasn't overwritten
    const cursorContent = await readFile(join(cursorSkillsDir, "shared-skill", "SKILL.md"), "utf-8")
    expect(cursorContent).toBe("# From Cursor")

    // Verify skip message - "Skipping" and skill name are on separate lines
    expect(logs.some(l => l.includes("Skipping"))).toBe(true)
    expect(logs.some(l => l.includes("shared-skill"))).toBe(true)
  })

  test("dry run does not copy skills", async () => {
    await createSkill(claudeSkillsDir, "test-skill", "# Test")

    const { ConfigStore } = await import("../core/config-store")
    const configStore = new ConfigStore(join(configDir, "config.toml"))
    await configStore.save(createTestConfig())

    const { runMigrate } = await import("./migrate")

    const logs: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => logs.push(args.join(" "))

    try {
      await runMigrate({
        from: "claude",
        to: "cursor",
        dryRun: true,
        configPath: join(configDir, "config.toml"),
        snapshotsDir,
      })
    } finally {
      console.log = originalLog
    }

    // Verify skill was NOT copied
    const cursorEntries = await readdir(cursorSkillsDir)
    expect(cursorEntries).not.toContain("test-skill")

    // Verify dry run message
    expect(logs.some(l => l.includes("dry run"))).toBe(true)
  })

  test("errors on unknown source agent", async () => {
    const { ConfigStore } = await import("../core/config-store")
    const configStore = new ConfigStore(join(configDir, "config.toml"))
    await configStore.save(createTestConfig())

    const { runMigrate } = await import("./migrate")

    const errors: string[] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => errors.push(args.join(" "))

    // Mock process.exit to throw so execution stops
    const originalExit = process.exit
    let exitCode: number | undefined
    ;(process as any).exit = (code: number) => {
      exitCode = code
      throw new Error("process.exit called")
    }

    try {
      await runMigrate({
        from: "unknown",
        to: "cursor",
        dryRun: false,
        configPath: join(configDir, "config.toml"),
        snapshotsDir,
      })
    } catch (e) {
      // Expected: process.exit throws
    } finally {
      console.error = originalError
      ;(process as any).exit = originalExit
    }

    expect(errors.some(e => e.includes("Unknown agent"))).toBe(true)
    expect(exitCode).toBe(1)
  })

  test("errors on undetected agent", async () => {
    const { ConfigStore } = await import("../core/config-store")
    const configStore = new ConfigStore(join(configDir, "config.toml"))
    await configStore.save(createTestConfig({ cursorDetected: false }))

    const { runMigrate } = await import("./migrate")

    const errors: string[] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => errors.push(args.join(" "))

    // Mock process.exit to throw so execution stops
    const originalExit = process.exit
    let exitCode: number | undefined
    ;(process as any).exit = (code: number) => {
      exitCode = code
      throw new Error("process.exit called")
    }

    try {
      await runMigrate({
        from: "claude",
        to: "cursor",
        dryRun: false,
        configPath: join(configDir, "config.toml"),
        snapshotsDir,
      })
    } catch (e) {
      // Expected: process.exit throws
    } finally {
      console.error = originalError
      ;(process as any).exit = originalExit
    }

    expect(errors.some(e => e.includes("not detected"))).toBe(true)
    expect(exitCode).toBe(1)
  })

  test("creates snapshot when autoSnapshot is enabled", async () => {
    await createSkill(claudeSkillsDir, "snapshot-skill", "# Snapshot Test")

    const { ConfigStore } = await import("../core/config-store")
    const configStore = new ConfigStore(join(configDir, "config.toml"))
    await configStore.save(createTestConfig({ autoSnapshot: true }))

    const { runMigrate } = await import("./migrate")

    const logs: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => logs.push(args.join(" "))

    try {
      await runMigrate({
        from: "claude",
        to: "cursor",
        dryRun: false,
        configPath: join(configDir, "config.toml"),
        snapshotsDir,
      })
    } finally {
      console.log = originalLog
    }

    // Verify snapshot was created
    expect(logs.some(l => l.includes("Snapshot created"))).toBe(true)

    // Verify snapshot directory exists
    const snapshotEntries = await readdir(snapshotsDir)
    expect(snapshotEntries.length).toBeGreaterThan(0)
  })
})
