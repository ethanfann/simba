import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { SnapshotManager } from "../../src/core/snapshot"

// Prefix to disable all default agents
const DISABLE_DEFAULTS = `[agents.claude]
detected = false

[agents.cursor]
detected = false

[agents.codex]
detected = false

[agents.opencode]
detected = false

[agents.antigravity]
detected = false

`

describe("snapshots command", () => {
  let tempDir: string
  let originalEnv: string | undefined
  let consoleLogs: string[]

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "simba-snapshots-"))
    originalEnv = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = tempDir

    consoleLogs = []
    spyOn(console, "log").mockImplementation((msg: string) => {
      consoleLogs.push(msg)
    })
  })

  afterEach(async () => {
    if (originalEnv !== undefined) {
      process.env.XDG_CONFIG_HOME = originalEnv
    } else {
      delete process.env.XDG_CONFIG_HOME
    }
    await rm(tempDir, { recursive: true })
  })

  test("shows 'No snapshots available' when no snapshots exist", async () => {
    // Create config dir but no snapshots
    await mkdir(join(tempDir, "simba"), { recursive: true })
    await writeFile(
      join(tempDir, "simba/config.toml"),
      DISABLE_DEFAULTS
    )

    delete require.cache[require.resolve("../../src/commands/snapshots")]

    const snapshotsCommand = (await import("../../src/commands/snapshots")).default
    await snapshotsCommand.run!({ args: {} } as any)

    expect(consoleLogs.some((log) => log.includes("No snapshots available"))).toBe(true)
  })

  test("lists available snapshots with id, reason, and skill count", async () => {
    await mkdir(join(tempDir, "simba/snapshots"), { recursive: true })
    await writeFile(
      join(tempDir, "simba/config.toml"),
      DISABLE_DEFAULTS
    )

    // Create a snapshot using SnapshotManager
    const snapshotsDir = join(tempDir, "simba/snapshots")
    const snapshotManager = new SnapshotManager(snapshotsDir, 10)

    // Create source skill to snapshot
    const sourceSkillDir = join(tempDir, "source-skills/test-skill")
    await mkdir(sourceSkillDir, { recursive: true })
    await writeFile(join(sourceSkillDir, "SKILL.md"), "---\nname: test-skill\n---\nTest content")

    const snapshotId = await snapshotManager.createSnapshot(
      [sourceSkillDir],
      "test reason"
    )

    delete require.cache[require.resolve("../../src/commands/snapshots")]

    const snapshotsCommand = (await import("../../src/commands/snapshots")).default
    await snapshotsCommand.run!({ args: {} } as any)

    // Should show header
    expect(consoleLogs.some((log) => log.includes("Available snapshots"))).toBe(true)

    // Should show snapshot id
    expect(consoleLogs.some((log) => log.includes(snapshotId))).toBe(true)

    // Should show reason
    expect(consoleLogs.some((log) => log.includes("Reason: test reason"))).toBe(true)

    // Should show skill count
    expect(consoleLogs.some((log) => log.includes("Skills: 1"))).toBe(true)

    // Should show total
    expect(consoleLogs.some((log) => log.includes("Total: 1 snapshots"))).toBe(true)

    // Should show restore hint
    expect(consoleLogs.some((log) => log.includes("simba restore --snapshot"))).toBe(true)
  })

  test("lists multiple snapshots with correct total count", async () => {
    await mkdir(join(tempDir, "simba/snapshots"), { recursive: true })
    await writeFile(
      join(tempDir, "simba/config.toml"),
      DISABLE_DEFAULTS
    )

    const snapshotsDir = join(tempDir, "simba/snapshots")
    const snapshotManager = new SnapshotManager(snapshotsDir, 10)

    // Create multiple source skills
    const skill1Dir = join(tempDir, "source-skills/skill-1")
    const skill2Dir = join(tempDir, "source-skills/skill-2")
    await mkdir(skill1Dir, { recursive: true })
    await mkdir(skill2Dir, { recursive: true })
    await writeFile(join(skill1Dir, "SKILL.md"), "---\nname: skill-1\n---")
    await writeFile(join(skill2Dir, "SKILL.md"), "---\nname: skill-2\n---")

    // Create two snapshots
    await snapshotManager.createSnapshot([skill1Dir], "first snapshot")
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10))
    await snapshotManager.createSnapshot([skill1Dir, skill2Dir], "second snapshot")

    delete require.cache[require.resolve("../../src/commands/snapshots")]

    const snapshotsCommand = (await import("../../src/commands/snapshots")).default
    await snapshotsCommand.run!({ args: {} } as any)

    // Should show both reasons
    expect(consoleLogs.some((log) => log.includes("Reason: first snapshot"))).toBe(true)
    expect(consoleLogs.some((log) => log.includes("Reason: second snapshot"))).toBe(true)

    // Should show total of 2
    expect(consoleLogs.some((log) => log.includes("Total: 2 snapshots"))).toBe(true)
  })
})
