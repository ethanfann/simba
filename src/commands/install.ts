import { defineCommand } from "citty"
import { readdir, access, readFile } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import * as p from "@clack/prompts"
import matter from "gray-matter"
import simpleGit from "simple-git"
import { tmpdir } from "node:os"
import { mkdir, rm } from "node:fs/promises"
import { RegistryStore } from "../core/registry-store"
import { SkillsStore } from "../core/skills-store"
import { getSkillsDir, getRegistryPath } from "../utils/paths"
import { compareFiles, renderDiff } from "../utils/diff"
import type { ManagedSkill, InstallSource } from "../core/types"

interface DiscoveredSkill {
  name: string
  path: string
  description?: string
  relativePath?: string // Path relative to repo root, for installSource tracking
}

interface MarketplacePlugin {
  name: string
  description?: string
  source?: string
  skills?: string[]
}

interface MarketplaceJson {
  name: string
  plugins?: MarketplacePlugin[]
}

const SKILL_DIRS = ["skills", ".claude/skills", ".cursor/skills", ".codex/skills"]

interface SubmoduleInfo {
  path: string
  url: string
}

async function parseGitmodules(basePath: string): Promise<SubmoduleInfo[]> {
  const gitmodulesPath = join(basePath, ".gitmodules")
  const submodules: SubmoduleInfo[] = []

  try {
    const content = await readFile(gitmodulesPath, "utf-8")
    // Parse submodule sections
    const sections = content.split(/\[submodule\s+"[^"]+"\]/)

    for (const section of sections) {
      if (!section.trim()) continue

      const pathMatch = section.match(/^\s*path\s*=\s*(.+)$/m)
      const urlMatch = section.match(/^\s*url\s*=\s*(.+)$/m)

      if (pathMatch && urlMatch) {
        submodules.push({
          path: pathMatch[1].trim(),
          url: urlMatch[1].trim(),
        })
      }
    }
  } catch {
    // No .gitmodules or can't read it
  }

  return submodules
}

async function cloneSubmodules(basePath: string): Promise<void> {
  const submodules = await parseGitmodules(basePath)

  for (const sub of submodules) {
    const subPath = join(basePath, sub.path)

    // Check if already cloned (has content)
    try {
      const entries = await readdir(subPath)
      if (entries.length > 0) continue // Already has content
    } catch {
      // Directory doesn't exist, need to clone
    }

    console.log(`  Cloning submodule: ${sub.path}...`)
    try {
      const git = simpleGit()
      await mkdir(subPath, { recursive: true })
      await rm(subPath, { recursive: true }) // Remove empty dir for clone
      await git.clone(sub.url, subPath, ["--depth", "1"])
    } catch (err) {
      console.log(`  Warning: Failed to clone ${sub.path}: ${(err as Error).message}`)
    }
  }
}

async function findMarketplaceFiles(basePath: string): Promise<string[]> {
  const results: string[] = []

  async function scan(dir: string): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === ".git") continue

        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === ".claude-plugin") {
            const marketplacePath = join(fullPath, "marketplace.json")
            try {
              await access(marketplacePath)
              results.push(marketplacePath)
            } catch {
              // No marketplace.json in this .claude-plugin
            }
          } else {
            await scan(fullPath)
          }
        }
      }
    } catch {
      // Can't read directory
    }
  }

  await scan(basePath)
  return results
}

async function scanMarketplaceSkills(basePath: string): Promise<DiscoveredSkill[]> {
  const skills: DiscoveredSkill[] = []
  const marketplaceFiles = await findMarketplaceFiles(basePath)

  for (const marketplacePath of marketplaceFiles) {
    try {
      const content = await readFile(marketplacePath, "utf-8")
      const marketplace: MarketplaceJson = JSON.parse(content)
      const pluginDir = join(marketplacePath, "..", "..") // Go up from .claude-plugin/marketplace.json

      for (const plugin of marketplace.plugins || []) {
        for (const skillPath of plugin.skills || []) {
          // Resolve relative path from plugin's base directory
          const resolvedPath = join(pluginDir, skillPath)
          const skillMdPath = join(resolvedPath, "SKILL.md")

          try {
            await access(skillMdPath)
            const skillContent = await readFile(skillMdPath, "utf-8")
            const { data } = matter(skillContent)

            // Use skill name from frontmatter, or derive from path
            const name = data.name || skillPath.split("/").pop() || skillPath

            skills.push({
              name,
              path: resolvedPath,
              description: data.description,
            })
          } catch {
            // SKILL.md doesn't exist at this path
          }
        }
      }
    } catch {
      // Can't parse marketplace.json
    }
  }

  return skills
}

