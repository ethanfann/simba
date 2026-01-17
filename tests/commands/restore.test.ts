import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, access } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as tar from "tar"
import { ConfigStore } from "../../src/core/config-store"
import { AgentRegistry } from "../../src/core/agent-registry"
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

// Helper to create a backup archive for testing restore
async function createTestBackup(
  backupPath: string,
  skills: Record<string, { content: string; files?: Record<string, string> }>,
  options?: { includeConfig?: boolean; configContent?: string }
) {
  const { dirname, join: pathJoin } = await import("node:path")
  const tempDir = pathJoin(dirname(backupPath), `.simba-test-backup-${Date.now()}`)
  const skillsDir = pathJoin(tempDir, "skills")
  await mkdir(skillsDir, { recursive: true })

  const manifest = {
    version: "1",
    created: new Date().toISOString(),
    simba_version: "0.1.0",
    source_agents: ["test-agent"],
    skills: {} as Record<string, { hash: string; origin: string; files: string[] }>,
    includes_config: options?.includeConfig ?? false,
  }

  for (const [name, { content, files }] of Object.entries(skills)) {
    const skillDir = pathJoin(skillsDir, name)
    await mkdir(skillDir, { recursive: true })
    await writeFile(pathJoin(skillDir, "SKILL.md"), content)

    const fileList = ["SKILL.md"]
    if (files) {
      for (const [fileName, fileContent] of Object.entries(files)) {
        await writeFile(pathJoin(skillDir, fileName), fileContent)
        fileList.push(fileName)
      }
    }

    manifest.skills[name] = {
      hash: "test-hash-" + name,
      origin: "test-agent",
      files: fileList,
    }
  }

  await writeFile(pathJoin(tempDir, "manifest.json"), JSON.stringify(manifest, null, 2))

  if (options?.includeConfig) {
    await writeFile(pathJoin(tempDir, "config.toml"), options.configContent ?? "")
  }

  const filesToTar = ["manifest.json", "skills"]
  if (options?.includeConfig) filesToTar.push("config.toml")

  await tar.create(
    { gzip: true, file: backupPath, cwd: tempDir },
    filesToTar
  )

  await Bun.$`rm -rf ${tempDir}`
}

// Helper to run restore command logic directly
async function runRestoreCommand(
  configPath: string,
  snapshotsDir: string,
  args: {
    path: string
    to?: string
    snapshot?: string
    dryRun?: boolean
  }
) {
  const configStore = new ConfigStore(configPath)
  const config = await configStore.load()

  // Handle snapshot restore
  if (args.snapshot) {
    const snapshots = new SnapshotManager(snapshotsDir, config.snapshots.maxCount)
    const list = await snapshots.listSnapshots()
    const snapshot = list.find((s) => s.id === args.snapshot)

    if (!snapshot) {
      console.error(`Snapshot not found: ${args.snapshot}`)
      process.exitCode = 1
      return
    }

    console.log(`\nRestoring from snapshot: ${snapshot.id}`)
    console.log(`Skills: ${snapshot.skills.join(", ")}`)

    if (args.dryRun) {
      console.log("\n(dry run - no changes made)")
      return
    }

    // Restore to all detected agents or specific one
    const { expandPath } = await import("../../src/utils/paths")
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
  const { dirname: dirnameImport, join: pathJoin } = await import("node:path")
  const { mkdir: mkdirFs, readFile: readFs } = await import("node:fs/promises")
  const { expandPath } = await import("../../src/utils/paths")

  const tempDir = pathJoin(dirnameImport(args.path), `.simba-restore-${Date.now()}`)
  await mkdirFs(tempDir, { recursive: true })

  // Extract backup
  await tar.extract({
    file: args.path,
    cwd: tempDir,
  })

  // Read manifest
  const manifest = JSON.parse(await readFs(pathJoin(tempDir, "manifest.json"), "utf-8"))

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
    await mkdirFs(skillsPath, { recursive: true })

    for (const skillName of Object.keys(manifest.skills)) {
      const sourcePath = pathJoin(tempDir, "skills", skillName)
      const destPath = pathJoin(skillsPath, skillName)
      await Bun.$`cp -r ${sourcePath} ${destPath}`
    }

    console.log(`Restored to ${agent.name}`)
  }

  // Cleanup temp
  await Bun.$`rm -rf ${tempDir}`

  console.log("\nRestore complete!")
}

