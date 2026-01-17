import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, writeFile, symlink } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

const testDir = join(tmpdir(), "simba-doctor-test-" + Date.now())
const skillsDir = join(testDir, "skills")
const registryPath = join(testDir, "registry.json")
const claudeDir = join(testDir, "claude-skills")

async function createSkill(dir: string, name: string) {
  const skillDir = join(dir, name)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, "SKILL.md"), "# Test")
}

describe("doctor command", () => {
  beforeEach(async () => {
    await mkdir(skillsDir, { recursive: true })
    await mkdir(claudeDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("detects healthy symlinks", async () => {
    await createSkill(skillsDir, "my-skill")
    await symlink(join(skillsDir, "my-skill"), join(claudeDir, "my-skill"))

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

    const { runDoctor } = await import("./doctor")
    const results = await runDoctor({
      skillsDir,
      registryPath,
      agents: {
        claude: {
          id: "claude",
          name: "Claude",
          globalPath: claudeDir,
          projectPath: ".claude/skills",
          detected: true,
        }
      }
    })

    expect(results.healthy).toContain("my-skill")
    expect(results.broken.length).toBe(0)
    expect(results.rogue.length).toBe(0)
  })

  test("detects broken symlinks", async () => {
    await symlink(join(skillsDir, "missing-skill"), join(claudeDir, "missing-skill"))

    const registry = {
      version: 1,
      skills: {
        "missing-skill": {
          name: "missing-skill",
          source: "adopted:claude",
          installedAt: "2026-01-16T00:00:00Z",
          assignments: { claude: { type: "directory" } }
        }
      }
    }
    await writeFile(registryPath, JSON.stringify(registry))

    const { runDoctor } = await import("./doctor")
    const results = await runDoctor({
      skillsDir,
      registryPath,
      agents: {
        claude: {
          id: "claude",
          name: "Claude",
          globalPath: claudeDir,
          projectPath: ".claude/skills",
          detected: true,
        }
      }
    })

    expect(results.broken.some(b => b.skill === "missing-skill")).toBe(true)
  })

  test("detects rogue files", async () => {
    await createSkill(skillsDir, "my-skill")
    await createSkill(claudeDir, "my-skill")  // Real dir, not symlink

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

    const { runDoctor } = await import("./doctor")
    const results = await runDoctor({
      skillsDir,
      registryPath,
      agents: {
        claude: {
          id: "claude",
          name: "Claude",
          globalPath: claudeDir,
          projectPath: ".claude/skills",
          detected: true,
        }
      }
    })

    expect(results.rogue.some(r => r.skill === "my-skill")).toBe(true)
  })
})
