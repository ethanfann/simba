import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("status command", () => {
  let tempDir: string
  let originalEnv: string | undefined
  let consoleLogs: string[]

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "simba-status-"))
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

  test("shows 'no agents detected' message when no agents detected", async () => {
    // Create config with no detected agents
    await mkdir(join(tempDir, "simba"), { recursive: true })
    await writeFile(
      join(tempDir, "simba/config.toml"),
      `[agents.claude]
id = "claude"
name = "Claude Code"
shortName = "Claude"
globalPath = "~/.claude/skills"
projectPath = ".claude/skills"
detected = false
`
    )

    const statusCommand = (await import("../../src/commands/status")).default
    await statusCommand.run!({ args: {} } as any)

    expect(consoleLogs.some((log) => log.includes("No agents detected"))).toBe(true)
  })

  test("displays skill matrix header with agent names", async () => {
    // Create config with detected agent
    await mkdir(join(tempDir, "simba"), { recursive: true })
    await mkdir(join(tempDir, "agent1/skills/test-skill"), { recursive: true })
    await writeFile(
      join(tempDir, "agent1/skills/test-skill/SKILL.md"),
      "---\nname: test-skill\n---"
    )

    await writeFile(
      join(tempDir, "simba/config.toml"),
      `[agents.agent1]
id = "agent1"
name = "Agent One"
shortName = "Agent1"
globalPath = "${join(tempDir, "agent1/skills")}"
projectPath = ".agent1/skills"
detected = true
`
    )

    // Clear the module cache to pick up new config
    delete require.cache[require.resolve("../../src/commands/status")]

    const statusCommand = (await import("../../src/commands/status")).default
    await statusCommand.run!({ args: {} } as any)

    expect(consoleLogs.some((log) => log.includes("Skill"))).toBe(true)
    expect(consoleLogs.some((log) => log.includes("Agent1"))).toBe(true)
  })

  test("displays summary with synced, conflict, and unique counts", async () => {
    await mkdir(join(tempDir, "simba"), { recursive: true })
    await mkdir(join(tempDir, "agent1/skills/unique-skill"), { recursive: true })
    await writeFile(
      join(tempDir, "agent1/skills/unique-skill/SKILL.md"),
      "---\nname: unique-skill\n---"
    )

    await writeFile(
      join(tempDir, "simba/config.toml"),
      `[agents.agent1]
id = "agent1"
name = "Agent One"
shortName = "Agent1"
globalPath = "${join(tempDir, "agent1/skills")}"
projectPath = ".agent1/skills"
detected = true
`
    )

    delete require.cache[require.resolve("../../src/commands/status")]

    const statusCommand = (await import("../../src/commands/status")).default
    await statusCommand.run!({ args: {} } as any)

    expect(consoleLogs.some((log) => log.includes("synced:"))).toBe(true)
    expect(consoleLogs.some((log) => log.includes("conflict:"))).toBe(true)
    expect(consoleLogs.some((log) => log.includes("unique:"))).toBe(true)
  })

  test("filters to specific agent when --agent flag provided", async () => {
    await mkdir(join(tempDir, "simba"), { recursive: true })
    await mkdir(join(tempDir, "agent1/skills/skill1"), { recursive: true })
    await mkdir(join(tempDir, "agent2/skills/skill2"), { recursive: true })
    await writeFile(join(tempDir, "agent1/skills/skill1/SKILL.md"), "---\nname: skill1\n---")
    await writeFile(join(tempDir, "agent2/skills/skill2/SKILL.md"), "---\nname: skill2\n---")

    await writeFile(
      join(tempDir, "simba/config.toml"),
      `[agents.agent1]
id = "agent1"
name = "Agent One"
shortName = "Agent1"
globalPath = "${join(tempDir, "agent1/skills")}"
projectPath = ".agent1/skills"
detected = true

[agents.agent2]
id = "agent2"
name = "Agent Two"
shortName = "Agent2"
globalPath = "${join(tempDir, "agent2/skills")}"
projectPath = ".agent2/skills"
detected = true
`
    )

    delete require.cache[require.resolve("../../src/commands/status")]

    const statusCommand = (await import("../../src/commands/status")).default
    await statusCommand.run!({ args: { agent: "agent1" } } as any)

    // Should show Agent1 but not Agent2
    expect(consoleLogs.some((log) => log.includes("Agent1"))).toBe(true)
    expect(consoleLogs.some((log) => log.includes("Agent2"))).toBe(false)
  })
})
