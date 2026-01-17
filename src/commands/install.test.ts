import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, writeFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

const testDir = join(tmpdir(), "simba-install-test-" + Date.now())
const skillsDir = join(testDir, "skills")
const registryPath = join(testDir, "registry.json")
const sourceDir = join(testDir, "source-repo")

async function createSourceSkill(name: string, content: string = "---\nname: test\ndescription: test skill\n---\n# Test") {
  const skillDir = join(sourceDir, "skills", name)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, "SKILL.md"), content)
}

describe("install command", () => {
  beforeEach(async () => {
    await mkdir(skillsDir, { recursive: true })
    await mkdir(sourceDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("installs skill from local path", async () => {
    await createSourceSkill("cool-skill")

    const { runInstall } = await import("./install")

    await runInstall({
      source: sourceDir,
      skillsDir,
      registryPath,
      onSelect: async (skills) => skills.map(s => s.name),
    })

    const installed = await readdir(skillsDir)
    expect(installed).toContain("cool-skill")
  })

  test("discovers skills in standard locations", async () => {
    await createSourceSkill("skill-a")
    await createSourceSkill("skill-b")

    const { discoverSkills } = await import("./install")
    const skills = await discoverSkills(sourceDir)

    expect(skills.length).toBe(2)
    expect(skills.map(s => s.name)).toContain("skill-a")
    expect(skills.map(s => s.name)).toContain("skill-b")
  })
})
