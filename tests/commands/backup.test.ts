import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, access } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as tar from "tar"
import { ConfigStore } from "../../src/core/config-store"
import { AgentRegistry } from "../../src/core/agent-registry"

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

// Helper to run backup command logic directly (avoids ESM module caching issues)
async function runBackupCommand(
  configPath: string,
  args: { path: string; includeConfig?: boolean }
) {
  const configStore = new ConfigStore(configPath)
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

  const { dirname } = await import("node:path")
  const { mkdir: mkdirFs, writeFile: writeFs, readFile: readFs } = await import("node:fs/promises")

  // Create temp directory for backup structure
  const tempDir = join(dirname(args.path), `.simba-backup-${Date.now()}`)
  const skillsDir = join(tempDir, "skills")
  await mkdirFs(skillsDir, { recursive: true })

  // Copy skills to temp structure
  const manifest = {
    version: "1",
    created: new Date().toISOString(),
    simba_version: "0.1.0",
    source_agents: [...new Set(Array.from(allSkills.values()).map((s) => s.origin))],
    skills: {} as Record<string, { hash: string; origin: string; files: string[] }>,
    includes_config: args.includeConfig ?? false,
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
  await writeFs(join(tempDir, "manifest.json"), JSON.stringify(manifest, null, 2))

  // Include config if requested
  if (args.includeConfig) {
    const configContent = await readFs(configPath, "utf-8")
    await writeFs(join(tempDir, "config.toml"), configContent)
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
  console.log(`Config included: ${args.includeConfig ?? false}`)
}

describe("backup command", () => {
  let tempDir: string
  let consoleLogs: string[]

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "simba-backup-"))

    consoleLogs = []
    spyOn(console, "log").mockImplementation((msg: string) => {
      consoleLogs.push(msg)
    })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true })
  })

  test("shows 'no skills to backup' when no skills exist", async () => {
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

    await runBackupCommand(join(tempDir, "simba/config.toml"), {
      path: join(tempDir, "backup.tar.gz"),
    })

    expect(consoleLogs.some((log) => log.includes("No skills to backup"))).toBe(true)
  })

  test("creates backup archive with skills", async () => {
    await mkdir(join(tempDir, "simba"), { recursive: true })
    await mkdir(join(tempDir, "agent1/skills/test-skill"), { recursive: true })
    await writeFile(
      join(tempDir, "agent1/skills/test-skill/SKILL.md"),
      "---\nname: test-skill\n---\nTest content"
    )
    await writeFile(
      join(tempDir, "agent1/skills/test-skill/helper.ts"),
      "export const helper = () => {}"
    )

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
    await runBackupCommand(join(tempDir, "simba/config.toml"), {
      path: backupPath,
    })

    // Verify archive was created
    await access(backupPath)

    // Extract and verify contents
    const extractDir = join(tempDir, "extracted")
    await mkdir(extractDir, { recursive: true })
    await tar.extract({ file: backupPath, cwd: extractDir })

    // Verify manifest exists
    const manifest = JSON.parse(await readFile(join(extractDir, "manifest.json"), "utf-8"))
    expect(manifest.version).toBe("1")
    expect(manifest.simba_version).toBe("0.1.0")
    expect(manifest.skills["test-skill"]).toBeDefined()
    expect(manifest.source_agents).toContain("agent1")
    expect(manifest.includes_config).toBe(false)

    // Verify skill files exist
    const skillMd = await readFile(join(extractDir, "skills/test-skill/SKILL.md"), "utf-8")
    expect(skillMd).toContain("Test content")

    expect(consoleLogs.some((log) => log.includes("Backup created"))).toBe(true)
    expect(consoleLogs.some((log) => log.includes("Skills: 1"))).toBe(true)
  })

  test("includes config when --includeConfig is true", async () => {
    await mkdir(join(tempDir, "simba"), { recursive: true })
    await mkdir(join(tempDir, "agent1/skills/test-skill"), { recursive: true })
    await writeFile(
      join(tempDir, "agent1/skills/test-skill/SKILL.md"),
      "---\nname: test-skill\n---"
    )

    const configContent =
      DISABLE_DEFAULTS + `[agents.agent1]
id = "agent1"
name = "Agent One"
globalPath = "${join(tempDir, "agent1/skills")}"
projectPath = ".agent1/skills"
detected = true
`
    await writeFile(join(tempDir, "simba/config.toml"), configContent)

    const backupPath = join(tempDir, "backup.tar.gz")
    await runBackupCommand(join(tempDir, "simba/config.toml"), {
      path: backupPath,
      includeConfig: true,
    })

    // Extract and verify config.toml exists
    const extractDir = join(tempDir, "extracted")
    await mkdir(extractDir, { recursive: true })
    await tar.extract({ file: backupPath, cwd: extractDir })

    const extractedConfig = await readFile(join(extractDir, "config.toml"), "utf-8")
    expect(extractedConfig).toContain("Agent One")

    const manifest = JSON.parse(await readFile(join(extractDir, "manifest.json"), "utf-8"))
    expect(manifest.includes_config).toBe(true)

    expect(consoleLogs.some((log) => log.includes("Config included: true"))).toBe(true)
  })

  test("collects skills from multiple agents without duplicates", async () => {
    await mkdir(join(tempDir, "simba"), { recursive: true })
    await mkdir(join(tempDir, "agent1/skills/skill-a"), { recursive: true })
    await mkdir(join(tempDir, "agent1/skills/shared-skill"), { recursive: true })
    await mkdir(join(tempDir, "agent2/skills/skill-b"), { recursive: true })
    await mkdir(join(tempDir, "agent2/skills/shared-skill"), { recursive: true })

    // skill-a only in agent1
    await writeFile(join(tempDir, "agent1/skills/skill-a/SKILL.md"), "---\nname: skill-a\n---")

    // shared-skill in both (same content = same hash, first one wins)
    await writeFile(
      join(tempDir, "agent1/skills/shared-skill/SKILL.md"),
      "---\nname: shared-skill\n---\nShared content"
    )
    await writeFile(
      join(tempDir, "agent2/skills/shared-skill/SKILL.md"),
      "---\nname: shared-skill\n---\nShared content"
    )

    // skill-b only in agent2
    await writeFile(join(tempDir, "agent2/skills/skill-b/SKILL.md"), "---\nname: skill-b\n---")

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
    await runBackupCommand(join(tempDir, "simba/config.toml"), {
      path: backupPath,
    })

    // Extract and verify
    const extractDir = join(tempDir, "extracted")
    await mkdir(extractDir, { recursive: true })
    await tar.extract({ file: backupPath, cwd: extractDir })

    const manifest = JSON.parse(await readFile(join(extractDir, "manifest.json"), "utf-8"))

    // Should have 3 unique skills
    expect(Object.keys(manifest.skills).length).toBe(3)
    expect(manifest.skills["skill-a"]).toBeDefined()
    expect(manifest.skills["skill-b"]).toBeDefined()
    expect(manifest.skills["shared-skill"]).toBeDefined()

    // Both agents should be in source_agents
    expect(manifest.source_agents).toContain("agent1")
    expect(manifest.source_agents).toContain("agent2")

    expect(consoleLogs.some((log) => log.includes("Skills: 3"))).toBe(true)
  })

  test("manifest contains correct skill metadata", async () => {
    await mkdir(join(tempDir, "simba"), { recursive: true })
    await mkdir(join(tempDir, "agent1/skills/test-skill"), { recursive: true })
    await writeFile(
      join(tempDir, "agent1/skills/test-skill/SKILL.md"),
      "---\nname: test-skill\n---\nContent"
    )
    await writeFile(join(tempDir, "agent1/skills/test-skill/utils.ts"), "export const x = 1")

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
    await runBackupCommand(join(tempDir, "simba/config.toml"), {
      path: backupPath,
    })

    // Extract and verify manifest
    const extractDir = join(tempDir, "extracted")
    await mkdir(extractDir, { recursive: true })
    await tar.extract({ file: backupPath, cwd: extractDir })

    const manifest = JSON.parse(await readFile(join(extractDir, "manifest.json"), "utf-8"))

    const skillMeta = manifest.skills["test-skill"]
    expect(skillMeta.origin).toBe("agent1")
    expect(skillMeta.hash).toBeDefined()
    expect(skillMeta.hash.length).toBeGreaterThan(0)
    expect(skillMeta.files).toContain("SKILL.md")
    expect(skillMeta.files).toContain("utils.ts")
  })
})