async function scanDirectoryForSkills(skillsPath: string): Promise<DiscoveredSkill[]> {
  const skills: DiscoveredSkill[] = []

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
    // Directory doesn't exist or can't be read
  }

  return skills
}

export async function discoverSkills(basePath: string): Promise<DiscoveredSkill[]> {
  const skills: DiscoveredSkill[] = []
  const seenNames = new Set<string>()

  // Scan standard skill directories
  for (const dir of SKILL_DIRS) {
    const found = await scanDirectoryForSkills(join(basePath, dir))
    for (const skill of found) {
      if (!seenNames.has(skill.name)) {
        skills.push(skill)
        seenNames.add(skill.name)
      }
    }
  }

  // Scan .claude-plugin/marketplace.json for skill paths
  const marketplaceSkills = await scanMarketplaceSkills(basePath)
  for (const skill of marketplaceSkills) {
    if (!seenNames.has(skill.name)) {
      skills.push(skill)
      seenNames.add(skill.name)
    }
  }

  // Scan submodules for skills
  const submodules = await parseGitmodules(basePath)
  for (const sub of submodules) {
    const submoduleBase = join(basePath, sub.path)

    // Check if submodule itself is a skill (has SKILL.md at root)
    try {
      const skillMdPath = join(submoduleBase, "SKILL.md")
      await access(skillMdPath)
      const content = await readFile(skillMdPath, "utf-8")
      const { data } = matter(content)
      const name = data.name || sub.path.split("/").pop() || sub.path

      if (!seenNames.has(name)) {
        skills.push({
          name,
          path: submoduleBase,
          description: data.description,
        })
        seenNames.add(name)
      }
    } catch {
      // Not a skill at root, check standard dirs within submodule
      for (const dir of SKILL_DIRS) {
        const found = await scanDirectoryForSkills(join(submoduleBase, dir))
        for (const skill of found) {
          if (!seenNames.has(skill.name)) {
            skills.push(skill)
            seenNames.add(skill.name)
          }
        }
      }

      // Also check submodule for marketplace.json
      const subMarketplaceSkills = await scanMarketplaceSkills(submoduleBase)
      for (const skill of subMarketplaceSkills) {
        if (!seenNames.has(skill.name)) {
          skills.push(skill)
          seenNames.add(skill.name)
        }
      }
    }
  }

  // Compute relativePath for each skill
  for (const skill of skills) {
    skill.relativePath = "./" + relative(basePath, skill.path)
  }

  return skills
}

export interface InstallOptions {
  source: string
  skillsDir: string
  registryPath: string
  useSSH: boolean
  skillName?: string // Install specific skill by name, skip selection
  onSelect: (skills: DiscoveredSkill[]) => Promise<string[]>
}

