import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigStore } from "../../src/core/config-store"
import { SnapshotManager } from "../../src/core/snapshot"

// Prefix to disable all default agents (so they don't pick up real skills from the machine)
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

// Helper to run undo command logic directly
async function runUndoCommand(
  configPath: string,
  snapshotsDir: string,
  args: { dryRun?: boolean }
) {
  const { expandPath } = await import("../../src/utils/paths")
  const configStore = new ConfigStore(configPath)
  const config = await configStore.load()

  const snapshots = new SnapshotManager(snapshotsDir, config.snapshots.maxCount)

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
}

describe("undo command", () => {
  let tempDir: string
  let consoleLogs: string[]

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "simba-undo-"))

    consoleLogs = []
    spyOn(console, "log").mockImplementation((msg: string) => {
      consoleLogs.push(msg)
    })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true })
  })

  test("shows 'no snapshots available' when no snapshots exist", async () => {
    await mkdir(join(tempDir, "simba/snapshots"), { recursive: true })
    await mkdir(join(tempDir, "agent1/skills"), { recursive: true })

    await writeFile(
      join(tempDir, "simba/config.toml"),
      DISABLE_DEFAULTS + `[agents.agent1]
id = "agent1"
name = "Agent One"
globalPath = "${join(tempDir, "agent1/skills")}"
projectPath = ".agent1/skills"
detected = true
`
    )

    await runUndoCommand(
      join(tempDir, "simba/config.toml"),
      join(tempDir, "simba/snapshots"),
      {}
    )

    expect(consoleLogs.some((log) => log.includes("No snapshots available"))).toBe(true)
  })

  test("restores skills from latest snapshot to detected agents", async () => {
    await mkdir(join(tempDir, "simba/snapshots"), { recursive: true })
    await mkdir(join(tempDir, "agent1/skills"), { recursive: true })

    await writeFile(
      join(tempDir, "simba/config.toml"),
      DISABLE_DEFAULTS + `[agents.agent1]
id = "agent1"
name = "Agent One"
globalPath = "${join(tempDir, "agent1/skills")}"
projectPath = ".agent1/skills"
detected = true
`
    )

    // Create a snapshot using SnapshotManager
    const snapshotsDir = join(tempDir, "simba/snapshots")
    const snapshotManager = new SnapshotManager(snapshotsDir, 10)

    // Create source skill to snapshot
    const sourceSkillDir = join(tempDir, "source-skills/my-skill")
    await mkdir(sourceSkillDir, { recursive: true })
    await writeFile(
      join(sourceSkillDir, "SKILL.md"),
      "---\nname: my-skill\n---\nUndo test content"
    )

    await snapshotManager.createSnapshot([sourceSkillDir], "test undo snapshot")

    await runUndoCommand(
      join(tempDir, "simba/config.toml"),
      snapshotsDir,
      {}
    )

    // Verify skill was restored
    const restoredSkill = await readFile(
      join(tempDir, "agent1/skills/my-skill/SKILL.md"),
      "utf-8"
    )
    expect(restoredSkill).toContain("Undo test content")

    expect(consoleLogs.some((log) => log.includes("Latest snapshot"))).toBe(true)
    expect(consoleLogs.some((log) => log.includes("Restored to Agent One"))).toBe(true)
    expect(consoleLogs.some((log) => log.includes("Undo complete"))).toBe(true)
  })

  test("restores from the latest snapshot when multiple exist", async () => {
    await mkdir(join(tempDir, "simba/snapshots"), { recursive: true })
    await mkdir(join(tempDir, "agent1/skills"), { recursive: true })

    await writeFile(
      join(tempDir, "simba/config.toml"),
      DISABLE_DEFAULTS + `[agents.agent1]
id = "agent1"
name = "Agent One"
globalPath = "${join(tempDir, "agent1/skills")}"
projectPath = ".agent1/skills"
detected = true
`
    )

    const snapshotsDir = join(tempDir, "simba/snapshots")
    const snapshotManager = new SnapshotManager(snapshotsDir, 10)

    // Create first snapshot (older)
    const oldSkillDir = join(tempDir, "source-skills/old-skill")
    await mkdir(oldSkillDir, { recursive: true })
    await writeFile(join(oldSkillDir, "SKILL.md"), "---\nname: old-skill\n---\nOld content")
    await snapshotManager.createSnapshot([oldSkillDir], "old snapshot")

    // Wait a moment to ensure different timestamps
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Create second snapshot (newer - should be restored)
    const newSkillDir = join(tempDir, "source-skills/new-skill")
    await mkdir(newSkillDir, { recursive: true })
    await writeFile(join(newSkillDir, "SKILL.md"), "---\nname: new-skill\n---\nNew content")
    await snapshotManager.createSnapshot([newSkillDir], "new snapshot")

    await runUndoCommand(
      join(tempDir, "simba/config.toml"),
      snapshotsDir,
      {}
    )

    // Should restore from the LATEST snapshot (new-skill)
    const restoredSkill = await readFile(
      join(tempDir, "agent1/skills/new-skill/SKILL.md"),
      "utf-8"
    )
    expect(restoredSkill).toContain("New content")

    expect(consoleLogs.some((log) => log.includes("new snapshot"))).toBe(true)
  })

  test("dry run shows snapshot info without making changes", async () => {
    await mkdir(join(tempDir, "simba/snapshots"), { recursive: true })
    await mkdir(join(tempDir, "agent1/skills"), { recursive: true })

    await writeFile(
      join(tempDir, "simba/config.toml"),
      DISABLE_DEFAULTS + `[agents.agent1]
id = "agent1"
name = "Agent One"
globalPath = "${join(tempDir, "agent1/skills")}"
projectPath = ".agent1/skills"
detected = true
`
    )

    const snapshotsDir = join(tempDir, "simba/snapshots")
    const snapshotManager = new SnapshotManager(snapshotsDir, 10)

    const sourceSkillDir = join(tempDir, "source-skills/dry-run-skill")
    await mkdir(sourceSkillDir, { recursive: true })
    await writeFile(
      join(sourceSkillDir, "SKILL.md"),
      "---\nname: dry-run-skill\n---\nDry run content"
    )
    await snapshotManager.createSnapshot([sourceSkillDir], "dry run test")

    await runUndoCommand(
      join(tempDir, "simba/config.toml"),
      snapshotsDir,
      { dryRun: true }
    )

    // Should show snapshot info
    expect(consoleLogs.some((log) => log.includes("Latest snapshot"))).toBe(true)
    expect(consoleLogs.some((log) => log.includes("dry run test"))).toBe(true)
    expect(consoleLogs.some((log) => log.includes("dry run - no changes made"))).toBe(true)

    // Should NOT actually restore
    let skillExists = false
    try {
      await access(join(tempDir, "agent1/skills/dry-run-skill/SKILL.md"))
      skillExists = true
    } catch {
      skillExists = false
    }
    expect(skillExists).toBe(false)
  })

  test("restores to all detected agents", async () => {
    await mkdir(join(tempDir, "simba/snapshots"), { recursive: true })
    await mkdir(join(tempDir, "agent1/skills"), { recursive: true })
    await mkdir(join(tempDir, "agent2/skills"), { recursive: true })

    await writeFile(
      join(tempDir, "simba/config.toml"),
      DISABLE_DEFAULTS + `[agents.agent1]
id = "agent1"
name = "Agent One"
globalPath = "${join(tempDir, "agent1/skills")}"
projectPath = ".agent1/skills"
detected = true

[agents.agent2]
id = "agent2"
name = "Agent Two"
globalPath = "${join(tempDir, "agent2/skills")}"
projectPath = ".agent2/skills"
detected = true

[agents.agent3]
id = "agent3"
name = "Agent Three"
globalPath = "${join(tempDir, "agent3/skills")}"
projectPath = ".agent3/skills"
detected = false
`
    )

    const snapshotsDir = join(tempDir, "simba/snapshots")
    const snapshotManager = new SnapshotManager(snapshotsDir, 10)

    const sourceSkillDir = join(tempDir, "source-skills/multi-agent-skill")
    await mkdir(sourceSkillDir, { recursive: true })
    await writeFile(
      join(sourceSkillDir, "SKILL.md"),
      "---\nname: multi-agent-skill\n---\nMulti-agent content"
    )
    await snapshotManager.createSnapshot([sourceSkillDir], "multi-agent restore")

    await runUndoCommand(
      join(tempDir, "simba/config.toml"),
      snapshotsDir,
      {}
    )

    // Should restore to both detected agents
    const agent1Skill = await readFile(
      join(tempDir, "agent1/skills/multi-agent-skill/SKILL.md"),
      "utf-8"
    )
    const agent2Skill = await readFile(
      join(tempDir, "agent2/skills/multi-agent-skill/SKILL.md"),
      "utf-8"
    )

    expect(agent1Skill).toContain("Multi-agent content")
    expect(agent2Skill).toContain("Multi-agent content")

    // Should NOT restore to undetected agent3
    let agent3HasSkill = false
    try {
      await access(join(tempDir, "agent3/skills/multi-agent-skill/SKILL.md"))
      agent3HasSkill = true
    } catch {
      agent3HasSkill = false
    }
    expect(agent3HasSkill).toBe(false)

    expect(consoleLogs.some((log) => log.includes("Restored to Agent One"))).toBe(true)
    expect(consoleLogs.some((log) => log.includes("Restored to Agent Two"))).toBe(true)
  })

  test("displays snapshot metadata correctly", async () => {
    await mkdir(join(tempDir, "simba/snapshots"), { recursive: true })
    await mkdir(join(tempDir, "agent1/skills"), { recursive: true })

    await writeFile(
      join(tempDir, "simba/config.toml"),
      DISABLE_DEFAULTS + `[agents.agent1]
id = "agent1"
name = "Agent One"
globalPath = "${join(tempDir, "agent1/skills")}"
projectPath = ".agent1/skills"
detected = true
`
    )

    const snapshotsDir = join(tempDir, "simba/snapshots")
    const snapshotManager = new SnapshotManager(snapshotsDir, 10)

    const skill1Dir = join(tempDir, "source-skills/skill-1")
    const skill2Dir = join(tempDir, "source-skills/skill-2")
    await mkdir(skill1Dir, { recursive: true })
    await mkdir(skill2Dir, { recursive: true })
    await writeFile(join(skill1Dir, "SKILL.md"), "---\nname: skill-1\n---")
    await writeFile(join(skill2Dir, "SKILL.md"), "---\nname: skill-2\n---")

    await snapshotManager.createSnapshot([skill1Dir, skill2Dir], "metadata test reason")

    await runUndoCommand(
      join(tempDir, "simba/config.toml"),
      snapshotsDir,
      { dryRun: true }
    )

    // Check that metadata is displayed
    expect(consoleLogs.some((log) => log.includes("Latest snapshot:"))).toBe(true)
    expect(consoleLogs.some((log) => log.includes("Reason: metadata test reason"))).toBe(true)
    expect(consoleLogs.some((log) => log.includes("Created:"))).toBe(true)
    expect(consoleLogs.some((log) => log.includes("Skills: skill-1, skill-2"))).toBe(true)
  })
})
