import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, writeFile, lstat, readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

const testDir = join(tmpdir(), "simba-assign-test-" + Date.now())
const skillsDir = join(testDir, "skills")
const registryPath = join(testDir, "registry.json")
const claudeDir = join(testDir, "claude-skills")

async function createSkill(dir: string, name: string) {
  const skillDir = join(dir, name)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, "SKILL.md"), "# Test")
}

describe("assign command", () => {
  beforeEach(async () => {
    await mkdir(skillsDir, { recursive: true })
    await mkdir(claudeDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("assigns skill to agent", async () => {
    await createSkill(skillsDir, "my-skill")

    const registry = {
      version: 1,
      skills: {
        "my-skill": {
          name: "my-skill",
          source: "adopted:cursor",
          installedAt: "2026-01-16T00:00:00Z",
          assignments: {}
        }
      }
    }
    await writeFile(registryPath, JSON.stringify(registry))

    const { runAssign } = await import("../../src/commands/link")
    await runAssign({
      skill: "my-skill",
      agents: ["claude"],
      skillsDir,
      registryPath,
      agentPaths: { claude: claudeDir }
    })

    const stat = await lstat(join(claudeDir, "my-skill"))
    expect(stat.isSymbolicLink()).toBe(true)
  })

  test("unassigns skill from agent", async () => {
    await createSkill(skillsDir, "my-skill")

    const registry = {
      version: 1,
      skills: {
        "my-skill": {
          name: "my-skill",
          source: "adopted:claude",
          installedAt: "2026-01-16T00:00:00Z",
          assignments: { claude: { type: "directory" } }
        }
      }
    }
    await writeFile(registryPath, JSON.stringify(registry))

    // Create symlink first
    const { runAssign } = await import("../../src/commands/link")
    await runAssign({
      skill: "my-skill",
      agents: ["claude"],
      skillsDir,
      registryPath,
      agentPaths: { claude: claudeDir }
    })

    const { runUnassign } = await import("../../src/commands/unlink")
    await runUnassign({
      skill: "my-skill",
      agents: ["claude"],
      skillsDir,
      registryPath,
      agentPaths: { claude: claudeDir }
    })

    let exists = true
    try {
      await lstat(join(claudeDir, "my-skill"))
    } catch {
      exists = false
    }
    expect(exists).toBe(false)
  })

  test("assigning to universal does not create a self-symlink", async () => {
    await createSkill(skillsDir, "my-skill")

    const registry = {
      version: 1,
      skills: {
        "my-skill": {
          name: "my-skill",
          source: "installed:test",
          installedAt: "2026-01-16T00:00:00Z",
          assignments: {}
        }
      }
    }
    await writeFile(registryPath, JSON.stringify(registry))

    const { runAssign } = await import("../../src/commands/link")
    await runAssign({
      skill: "my-skill",
      agents: ["universal"],
      skillsDir,
      registryPath,
      agentPaths: { universal: skillsDir }
    })

    const entries = await readdir(skillsDir)
    expect(entries).toContain("my-skill")

    const stat = await lstat(join(skillsDir, "my-skill"))
    expect(stat.isDirectory()).toBe(true)
  })

  test("unlinking universal is rejected", async () => {
    await createSkill(skillsDir, "my-skill")

    const registry = {
      version: 1,
      skills: {
        "my-skill": {
          name: "my-skill",
          source: "installed:test",
          installedAt: "2026-01-16T00:00:00Z",
          assignments: { universal: { type: "directory" } }
        }
      }
    }
    await writeFile(registryPath, JSON.stringify(registry))

    const { runUnassign } = await import("../../src/commands/unlink")
    await runUnassign({
      skill: "my-skill",
      agents: ["universal"],
      skillsDir,
      registryPath,
      agentPaths: { universal: skillsDir }
    })

    const saved = JSON.parse(await readFile(registryPath, "utf-8"))
    expect(saved.skills["my-skill"].assignments.universal).toEqual({ type: "directory" })
  })
})
