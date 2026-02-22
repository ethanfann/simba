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
        universal: false,
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

  test("detectAgents uses detectPath instead of shared skills path", async () => {
    const sharedGlobalPath = join(tempDir, ".config/agents/skills")
    await mkdir(join(tempDir, ".config/agents"), { recursive: true })
    await mkdir(join(tempDir, "only-amp-config"), { recursive: true })

    const agents: Record<string, Agent> = {
      amp: {
        id: "amp",
        name: "Amp",
        shortName: "Amp",
        globalPath: sharedGlobalPath,
        projectPath: ".agents/skills",
        detectPath: join(tempDir, "only-amp-config"),
        universal: true,
        detected: false,
      },
      kimi: {
        id: "kimi",
        name: "Kimi",
        shortName: "Kimi",
        globalPath: sharedGlobalPath,
        projectPath: ".agents/skills",
        detectPath: join(tempDir, "missing-kimi-config"),
        universal: true,
        detected: false,
      },
    }

    const registry = new AgentRegistry(agents)
    const detected = await registry.detectAgents()

    expect(detected.amp.detected).toBe(true)
    expect(detected.kimi.detected).toBe(false)
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
