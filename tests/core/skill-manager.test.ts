import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { SkillManager } from "../../src/core/skill-manager"
import { AgentRegistry } from "../../src/core/agent-registry"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { Agent } from "../../src/core/types"

describe("SkillManager", () => {
  let tempDir: string
  let mockAgents: Record<string, Agent>
  let registry: AgentRegistry
  let manager: SkillManager

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "simba-manager-"))

    mockAgents = {
      agent1: {
        id: "agent1",
        name: "Agent 1",
        shortName: "Agent1",
        globalPath: join(tempDir, "agent1/skills"),
        projectPath: ".agent1/skills",
        detected: true,
      },
      agent2: {
        id: "agent2",
        name: "Agent 2",
        shortName: "Agent2",
        globalPath: join(tempDir, "agent2/skills"),
        projectPath: ".agent2/skills",
        detected: true,
      },
    }

    registry = new AgentRegistry(mockAgents)
    manager = new SkillManager(registry, mockAgents)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true })
  })

  test("buildMatrix returns unique status for skill in one agent", async () => {
    await mkdir(join(tempDir, "agent1/skills/my-skill"), { recursive: true })
    await writeFile(
      join(tempDir, "agent1/skills/my-skill/SKILL.md"),
      "---\nname: my-skill\ndescription: Test\n---"
    )

    const matrix = await manager.buildMatrix()

    expect(matrix).toHaveLength(1)
    expect(matrix[0].skillName).toBe("my-skill")
    expect(matrix[0].status).toBe("unique")
    expect(matrix[0].agents.agent1.present).toBe(true)
    expect(matrix[0].agents.agent2.present).toBe(false)
  })

  test("buildMatrix returns synced status when hashes match", async () => {
    const skillContent = "---\nname: shared-skill\ndescription: Test\n---"

    await mkdir(join(tempDir, "agent1/skills/shared-skill"), { recursive: true })
    await writeFile(join(tempDir, "agent1/skills/shared-skill/SKILL.md"), skillContent)

    await mkdir(join(tempDir, "agent2/skills/shared-skill"), { recursive: true })
    await writeFile(join(tempDir, "agent2/skills/shared-skill/SKILL.md"), skillContent)

    const matrix = await manager.buildMatrix()

    expect(matrix).toHaveLength(1)
    expect(matrix[0].status).toBe("synced")
  })

  test("buildMatrix returns conflict status when hashes differ", async () => {
    await mkdir(join(tempDir, "agent1/skills/diff-skill"), { recursive: true })
    await writeFile(
      join(tempDir, "agent1/skills/diff-skill/SKILL.md"),
      "---\nname: diff-skill\ndescription: Version A\n---"
    )

    await mkdir(join(tempDir, "agent2/skills/diff-skill"), { recursive: true })
    await writeFile(
      join(tempDir, "agent2/skills/diff-skill/SKILL.md"),
      "---\nname: diff-skill\ndescription: Version B\n---"
    )

    const matrix = await manager.buildMatrix()

    expect(matrix).toHaveLength(1)
    expect(matrix[0].status).toBe("conflict")
  })
})
