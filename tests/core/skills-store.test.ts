import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, writeFile, readdir, readlink, lstat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { SkillsStore } from "../../src/core/skills-store"

const testDir = join(tmpdir(), "simba-skills-store-test-" + Date.now())
const skillsDir = join(testDir, "skills")
const registryPath = join(testDir, "registry.json")
const agentDir = join(testDir, "agent-skills")

async function createSkill(dir: string, name: string, content: string = "# Test") {
  const skillDir = join(dir, name)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, "SKILL.md"), content)
}

describe("SkillsStore", () => {
  beforeEach(async () => {
    await mkdir(skillsDir, { recursive: true })
    await mkdir(agentDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("listSkills returns skills in store", async () => {
    await createSkill(skillsDir, "skill-a")
    await createSkill(skillsDir, "skill-b")

    const store = new SkillsStore(skillsDir, registryPath)
    const skills = await store.listSkills()

    expect(skills).toContain("skill-a")
    expect(skills).toContain("skill-b")
  })

  test("assignSkill creates symlink", async () => {
    await createSkill(skillsDir, "my-skill")

    const store = new SkillsStore(skillsDir, registryPath)
    await store.assignSkill("my-skill", agentDir, { type: "directory" })

    const symlinkPath = join(agentDir, "my-skill")
    const stat = await lstat(symlinkPath)
    expect(stat.isSymbolicLink()).toBe(true)
    expect(await readlink(symlinkPath)).toBe(join(skillsDir, "my-skill"))
  })

  test("unassignSkill removes symlink", async () => {
    await createSkill(skillsDir, "my-skill")
    const store = new SkillsStore(skillsDir, registryPath)
    await store.assignSkill("my-skill", agentDir, { type: "directory" })
    await store.unassignSkill("my-skill", agentDir)

    const entries = await readdir(agentDir)
    expect(entries).not.toContain("my-skill")
  })
})
