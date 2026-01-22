import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, writeFile, readdir, readlink, lstat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

const testDir = join(tmpdir(), "simba-adopt-test-" + Date.now())
const skillsDir = join(testDir, "skills")
const registryPath = join(testDir, "registry.json")
const configPath = join(testDir, "config.toml")
const claudeDir = join(testDir, "claude-skills")

async function createSkill(dir: string, name: string, content: string = "# Test") {
  const skillDir = join(dir, name)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, "SKILL.md"), content)
}

describe("adopt command", () => {
  beforeEach(async () => {
    await mkdir(skillsDir, { recursive: true })
    await mkdir(claudeDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("adopts skills from agent into store", async () => {
    await createSkill(claudeDir, "my-skill", "# My Skill")

    const { runAdopt } = await import("../../src/commands/adopt")

    await runAdopt({
      skillsDir,
      registryPath,
      configPath,
      agents: {
        claude: {
          id: "claude",
          name: "Claude",
          shortName: "Claude",
          globalPath: claudeDir,
          projectPath: ".claude/skills",
          detected: true,
        }
      },
      dryRun: false,
      onConflict: async () => "claude",
    })

    // Skill should be in store
    const storeSkills = await readdir(skillsDir)
    expect(storeSkills).toContain("my-skill")

    // Original should be replaced with symlink
    const stat = await lstat(join(claudeDir, "my-skill"))
    expect(stat.isSymbolicLink()).toBe(true)
    expect(await readlink(join(claudeDir, "my-skill"))).toBe(join(skillsDir, "my-skill"))
  })
})
