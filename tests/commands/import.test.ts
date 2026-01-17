import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
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

// Helper to run import command logic directly (avoids ESM module caching issues)
async function runImportCommand(
  configPath: string,
  args: { skill: string; to?: string; agent?: string },
  cwd: string = process.cwd()
): Promise<{ exitCode?: number }> {
  const configStore = new ConfigStore(configPath)
  const config = await configStore.load()
  const registry = new AgentRegistry(config.agents)

  // Find skill source
  let sourceAgent: string | null = null
  let sourcePath: string | null = null

  if (args.agent) {
    const agent = config.agents[args.agent]
    if (!agent || !agent.detected) {
      console.error(`Agent not found or not detected: ${args.agent}`)
      return { exitCode: 1 }
    }

    const skillPath = registry.getSkillPath(args.skill, args.agent)
    try {
      await access(join(skillPath, "SKILL.md"))
      sourceAgent = args.agent
      sourcePath = skillPath
    } catch {
      console.error(`Skill not found in ${args.agent}: ${args.skill}`)
      return { exitCode: 1 }
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
    return { exitCode: 1 }
  }

  // Determine target path
  let targetPath: string

  if (args.to) {
    targetPath = join(args.to, args.skill)
  } else {
    // Use project path of source agent
    const agent = config.agents[sourceAgent]
    targetPath = join(cwd, agent.projectPath, args.skill)
  }

  // Check if target exists
  try {
    await access(targetPath)
    console.error(`Skill already exists at: ${targetPath}`)
    return { exitCode: 1 }
  } catch {
    // Good, doesn't exist
  }

  // Copy skill
  const { mkdir: mkdirFs } = await import("node:fs/promises")
  await mkdirFs(join(targetPath, ".."), { recursive: true })
  await Bun.$`cp -r ${sourcePath} ${targetPath}`

  console.log(`\nImported: ${args.skill}`)
  console.log(`From: ${config.agents[sourceAgent].name}`)
  console.log(`To: ${targetPath}`)

  return {}
}

describe("import command", () => {
  let tempDir: string
  let consoleLogs: string[]
  let consoleErrors: string[]

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "simba-import-"))

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

  test("shows error when skill not found", async () => {
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

    const result = await runImportCommand(
      join(tempDir, "simba/config.toml"),
      { skill: "nonexistent-skill" },
      tempDir
    )

    expect(result.exitCode).toBe(1)
    expect(consoleErrors.some((log) => log.includes("Skill not found"))).toBe(true)
  })

  test("imports skill to default project path", async () => {
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

    const result = await runImportCommand(
      join(tempDir, "simba/config.toml"),
      { skill: "test-skill" },
      tempDir
    )

    expect(result.exitCode).toBeUndefined()

    // Verify skill was copied to project path
    const targetPath = join(tempDir, ".agent1/skills/test-skill")
    await access(targetPath)

    const skillMd = await readFile(join(targetPath, "SKILL.md"), "utf-8")
    expect(skillMd).toContain("Test content")

    const helperTs = await readFile(join(targetPath, "helper.ts"), "utf-8")
    expect(helperTs).toContain("export const helper")

    expect(consoleLogs.some((log) => log.includes("Imported: test-skill"))).toBe(true)
    expect(consoleLogs.some((log) => log.includes("From: Agent One"))).toBe(true)
  })

  test("imports skill to custom target path", async () => {
    await mkdir(join(tempDir, "simba"), { recursive: true })
    await mkdir(join(tempDir, "agent1/skills/test-skill"), { recursive: true })
    await mkdir(join(tempDir, "custom-target"), { recursive: true })
    await writeFile(
      join(tempDir, "agent1/skills/test-skill/SKILL.md"),
      "---\nname: test-skill\n---\nCustom path test"
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

    const customTarget = join(tempDir, "custom-target")
    const result = await runImportCommand(
      join(tempDir, "simba/config.toml"),
      { skill: "test-skill", to: customTarget },
      tempDir
    )

    expect(result.exitCode).toBeUndefined()

    // Verify skill was copied to custom path
    const targetPath = join(customTarget, "test-skill")
    await access(targetPath)

    const skillMd = await readFile(join(targetPath, "SKILL.md"), "utf-8")
    expect(skillMd).toContain("Custom path test")

    expect(consoleLogs.some((log) => log.includes(`To: ${targetPath}`))).toBe(true)
  })

  test("imports skill from specific agent", async () => {
    await mkdir(join(tempDir, "simba"), { recursive: true })
    await mkdir(join(tempDir, "agent1/skills/shared-skill"), { recursive: true })
    await mkdir(join(tempDir, "agent2/skills/shared-skill"), { recursive: true })

    await writeFile(
      join(tempDir, "agent1/skills/shared-skill/SKILL.md"),
      "---\nname: shared-skill\n---\nFrom agent1"
    )
    await writeFile(
      join(tempDir, "agent2/skills/shared-skill/SKILL.md"),
      "---\nname: shared-skill\n---\nFrom agent2"
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

    const customTarget = join(tempDir, "target")
    const result = await runImportCommand(
      join(tempDir, "simba/config.toml"),
      { skill: "shared-skill", agent: "agent2", to: customTarget },
      tempDir
    )

    expect(result.exitCode).toBeUndefined()

    // Verify skill was copied from agent2
    const skillMd = await readFile(join(customTarget, "shared-skill/SKILL.md"), "utf-8")
    expect(skillMd).toContain("From agent2")

    expect(consoleLogs.some((log) => log.includes("From: Agent Two"))).toBe(true)
  })

  test("shows error when agent not found", async () => {
    await mkdir(join(tempDir, "simba"), { recursive: true })
    await mkdir(join(tempDir, "agent1/skills/test-skill"), { recursive: true })
    await writeFile(
      join(tempDir, "agent1/skills/test-skill/SKILL.md"),
      "---\nname: test-skill\n---"
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

    const result = await runImportCommand(
      join(tempDir, "simba/config.toml"),
      { skill: "test-skill", agent: "nonexistent-agent" },
      tempDir
    )

    expect(result.exitCode).toBe(1)
    expect(consoleErrors.some((log) => log.includes("Agent not found or not detected"))).toBe(true)
  })

  test("shows error when skill not found in specified agent", async () => {
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

    const result = await runImportCommand(
      join(tempDir, "simba/config.toml"),
      { skill: "missing-skill", agent: "agent1" },
      tempDir
    )

    expect(result.exitCode).toBe(1)
    expect(consoleErrors.some((log) => log.includes("Skill not found in agent1"))).toBe(true)
  })

  test("shows error when target already exists", async () => {
    await mkdir(join(tempDir, "simba"), { recursive: true })
    await mkdir(join(tempDir, "agent1/skills/test-skill"), { recursive: true })
    await mkdir(join(tempDir, ".agent1/skills/test-skill"), { recursive: true }) // Pre-existing target

    await writeFile(
      join(tempDir, "agent1/skills/test-skill/SKILL.md"),
      "---\nname: test-skill\n---"
    )
    await writeFile(
      join(tempDir, ".agent1/skills/test-skill/SKILL.md"),
      "---\nname: test-skill\n---\nExisting"
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

    const result = await runImportCommand(
      join(tempDir, "simba/config.toml"),
      { skill: "test-skill" },
      tempDir
    )

    expect(result.exitCode).toBe(1)
    expect(consoleErrors.some((log) => log.includes("Skill already exists at"))).toBe(true)
  })

  test("finds first agent with skill when no agent specified", async () => {
    await mkdir(join(tempDir, "simba"), { recursive: true })
    await mkdir(join(tempDir, "agent1/skills"), { recursive: true }) // No skill here
    await mkdir(join(tempDir, "agent2/skills/test-skill"), { recursive: true })

    await writeFile(
      join(tempDir, "agent2/skills/test-skill/SKILL.md"),
      "---\nname: test-skill\n---\nFrom agent2"
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

    const customTarget = join(tempDir, "target")
    const result = await runImportCommand(
      join(tempDir, "simba/config.toml"),
      { skill: "test-skill", to: customTarget },
      tempDir
    )

    expect(result.exitCode).toBeUndefined()

    // Should have found and imported from agent2
    const skillMd = await readFile(join(customTarget, "test-skill/SKILL.md"), "utf-8")
    expect(skillMd).toContain("From agent2")

    expect(consoleLogs.some((log) => log.includes("From: Agent Two"))).toBe(true)
  })
})
