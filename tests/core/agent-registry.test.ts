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
        shortName: "Test",
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

  test("detectAgents always enables alwaysAvailable locations", async () => {
    const registry = new AgentRegistry({
      universal: {
        id: "universal",
        name: "Universal (XDG)",
        shortName: "Universal",
        globalPath: join(tempDir, ".config/agents/skills"),
        projectPath: ".agents/skills",
        alwaysAvailable: true,
        detected: false,
      },
    })

    const detected = await registry.detectAgents()

    expect(detected.universal.detected).toBe(true)
  })

  test("detectAgents uses detectPath instead of shared skills path", async () => {
    const sharedGlobalPath = join(tempDir, ".config/agents/skills")
    await mkdir(join(tempDir, ".config/agents"), { recursive: true })
    await mkdir(join(tempDir, "only-claude-config"), { recursive: true })

    const agents: Record<string, Agent> = {
      claude: {
        id: "claude",
        name: "Claude Code",
        shortName: "Claude",
        globalPath: sharedGlobalPath,
        projectPath: ".claude/skills",
        detectPath: join(tempDir, "only-claude-config"),
        detected: false,
      },
      pi: {
        id: "pi",
        name: "pi",
        shortName: "pi",
        globalPath: sharedGlobalPath,
        projectPath: ".pi/skills",
        detectPath: join(tempDir, "missing-pi-config"),
        detected: false,
      },
    }

    const registry = new AgentRegistry(agents)
    const detected = await registry.detectAgents()

    expect(detected.claude.detected).toBe(true)
    expect(detected.pi.detected).toBe(false)
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
