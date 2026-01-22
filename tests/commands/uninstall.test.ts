import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, writeFile, lstat, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

const testDir = join(tmpdir(), "simba-uninstall-test-" + Date.now())
const skillsDir = join(testDir, "skills")
const registryPath = join(testDir, "registry.json")
const claudeDir = join(testDir, "claude-skills")

async function createSkill(dir: string, name: string) {
  const skillDir = join(dir, name)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, "SKILL.md"), "# Test")
}

async function createRegistry(skills: Record<string, { assignments: Record<string, { type: string }> }>) {
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
  await writeFile(registryPath, JSON.stringify(registry))
}

describe("uninstall command", () => {
  beforeEach(async () => {
    await mkdir(skillsDir, { recursive: true })
    await mkdir(claudeDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("uninstalls skill and removes from registry", async () => {
    await createSkill(skillsDir, "my-skill")
    await createRegistry({ "my-skill": { assignments: {} } })

    const { runUninstall } = await import("../../src/commands/uninstall")
    await runUninstall({
      skills: ["my-skill"],
      skillsDir,
      registryPath,
      agentPaths: {},
      deleteFiles: true,
    })

    // Check registry no longer has the skill
    const registry = JSON.parse(await readFile(registryPath, "utf-8"))
    expect(registry.skills["my-skill"]).toBeUndefined()

    // Check files are deleted
    let exists = true
    try {
      await lstat(join(skillsDir, "my-skill"))
    } catch {
      exists = false
    }
    expect(exists).toBe(false)
  })

  test("removes symlinks from assigned agents", async () => {
    await createSkill(skillsDir, "my-skill")
    await createRegistry({ "my-skill": { assignments: { claude: { type: "directory" } } } })

    // Create symlink to simulate assigned skill
    const { runAssign } = await import("../../src/commands/assign")
    await runAssign({
      skill: "my-skill",
      agents: ["claude"],
      skillsDir,
      registryPath,
      agentPaths: { claude: claudeDir },
    })

    const { runUninstall } = await import("../../src/commands/uninstall")
    await runUninstall({
      skills: ["my-skill"],
      skillsDir,
      registryPath,
      agentPaths: { claude: claudeDir },
      deleteFiles: true,
    })

    // Check symlink is removed
    let exists = true
    try {
      await lstat(join(claudeDir, "my-skill"))
    } catch {
      exists = false
    }
    expect(exists).toBe(false)
  })

  test("keeps files when deleteFiles is false", async () => {
    await createSkill(skillsDir, "my-skill")
    await createRegistry({ "my-skill": { assignments: {} } })

    const { runUninstall } = await import("../../src/commands/uninstall")
    await runUninstall({
      skills: ["my-skill"],
      skillsDir,
      registryPath,
      agentPaths: {},
      deleteFiles: false,
    })

    // Check registry no longer has the skill
    const registry = JSON.parse(await readFile(registryPath, "utf-8"))
    expect(registry.skills["my-skill"]).toBeUndefined()

    // Check files still exist
    const stat = await lstat(join(skillsDir, "my-skill"))
    expect(stat.isDirectory()).toBe(true)
  })

  test("handles non-existent skill gracefully", async () => {
    await createRegistry({})

    const { runUninstall } = await import("../../src/commands/uninstall")
    // Should not throw
    await runUninstall({
      skills: ["non-existent"],
      skillsDir,
      registryPath,
      agentPaths: {},
      deleteFiles: true,
    })

    const registry = JSON.parse(await readFile(registryPath, "utf-8"))
    expect(Object.keys(registry.skills)).toHaveLength(0)
  })

  test("uninstalls multiple skills", async () => {
    await createSkill(skillsDir, "skill-a")
    await createSkill(skillsDir, "skill-b")
    await createRegistry({
      "skill-a": { assignments: {} },
      "skill-b": { assignments: {} },
    })

    const { runUninstall } = await import("../../src/commands/uninstall")
    await runUninstall({
      skills: ["skill-a", "skill-b"],
      skillsDir,
      registryPath,
      agentPaths: {},
      deleteFiles: true,
    })

    const registry = JSON.parse(await readFile(registryPath, "utf-8"))
    expect(Object.keys(registry.skills)).toHaveLength(0)
  })
})
