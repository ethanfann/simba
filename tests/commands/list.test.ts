import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

const testDir = join(tmpdir(), "simba-list-test-" + Date.now())
const registryPath = join(testDir, "registry.json")

async function createRegistry(
  skills: Record<string, { assignments: Record<string, { type: string }> }>
) {
  const registry = {
    version: 1,
    skills: Object.fromEntries(
      Object.entries(skills).map(([name, data]) => [
        name,
        {
          name,
          source: "adopted:claude",
          installedAt: "2026-01-16T00:00:00Z",
          assignments: data.assignments,
        },
      ])
    ),
  }
  await mkdir(testDir, { recursive: true })
  await writeFile(registryPath, JSON.stringify(registry))
}

describe("list command", () => {
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("returns empty array when no skills", async () => {
    await createRegistry({})

    const { listSkills } = await import("../../src/commands/list")
    const skills = await listSkills({
      registryPath,
      agents: {},
    })

    expect(skills).toHaveLength(0)
  })

  test("lists skills with their names", async () => {
    await createRegistry({
      "skill-a": { assignments: {} },
      "skill-b": { assignments: {} },
    })

    const { listSkills } = await import("../../src/commands/list")
    const skills = await listSkills({
      registryPath,
      agents: {},
    })

    expect(skills).toHaveLength(2)
    expect(skills.map((s) => s.name)).toContain("skill-a")
    expect(skills.map((s) => s.name)).toContain("skill-b")
  })

  test("includes agent names for assigned skills", async () => {
    await createRegistry({
      "my-skill": { assignments: { claude: { type: "directory" } } },
    })

    const { listSkills } = await import("../../src/commands/list")
    const skills = await listSkills({
      registryPath,
      agents: { claude: { name: "Claude Code" } },
    })

    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe("my-skill")
    expect(skills[0].agentNames).toContain("Claude Code")
  })

  test("uses agent id as fallback when name not found", async () => {
    await createRegistry({
      "my-skill": { assignments: { unknown: { type: "directory" } } },
    })

    const { listSkills } = await import("../../src/commands/list")
    const skills = await listSkills({
      registryPath,
      agents: {},
    })

    expect(skills[0].agentNames).toContain("unknown")
  })

  test("lists multiple assignments per skill", async () => {
    await createRegistry({
      "my-skill": {
        assignments: {
          claude: { type: "directory" },
          cursor: { type: "directory" },
        },
      },
    })

    const { listSkills } = await import("../../src/commands/list")
    const skills = await listSkills({
      registryPath,
      agents: {
        claude: { name: "Claude Code" },
        cursor: { name: "Cursor" },
      },
    })

    expect(skills[0].agentNames).toHaveLength(2)
    expect(skills[0].agentNames).toContain("Claude Code")
    expect(skills[0].agentNames).toContain("Cursor")
  })

  test("handles non-existent registry gracefully", async () => {
    await rm(testDir, { recursive: true, force: true })

    const { listSkills } = await import("../../src/commands/list")
    const skills = await listSkills({
      registryPath: join(testDir, "nonexistent.json"),
      agents: {},
    })

    expect(skills).toHaveLength(0)
  })
})
