import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, writeFile, readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { Registry } from "../../src/core/types"

const testDir = join(tmpdir(), "simba-install-test-" + Date.now())
const skillsDir = join(testDir, "skills")
const registryPath = join(testDir, "registry.json")
const sourceDir = join(testDir, "source-repo")

async function createSourceSkill(name: string, content: string = "---\nname: test\ndescription: test skill\n---\n# Test") {
  const skillDir = join(sourceDir, "skills", name)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, "SKILL.md"), content)
}

async function createMarketplacePlugin(
  basePath: string,
  marketplace: { name: string; plugins?: Array<{ name: string; skills?: string[] }> },
  skills: Array<{ path: string; name: string; description?: string }>
) {
  // Create .claude-plugin/marketplace.json
  const pluginDir = join(basePath, ".claude-plugin")
  await mkdir(pluginDir, { recursive: true })
  await writeFile(join(pluginDir, "marketplace.json"), JSON.stringify(marketplace, null, 2))

  // Create skill directories with SKILL.md
  for (const skill of skills) {
    const skillDir = join(basePath, skill.path)
    await mkdir(skillDir, { recursive: true })
    const content = `---\nname: ${skill.name}\ndescription: ${skill.description || "test"}\n---\n# ${skill.name}`
    await writeFile(join(skillDir, "SKILL.md"), content)
  }
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

    const { runInstall } = await import("../../src/commands/install")

    await runInstall({
      source: sourceDir,
      skillsDir,
      registryPath,
      useSSH: false,
      onSelect: async (skills) => skills.map(s => s.name),
    })

    const installed = await readdir(skillsDir)
    expect(installed).toContain("cool-skill")
  })

  test("discovers skills in standard locations", async () => {
    await createSourceSkill("skill-a")
    await createSourceSkill("skill-b")

    const { discoverSkills } = await import("../../src/commands/install")
    const skills = await discoverSkills(sourceDir)

    expect(skills.length).toBe(2)
    expect(skills.map(s => s.name)).toContain("skill-a")
    expect(skills.map(s => s.name)).toContain("skill-b")
  })

  test("discovers skills from root marketplace.json", async () => {
    await createMarketplacePlugin(
      sourceDir,
      {
        name: "test-plugin",
        plugins: [{ name: "main", skills: ["./my-skills/auth", "./my-skills/db"] }]
      },
      [
        { path: "my-skills/auth", name: "auth-skill", description: "Auth skill" },
        { path: "my-skills/db", name: "db-skill", description: "DB skill" }
      ]
    )

    const { discoverSkills } = await import("../../src/commands/install")
    const skills = await discoverSkills(sourceDir)

    expect(skills.length).toBe(2)
    expect(skills.map(s => s.name)).toContain("auth-skill")
    expect(skills.map(s => s.name)).toContain("db-skill")
  })

  test("discovers skills from nested marketplace.json", async () => {
    const nestedDir = join(sourceDir, "packages", "auth-plugin")
    await createMarketplacePlugin(
      nestedDir,
      {
        name: "nested-plugin",
        plugins: [{ name: "auth", skills: ["./skills/login"] }]
      },
      [{ path: "skills/login", name: "login-skill", description: "Login skill" }]
    )

    const { discoverSkills } = await import("../../src/commands/install")
    const skills = await discoverSkills(sourceDir)

    expect(skills.length).toBe(1)
    expect(skills[0].name).toBe("login-skill")
  })

  test("handles missing skill paths in marketplace.json gracefully", async () => {
    // Create marketplace.json pointing to non-existent skills
    const pluginDir = join(sourceDir, ".claude-plugin")
    await mkdir(pluginDir, { recursive: true })
    await writeFile(join(pluginDir, "marketplace.json"), JSON.stringify({
      name: "broken-plugin",
      plugins: [{ name: "main", skills: ["./does-not-exist", "./also-missing"] }]
    }))

    const { discoverSkills } = await import("../../src/commands/install")
    const skills = await discoverSkills(sourceDir)

    expect(skills.length).toBe(0)
  })

  test("deduplicates skills from standard dirs and marketplace.json", async () => {
    // Create same skill in both standard location and marketplace
    await createSourceSkill("shared-skill", "---\nname: shared-skill\ndescription: from standard\n---\n# Shared")

    await createMarketplacePlugin(
      sourceDir,
      {
        name: "test-plugin",
        plugins: [{ name: "main", skills: ["./extra/shared-skill"] }]
      },
      [{ path: "extra/shared-skill", name: "shared-skill", description: "from marketplace" }]
    )

    const { discoverSkills } = await import("../../src/commands/install")
    const skills = await discoverSkills(sourceDir)

    // Should only have one copy (standard dirs scanned first)
    const sharedSkills = skills.filter(s => s.name === "shared-skill")
    expect(sharedSkills.length).toBe(1)
  })

  test("installs skills from marketplace.json source", async () => {
    await createMarketplacePlugin(
      sourceDir,
      {
        name: "installable-plugin",
        plugins: [{ name: "main", skills: ["./features/cool-feature"] }]
      },
      [{ path: "features/cool-feature", name: "cool-feature", description: "A cool feature" }]
    )

    const { runInstall } = await import("../../src/commands/install")

    await runInstall({
      source: sourceDir,
      skillsDir,
      registryPath,
      useSSH: false,
      onSelect: async (skills) => skills.map(s => s.name),
    })

    const installed = await readdir(skillsDir)
    expect(installed).toContain("cool-feature")
  })

  test("handles multiple plugins in marketplace.json", async () => {
    const pluginDir = join(sourceDir, ".claude-plugin")
    await mkdir(pluginDir, { recursive: true })
    await writeFile(join(pluginDir, "marketplace.json"), JSON.stringify({
      name: "multi-plugin",
      plugins: [
        { name: "plugin-a", skills: ["./a/skill-a"] },
        { name: "plugin-b", skills: ["./b/skill-b"] }
      ]
    }))

    // Create the skills
    for (const [dir, name] of [["a/skill-a", "skill-a"], ["b/skill-b", "skill-b"]]) {
      const skillDir = join(sourceDir, dir)
      await mkdir(skillDir, { recursive: true })
      await writeFile(join(skillDir, "SKILL.md"), `---\nname: ${name}\n---\n# ${name}`)
    }

    const { discoverSkills } = await import("../../src/commands/install")
    const skills = await discoverSkills(sourceDir)

    expect(skills.length).toBe(2)
    expect(skills.map(s => s.name)).toContain("skill-a")
    expect(skills.map(s => s.name)).toContain("skill-b")
  })

  test("computes relativePath for discovered skills", async () => {
    await createSourceSkill("my-skill")

    const { discoverSkills } = await import("../../src/commands/install")
    const skills = await discoverSkills(sourceDir)

    expect(skills.length).toBe(1)
    expect(skills[0].relativePath).toBe("./skills/my-skill")
  })

  test("computes relativePath for marketplace skills", async () => {
    await createMarketplacePlugin(
      sourceDir,
      {
        name: "test-plugin",
        plugins: [{ name: "main", skills: ["./features/auth"] }]
      },
      [{ path: "features/auth", name: "auth-skill" }]
    )

    const { discoverSkills } = await import("../../src/commands/install")
    const skills = await discoverSkills(sourceDir)

    expect(skills.length).toBe(1)
    expect(skills[0].relativePath).toBe("./features/auth")
  })
})

