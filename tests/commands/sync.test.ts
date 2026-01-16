import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ConfigStore } from "../../src/core/config-store"
import { AgentRegistry } from "../../src/core/agent-registry"
import { SkillManager } from "../../src/core/skill-manager"
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

// Helper to run sync command logic directly (avoids ESM module caching issues)
async function runSyncCommand(
  configPath: string,
  snapshotsDir: string,
  args: { dryRun?: boolean; source?: string }
) {
  const configStore = new ConfigStore(configPath)
  const config = await configStore.load()

  const registry = new AgentRegistry(config.agents)
  const manager = new SkillManager(registry, config.agents)
  const snapshots = new SnapshotManager(snapshotsDir, config.snapshots.maxCount)

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
}

describe("sync command", () => {
  let tempDir: string
  let consoleLogs: string[]

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "simba-sync-"))

    consoleLogs = []
    spyOn(console, "log").mockImplementation((msg: string) => {
      consoleLogs.push(msg)
    })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true })
  })

  test("shows 'all skills are synced' when no unique or conflict skills", async () => {
    // Create config with detected agents but no skills
    await mkdir(join(tempDir, "simba"), { recursive: true })
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
`
    )

    await runSyncCommand(
      join(tempDir, "simba/config.toml"),
      join(tempDir, "simba/snapshots"),
      { dryRun: false }
    )

    expect(consoleLogs.some((log) => log.includes("All skills are synced"))).toBe(true)
  })

  test("shows unique skills that will be copied in dry run mode", async () => {
    await mkdir(join(tempDir, "simba"), { recursive: true })
    await mkdir(join(tempDir, "agent1/skills/unique-skill"), { recursive: true })
    await mkdir(join(tempDir, "agent2/skills"), { recursive: true })
    await writeFile(
      join(tempDir, "agent1/skills/unique-skill/SKILL.md"),
      "---\nname: unique-skill\n---"
    )

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
`
    )

    await runSyncCommand(
      join(tempDir, "simba/config.toml"),
      join(tempDir, "simba/snapshots"),
      { dryRun: true }
    )

    expect(consoleLogs.some((log) => log.includes("Will copy"))).toBe(true)
    expect(consoleLogs.some((log) => log.includes("unique-skill"))).toBe(true)
    expect(consoleLogs.some((log) => log.includes("dry run"))).toBe(true)
  })

  test("shows conflict skills when no source agent specified", async () => {
    await mkdir(join(tempDir, "simba"), { recursive: true })
    await mkdir(join(tempDir, "agent1/skills/conflict-skill"), { recursive: true })
    await mkdir(join(tempDir, "agent2/skills/conflict-skill"), { recursive: true })
    // Different content = different hash = conflict
    await writeFile(
      join(tempDir, "agent1/skills/conflict-skill/SKILL.md"),
      "---\nname: conflict-skill\n---\nContent A"
    )
    await writeFile(
      join(tempDir, "agent2/skills/conflict-skill/SKILL.md"),
      "---\nname: conflict-skill\n---\nContent B"
    )

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
`
    )

    await runSyncCommand(
      join(tempDir, "simba/config.toml"),
      join(tempDir, "simba/snapshots"),
      { dryRun: true }
    )

    expect(consoleLogs.some((log) => log.includes("Conflicts"))).toBe(true)
    expect(consoleLogs.some((log) => log.includes("conflict-skill"))).toBe(true)
  })

  test("syncs unique skills to other agents when not dry run", async () => {
    await mkdir(join(tempDir, "simba"), { recursive: true })
    await mkdir(join(tempDir, "agent1/skills/unique-skill"), { recursive: true })
    await mkdir(join(tempDir, "agent2/skills"), { recursive: true })
    await writeFile(
      join(tempDir, "agent1/skills/unique-skill/SKILL.md"),
      "---\nname: unique-skill\n---\nSkill content"
    )

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

[snapshots]
maxCount = 10
autoSnapshot = false
`
    )

    await runSyncCommand(
      join(tempDir, "simba/config.toml"),
      join(tempDir, "simba/snapshots"),
      { dryRun: false }
    )

    // Verify skill was copied to agent2
    const copiedContent = await readFile(
      join(tempDir, "agent2/skills/unique-skill/SKILL.md"),
      "utf-8"
    )
    expect(copiedContent).toContain("unique-skill")
    expect(consoleLogs.some((log) => log.includes("Synced"))).toBe(true)
    expect(consoleLogs.some((log) => log.includes("Sync complete"))).toBe(true)
  })

  test("resolves conflicts using --source flag", async () => {
    await mkdir(join(tempDir, "simba"), { recursive: true })
    await mkdir(join(tempDir, "agent1/skills/conflict-skill"), { recursive: true })
    await mkdir(join(tempDir, "agent2/skills/conflict-skill"), { recursive: true })
    await writeFile(
      join(tempDir, "agent1/skills/conflict-skill/SKILL.md"),
      "---\nname: conflict-skill\n---\nAgent1 Content"
    )
    await writeFile(
      join(tempDir, "agent2/skills/conflict-skill/SKILL.md"),
      "---\nname: conflict-skill\n---\nAgent2 Content"
    )

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

[snapshots]
maxCount = 10
autoSnapshot = false
`
    )

    await runSyncCommand(
      join(tempDir, "simba/config.toml"),
      join(tempDir, "simba/snapshots"),
      { dryRun: false, source: "agent1" }
    )

    // Verify agent2's skill now has agent1's content
    const resolvedContent = await readFile(
      join(tempDir, "agent2/skills/conflict-skill/SKILL.md"),
      "utf-8"
    )
    expect(resolvedContent).toContain("Agent1 Content")
    expect(consoleLogs.some((log) => log.includes("Resolved"))).toBe(true)
  })

  test("creates snapshot before sync when autoSnapshot enabled", async () => {
    await mkdir(join(tempDir, "simba"), { recursive: true })
    await mkdir(join(tempDir, "agent1/skills/unique-skill"), { recursive: true })
    await mkdir(join(tempDir, "agent2/skills"), { recursive: true })
    await writeFile(
      join(tempDir, "agent1/skills/unique-skill/SKILL.md"),
      "---\nname: unique-skill\n---"
    )

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

[snapshots]
maxCount = 10
autoSnapshot = true
`
    )

    await runSyncCommand(
      join(tempDir, "simba/config.toml"),
      join(tempDir, "simba/snapshots"),
      { dryRun: false }
    )

    expect(consoleLogs.some((log) => log.includes("Snapshot created"))).toBe(true)
  })
})
