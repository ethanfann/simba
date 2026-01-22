import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, writeFile, lstat } from "node:fs/promises"
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

    const { runAssign } = await import("../../src/commands/assign")
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
    const { runAssign } = await import("../../src/commands/assign")
    await runAssign({
      skill: "my-skill",
      agents: ["claude"],
      skillsDir,
      registryPath,
      agentPaths: { claude: claudeDir }
    })

    const { runUnassign } = await import("../../src/commands/unassign")
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
})