export async function runInstall(options: InstallOptions): Promise<void> {
  const skillsStore = new SkillsStore(options.skillsDir, options.registryPath)
  const registryStore = new RegistryStore(options.registryPath)
  const registry = await registryStore.load()

  let sourcePath = options.source
  let isTemp = false
  let sourceInfo: { repo: string; protocol: "https" | "ssh" | "local" } | null = null

  // Check if it's a local path
  const isLocalPath = options.source.startsWith("/") ||
    options.source.startsWith(".") ||
    options.source.startsWith("~")

  if (isLocalPath) {
    // Resolve to absolute path
    sourcePath = resolve(options.source.replace(/^~/, process.env.HOME || "~"))
    sourceInfo = {
      repo: sourcePath,
      protocol: "local"
    }
  } else if (options.source.includes("/")) {
    // Git URL or GitHub shorthand
    let url: string
    if (options.source.includes("://") || options.source.startsWith("git@")) {
      // Already a full URL
      url = options.source
    } else if (options.useSSH) {
      // GitHub shorthand with SSH
      url = `git@github.com:${options.source}.git`
    } else {
      // GitHub shorthand with HTTPS
      url = `https://github.com/${options.source}`
    }

    // Track git info for installSource
    sourceInfo = {
      repo: options.source,
      protocol: options.useSSH ? "ssh" : "https"
    }

    const tempDir = join(tmpdir(), `simba-install-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
    isTemp = true

    console.log(`Cloning ${url}...`)
    const git = simpleGit()
    await git.clone(url, tempDir, ["--depth", "1"])
    sourcePath = tempDir

    // Clone any submodules defined in .gitmodules
    await cloneSubmodules(sourcePath)
  }

  try {
    const discovered = await discoverSkills(sourcePath)

    if (discovered.length === 0) {
      console.log("No skills found in source.")
      return
    }

    let selected: string[]

    if (options.skillName) {
      // Direct install of specific skill
      const skill = discovered.find(s => s.name === options.skillName)
      if (!skill) {
        console.log(`Skill "${options.skillName}" not found in source.`)
        console.log(`Available skills: ${discovered.map(s => s.name).join(", ")}`)
        return
      }
      selected = [options.skillName]
      console.log(`Installing skill: ${options.skillName}`)
    } else {
      console.log(`\nFound ${discovered.length} skills:`)
      for (const skill of discovered) {
        console.log(`  * ${skill.name}${skill.description ? ` - ${skill.description}` : ""}`)
      }

      selected = await options.onSelect(discovered)

      if (selected.length === 0) {
        console.log("No skills selected.")
        return
      }
    }

    for (const name of selected) {
      const skill = discovered.find(s => s.name === name)!
      const newContent = await readFile(join(skill.path, "SKILL.md"), "utf-8")
      const newParsed = matter(newContent)

      if (await skillsStore.hasSkill(name)) {
        // Compare with existing
        const existingPath = join(options.skillsDir, name, "SKILL.md")
        const existingContent = await readFile(existingPath, "utf-8")
        const existingParsed = matter(existingContent)

        const comparison = compareFiles(existingContent, newContent, "SKILL.md")

        if (comparison.identical) {
          console.log(`  Skipping ${name} (identical)`)
          continue
        }

        // Show version info if available
        const existingVersion = existingParsed.data.version as string | undefined
        const newVersion = newParsed.data.version as string | undefined

        if (existingVersion && newVersion) {
          console.log(`\n  ${name}: v${existingVersion} → v${newVersion}`)
        } else {
          console.log(`\n  ${name}: changes detected`)
        }

        if (comparison.diff) {
          renderDiff(comparison.diff, "current", "new")
        }

        const update = await p.confirm({
          message: `Update ${name}?`,
          initialValue: true,
        })

        if (p.isCancel(update) || !update) {
          console.log(`  Skipping ${name}`)
          continue
        }

        // Remove old and add new
        await rm(join(options.skillsDir, name), { recursive: true })

        if (sourceInfo?.protocol === "local") {
          await skillsStore.linkSkill(name, skill.path)
        } else {
          await skillsStore.addSkill(name, skill.path)
        }

        registry.skills[name].source = `installed:${options.source}`
        registry.skills[name].installedAt = new Date().toISOString()
        if (sourceInfo) {
          registry.skills[name].installSource = {
            repo: sourceInfo.repo,
            protocol: sourceInfo.protocol,
            skillPath: skill.relativePath
          }
        }

        console.log(`  Updated: ${name}`)
      } else {
        if (sourceInfo?.protocol === "local") {
          await skillsStore.linkSkill(name, skill.path)
        } else {
          await skillsStore.addSkill(name, skill.path)
        }

        const managedSkill: ManagedSkill = {
          name,
          source: `installed:${options.source}`,
          installedAt: new Date().toISOString(),
          assignments: {},
          installSource: sourceInfo ? {
            repo: sourceInfo.repo,
            protocol: sourceInfo.protocol,
            skillPath: skill.relativePath
          } : undefined
        }
        registry.skills[name] = managedSkill

        console.log(`  Installed: ${name}`)
      }
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
    ssh: { type: "boolean", description: "Use SSH for GitHub repos (for private repos)", default: false },
    skill: { type: "string", description: "Install specific skill by name (skip selection)", required: false },
  },
  async run({ args }) {
    await runInstall({
      source: args.source,
      skillsDir: getSkillsDir(),
      registryPath: getRegistryPath(),
      useSSH: args.ssh,
      skillName: args.skill,
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