describe("--skill flag (direct install)", () => {
  beforeEach(async () => {
    await mkdir(skillsDir, { recursive: true })
    await mkdir(sourceDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("installs specific skill by name", async () => {
    await createSourceSkill("skill-a")
    await createSourceSkill("skill-b")

    const { runInstall } = await import("../../src/commands/install")

    let onSelectCalled = false
    await runInstall({
      source: sourceDir,
      skillsDir,
      registryPath,
      useSSH: false,
      skillName: "skill-a",
      onSelect: async () => {
        onSelectCalled = true
        return []
      },
    })

    // Should install only skill-a
    const installed = await readdir(skillsDir)
    expect(installed).toContain("skill-a")
    expect(installed).not.toContain("skill-b")

    // onSelect should not be called when skillName is provided
    expect(onSelectCalled).toBe(false)
  })

  test("fails gracefully when skill not found", async () => {
    await createSourceSkill("existing-skill")

    const { runInstall } = await import("../../src/commands/install")

    const logs: string[] = []
    const originalLog = console.log
    console.log = (msg: string) => logs.push(msg)

    try {
      await runInstall({
        source: sourceDir,
        skillsDir,
        registryPath,
        useSSH: false,
        skillName: "nonexistent-skill",
        onSelect: async () => [],
      })
    } finally {
      console.log = originalLog
    }

    // Should not install anything
    const installed = await readdir(skillsDir)
    expect(installed).toHaveLength(0)

    // Should log error with available skills
    expect(logs.some(l => l.includes("not found"))).toBe(true)
    expect(logs.some(l => l.includes("existing-skill"))).toBe(true)
  })

  test("tracks installSource for specific skill", async () => {
    await createSourceSkill("tracked-skill")

    const { runInstall } = await import("../../src/commands/install")

    await runInstall({
      source: sourceDir,
      skillsDir,
      registryPath,
      useSSH: false,
      skillName: "tracked-skill",
      onSelect: async () => [],
    })

    const registry: Registry = JSON.parse(await readFile(registryPath, "utf-8"))
    expect(registry.skills["tracked-skill"]).toBeDefined()
    expect(registry.skills["tracked-skill"].installSource?.skillPath).toBe("./skills/tracked-skill")
  })
})

describe("installSource tracking", () => {
  beforeEach(async () => {
    await mkdir(skillsDir, { recursive: true })
    await mkdir(sourceDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("local install sets installSource with local protocol", async () => {
    // Create a skill in standard location
    const skillDir = join(sourceDir, "skills", "local-skill")
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: local-skill\n---\n# Local")

    const { runInstall } = await import("../../src/commands/install")

    await runInstall({
      source: sourceDir,
      skillsDir,
      registryPath,
      useSSH: false,
      onSelect: async (skills) => skills.map(s => s.name),
    })

    const registry: Registry = JSON.parse(await readFile(registryPath, "utf-8"))
    expect(registry.skills["local-skill"]).toBeDefined()
    expect(registry.skills["local-skill"].installSource).toBeDefined()
    expect(registry.skills["local-skill"].installSource!.protocol).toBe("local")
    expect(registry.skills["local-skill"].installSource!.skillPath).toBe("./skills/local-skill")
  })

  test("local install creates symlink instead of copy", async () => {
    const { lstat } = await import("node:fs/promises")

    // Create a skill in standard location
    const skillDir = join(sourceDir, "skills", "symlink-skill")
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: symlink-skill\n---\n# Symlink")

    const { runInstall } = await import("../../src/commands/install")

    await runInstall({
      source: sourceDir,
      skillsDir,
      registryPath,
      useSSH: false,
      onSelect: async (skills) => skills.map(s => s.name),
    })

    // Check that the installed skill is a symlink
    const installedPath = join(skillsDir, "symlink-skill")
    const stat = await lstat(installedPath)
    expect(stat.isSymbolicLink()).toBe(true)
  })
})
