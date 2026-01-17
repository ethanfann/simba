import { defineCommand } from "citty"
import { readdir, access, readFile } from "node:fs/promises"
import { join } from "node:path"
import * as p from "@clack/prompts"
import matter from "gray-matter"
import simpleGit from "simple-git"
import { tmpdir } from "node:os"
import { mkdir, rm } from "node:fs/promises"
import { RegistryStore } from "../core/registry-store"
import { SkillsStore } from "../core/skills-store"
import { getSkillsDir, getRegistryPath } from "../utils/paths"
import type { ManagedSkill } from "../core/types"

interface DiscoveredSkill {
  name: string
  path: string
  description?: string
}

const SKILL_DIRS = ["skills", ".claude/skills", ".cursor/skills", ".codex/skills"]

export async function discoverSkills(basePath: string): Promise<DiscoveredSkill[]> {
  const skills: DiscoveredSkill[] = []

  for (const dir of SKILL_DIRS) {
    const skillsPath = join(basePath, dir)
    try {
      const entries = await readdir(skillsPath, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const skillPath = join(skillsPath, entry.name)
        const skillMdPath = join(skillPath, "SKILL.md")

        try {
          await access(skillMdPath)
          const content = await readFile(skillMdPath, "utf-8")
          const { data } = matter(content)

          skills.push({
            name: entry.name,
            path: skillPath,
            description: data.description,
          })
        } catch {
          continue
        }
      }
    } catch {
      continue
    }
  }

  return skills
}

export interface InstallOptions {
  source: string
  skillsDir: string
  registryPath: string
  onSelect: (skills: DiscoveredSkill[]) => Promise<string[]>
}

export async function runInstall(options: InstallOptions): Promise<void> {
  const skillsStore = new SkillsStore(options.skillsDir, options.registryPath)
  const registryStore = new RegistryStore(options.registryPath)
  const registry = await registryStore.load()

  let sourcePath = options.source
  let isTemp = false

  // Check if it's a git URL or GitHub shorthand
  if (options.source.includes("/") && !options.source.startsWith("/") && !options.source.startsWith(".")) {
    const url = options.source.includes("://")
      ? options.source
      : `https://github.com/${options.source}`

    const tempDir = join(tmpdir(), `simba-install-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
    isTemp = true

    console.log(`Cloning ${url}...`)
    const git = simpleGit()
    await git.clone(url, tempDir, ["--depth", "1"])
    sourcePath = tempDir
  }

  try {
    const discovered = await discoverSkills(sourcePath)

    if (discovered.length === 0) {
      console.log("No skills found in source.")
      return
    }

    console.log(`\nFound ${discovered.length} skills:`)
    for (const skill of discovered) {
      console.log(`  * ${skill.name}${skill.description ? ` - ${skill.description}` : ""}`)
    }

    const selected = await options.onSelect(discovered)

    if (selected.length === 0) {
      console.log("No skills selected.")
      return
    }

    for (const name of selected) {
      const skill = discovered.find(s => s.name === name)!

      if (await skillsStore.hasSkill(name)) {
        console.log(`  Skipping ${name} (already installed)`)
        continue
      }

      await skillsStore.addSkill(name, skill.path)

      const managedSkill: ManagedSkill = {
        name,
        source: `installed:${options.source}`,
        installedAt: new Date().toISOString(),
        assignments: {}
      }
      registry.skills[name] = managedSkill

      console.log(`  Installed: ${name}`)
    }

    await registryStore.save(registry)
    console.log("\nInstallation complete!")
  } finally {
    if (isTemp) {
      await rm(sourcePath, { recursive: true, force: true })
    }
  }
}

export default defineCommand({
  meta: { name: "install", description: "Install skills from GitHub or local path" },
  args: {
    source: { type: "positional", description: "GitHub repo (user/repo) or local path", required: true },
  },
  async run({ args }) {
    await runInstall({
      source: args.source,
      skillsDir: getSkillsDir(),
      registryPath: getRegistryPath(),
      onSelect: async (skills) => {
        const result = await p.multiselect({
          message: "Select skills to install:",
          options: skills.map(s => ({
            value: s.name,
            label: s.name,
            hint: s.description,
          })),
        })

        if (p.isCancel(result)) {
          process.exit(0)
        }

        return result as string[]
      },
    })
  },
})
