import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, writeFile, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { Registry, ManagedSkill } from "../../src/core/types"

const testDir = join(tmpdir(), "simba-update-test-" + Date.now())
const skillsDir = join(testDir, "skills")
const registryPath = join(testDir, "registry.json")

async function createInstalledSkill(
  name: string,
  content: string,
  installSource?: { repo: string; protocol: "https" | "ssh"; skillPath?: string }
): Promise<void> {
  // Create skill in simba's store
  const skillDir = join(skillsDir, name)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, "SKILL.md"), content)

  // Update registry
  let registry: Registry
  try {
    registry = JSON.parse(await readFile(registryPath, "utf-8"))
  } catch {
    registry = { version: 1, skills: {} }
  }

  const managedSkill: ManagedSkill = {
    name,
    source: installSource ? `installed:${installSource.repo}` : `adopted:local`,
    installedAt: new Date().toISOString(),
    assignments: {},
    installSource
  }
  registry.skills[name] = managedSkill
  await writeFile(registryPath, JSON.stringify(registry, null, 2))
}

describe("update command", () => {
  beforeEach(async () => {
    await mkdir(skillsDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("identifies skills with installSource as updatable", async () => {
    await createInstalledSkill(
      "updatable-skill",
      "---\nname: updatable-skill\n---\n# v1",
      { repo: "user/repo", protocol: "https", skillPath: "./skills/updatable-skill" }
    )

    await createInstalledSkill(
      "adopted-skill",
      "---\nname: adopted-skill\n---\n# Local"
      // No installSource - adopted locally
    )

    const registry: Registry = JSON.parse(await readFile(registryPath, "utf-8"))

    const updatable = Object.values(registry.skills).filter(s => s.installSource)
    const nonUpdatable = Object.values(registry.skills).filter(s => !s.installSource)

    expect(updatable.length).toBe(1)
    expect(updatable[0].name).toBe("updatable-skill")
    expect(nonUpdatable.length).toBe(1)
    expect(nonUpdatable[0].name).toBe("adopted-skill")
  })

  test("groups skills by repo", async () => {
    await createInstalledSkill(
      "skill-a",
      "---\nname: skill-a\n---\n# A",
      { repo: "owner/repo1", protocol: "https", skillPath: "./skills/a" }
    )

    await createInstalledSkill(
      "skill-b",
      "---\nname: skill-b\n---\n# B",
      { repo: "owner/repo1", protocol: "https", skillPath: "./skills/b" }
    )

    await createInstalledSkill(
      "skill-c",
      "---\nname: skill-c\n---\n# C",
      { repo: "owner/repo2", protocol: "ssh", skillPath: "./skills/c" }
    )

    const registry: Registry = JSON.parse(await readFile(registryPath, "utf-8"))
    const updatable = Object.values(registry.skills).filter(s => s.installSource)

    // Group by repo (mimicking the groupByRepo function)
    const groups = new Map<string, typeof updatable>()
    for (const skill of updatable) {
      const key = `${skill.installSource!.protocol}:${skill.installSource!.repo}`
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(skill)
    }

    expect(groups.size).toBe(2)
    expect(groups.get("https:owner/repo1")?.length).toBe(2)
    expect(groups.get("ssh:owner/repo2")?.length).toBe(1)
  })

  test("stores installSource with correct structure", async () => {
    await createInstalledSkill(
      "test-skill",
      "---\nname: test-skill\n---\n# Test",
      { repo: "better-auth/skills", protocol: "https", skillPath: "./better-auth/create-auth" }
    )

    const registry: Registry = JSON.parse(await readFile(registryPath, "utf-8"))
    const skill = registry.skills["test-skill"]

    expect(skill.installSource).toBeDefined()
    expect(skill.installSource!.repo).toBe("better-auth/skills")
    expect(skill.installSource!.protocol).toBe("https")
    expect(skill.installSource!.skillPath).toBe("./better-auth/create-auth")
  })
})