describe("restore command", () => {
  let tempDir: string
  let consoleLogs: string[]
  let consoleErrors: string[]

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "simba-restore-"))

    consoleLogs = []
    consoleErrors = []
    spyOn(console, "log").mockImplementation((msg: string) => {
      consoleLogs.push(msg)
    })
    spyOn(console, "error").mockImplementation((msg: string) => {
      consoleErrors.push(msg)
    })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true })
  })

  describe("backup file restore", () => {
    test("restores skills from backup archive to detected agents", async () => {
      await mkdir(join(tempDir, "simba"), { recursive: true })
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

      // Create a backup archive
      const backupPath = join(tempDir, "backup.tar.gz")
      await createTestBackup(backupPath, {
        "test-skill": {
          content: "---\nname: test-skill\n---\nTest skill content",
          files: { "helper.ts": "export const x = 1" },
        },
      })

      await runRestoreCommand(
        join(tempDir, "simba/config.toml"),
        join(tempDir, "simba/snapshots"),
        { path: backupPath }
      )

      // Verify skill was restored
      const restoredSkillMd = await readFile(
        join(tempDir, "agent1/skills/test-skill/SKILL.md"),
        "utf-8"
      )
      expect(restoredSkillMd).toContain("Test skill content")

      const restoredHelper = await readFile(
        join(tempDir, "agent1/skills/test-skill/helper.ts"),
        "utf-8"
      )
      expect(restoredHelper).toBe("export const x = 1")

      expect(consoleLogs.some((log) => log.includes("Restore complete"))).toBe(true)
      expect(consoleLogs.some((log) => log.includes("Restored to Agent One"))).toBe(true)
    })

    test("restores multiple skills from backup", async () => {
      await mkdir(join(tempDir, "simba"), { recursive: true })
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

      const backupPath = join(tempDir, "backup.tar.gz")
      await createTestBackup(backupPath, {
        "skill-a": { content: "---\nname: skill-a\n---\nSkill A" },
        "skill-b": { content: "---\nname: skill-b\n---\nSkill B" },
        "skill-c": { content: "---\nname: skill-c\n---\nSkill C" },
      })

      await runRestoreCommand(
        join(tempDir, "simba/config.toml"),
        join(tempDir, "simba/snapshots"),
        { path: backupPath }
      )

      // Verify all skills restored
      const skillA = await readFile(join(tempDir, "agent1/skills/skill-a/SKILL.md"), "utf-8")
      const skillB = await readFile(join(tempDir, "agent1/skills/skill-b/SKILL.md"), "utf-8")
      const skillC = await readFile(join(tempDir, "agent1/skills/skill-c/SKILL.md"), "utf-8")

      expect(skillA).toContain("Skill A")
      expect(skillB).toContain("Skill B")
      expect(skillC).toContain("Skill C")

      expect(consoleLogs.some((log) => log.includes("Skills: 3"))).toBe(true)
    })

    test("restores to specific agent when --to is specified", async () => {
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

      const backupPath = join(tempDir, "backup.tar.gz")
      await createTestBackup(backupPath, {
        "test-skill": { content: "---\nname: test-skill\n---\nTest" },
      })

      await runRestoreCommand(
        join(tempDir, "simba/config.toml"),
        join(tempDir, "simba/snapshots"),
        { path: backupPath, to: "agent2" }
      )

      // Should only restore to agent2
      let agent1HasSkill = false
      try {
        await access(join(tempDir, "agent1/skills/test-skill/SKILL.md"))
        agent1HasSkill = true
      } catch {
        agent1HasSkill = false
      }
      expect(agent1HasSkill).toBe(false)

      const agent2Skill = await readFile(
        join(tempDir, "agent2/skills/test-skill/SKILL.md"),
        "utf-8"
      )
      expect(agent2Skill).toContain("Test")

      expect(consoleLogs.some((log) => log.includes("Restored to Agent Two"))).toBe(true)
      expect(consoleLogs.some((log) => log.includes("Restored to Agent One"))).toBe(false)
    })

    test("dry run shows what would be restored without changes", async () => {
      await mkdir(join(tempDir, "simba"), { recursive: true })
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

      const backupPath = join(tempDir, "backup.tar.gz")
      await createTestBackup(backupPath, {
        "skill-a": { content: "---\nname: skill-a\n---" },
        "skill-b": { content: "---\nname: skill-b\n---" },
      })

      await runRestoreCommand(
        join(tempDir, "simba/config.toml"),
        join(tempDir, "simba/snapshots"),
        { path: backupPath, dryRun: true }
      )

      // Should show what would be restored
      expect(consoleLogs.some((log) => log.includes("Would restore"))).toBe(true)
      expect(consoleLogs.some((log) => log.includes("skill-a"))).toBe(true)
      expect(consoleLogs.some((log) => log.includes("skill-b"))).toBe(true)
      expect(consoleLogs.some((log) => log.includes("dry run"))).toBe(true)

      // Should NOT actually restore
      let skillExists = false
      try {
        await access(join(tempDir, "agent1/skills/skill-a/SKILL.md"))
        skillExists = true
      } catch {
        skillExists = false
      }
      expect(skillExists).toBe(false)
    })

    test("restores to all detected agents", async () => {
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

[agents.agent3]
id = "agent3"
name = "Agent Three"
globalPath = "${join(tempDir, "agent3/skills")}"
projectPath = ".agent3/skills"
detected = false
`
      )

      const backupPath = join(tempDir, "backup.tar.gz")
      await createTestBackup(backupPath, {
        "test-skill": { content: "---\nname: test-skill\n---\nTest" },
      })

      await runRestoreCommand(
        join(tempDir, "simba/config.toml"),
        join(tempDir, "simba/snapshots"),
        { path: backupPath }
      )

      // Should restore to both detected agents
      const agent1Skill = await readFile(
        join(tempDir, "agent1/skills/test-skill/SKILL.md"),
        "utf-8"
      )
      const agent2Skill = await readFile(
        join(tempDir, "agent2/skills/test-skill/SKILL.md"),
        "utf-8"
      )

      expect(agent1Skill).toContain("Test")
      expect(agent2Skill).toContain("Test")

      // Should NOT restore to undetected agent3
      let agent3HasSkill = false
      try {
        await access(join(tempDir, "agent3/skills/test-skill/SKILL.md"))
        agent3HasSkill = true
      } catch {
        agent3HasSkill = false
      }
      expect(agent3HasSkill).toBe(false)

      expect(consoleLogs.some((log) => log.includes("Restored to Agent One"))).toBe(true)
      expect(consoleLogs.some((log) => log.includes("Restored to Agent Two"))).toBe(true)
    })
  })

  describe("snapshot restore", () => {
    test("restores skills from snapshot", async () => {
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
      await writeFile(join(sourceSkillDir, "SKILL.md"), "---\nname: my-skill\n---\nSnapshot content")

      const snapshotId = await snapshotManager.createSnapshot(
        [sourceSkillDir],
        "test snapshot"
      )

      await runRestoreCommand(
        join(tempDir, "simba/config.toml"),
        snapshotsDir,
        { path: "", snapshot: snapshotId }
      )

      // Verify skill was restored
      const restoredSkill = await readFile(
        join(tempDir, "agent1/skills/my-skill/SKILL.md"),
        "utf-8"
      )
      expect(restoredSkill).toContain("Snapshot content")

      expect(consoleLogs.some((log) => log.includes("Restoring from snapshot"))).toBe(true)
      expect(consoleLogs.some((log) => log.includes("Restore complete"))).toBe(true)
    })

    test("shows error for non-existent snapshot", async () => {
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

      const originalExitCode = process.exitCode
      await runRestoreCommand(
        join(tempDir, "simba/config.toml"),
        join(tempDir, "simba/snapshots"),
        { path: "", snapshot: "non-existent-snapshot-id" }
      )

      expect(consoleErrors.some((err) => err.includes("Snapshot not found"))).toBe(true)
      expect(process.exitCode).toBe(1)

      // Reset exit code
      process.exitCode = originalExitCode
    })

    test("snapshot dry run shows what would be restored", async () => {
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
      await writeFile(join(sourceSkillDir, "SKILL.md"), "---\nname: dry-run-skill\n---")

      const snapshotId = await snapshotManager.createSnapshot(
        [sourceSkillDir],
        "dry run test"
      )

      await runRestoreCommand(
        join(tempDir, "simba/config.toml"),
        snapshotsDir,
        { path: "", snapshot: snapshotId, dryRun: true }
      )

      expect(consoleLogs.some((log) => log.includes("Restoring from snapshot"))).toBe(true)
      expect(consoleLogs.some((log) => log.includes("dry run"))).toBe(true)

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

    test("restores snapshot to specific agent when --to is specified", async () => {
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
`
      )

      const snapshotsDir = join(tempDir, "simba/snapshots")
      const snapshotManager = new SnapshotManager(snapshotsDir, 10)

      const sourceSkillDir = join(tempDir, "source-skills/targeted-skill")
      await mkdir(sourceSkillDir, { recursive: true })
      await writeFile(join(sourceSkillDir, "SKILL.md"), "---\nname: targeted-skill\n---\nTargeted")

      const snapshotId = await snapshotManager.createSnapshot(
        [sourceSkillDir],
        "targeted restore"
      )

      await runRestoreCommand(
        join(tempDir, "simba/config.toml"),
        snapshotsDir,
        { path: "", snapshot: snapshotId, to: "agent2" }
      )

      // Should only restore to agent2
      let agent1HasSkill = false
      try {
        await access(join(tempDir, "agent1/skills/targeted-skill/SKILL.md"))
        agent1HasSkill = true
      } catch {
        agent1HasSkill = false
      }
      expect(agent1HasSkill).toBe(false)

      const agent2Skill = await readFile(
        join(tempDir, "agent2/skills/targeted-skill/SKILL.md"),
        "utf-8"
      )
      expect(agent2Skill).toContain("Targeted")

      expect(consoleLogs.some((log) => log.includes("Restored to Agent Two"))).toBe(true)
    })
  })
})
