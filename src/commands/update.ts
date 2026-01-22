import { defineCommand } from "citty"
import { readFile, readdir, mkdir, rm } from "node:fs/promises"
import { join, relative } from "node:path"
import * as p from "@clack/prompts"
import simpleGit from "simple-git"
import { tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { RegistryStore } from "../core/registry-store"
import { SkillsStore } from "../core/skills-store"
import { getSkillsDir, getRegistryPath } from "../utils/paths"
import { compareFiles, renderDiff } from "../utils/diff"
import { discoverSkills } from "./install"
import type { ManagedSkill, InstallSource } from "../core/types"
import matter from "gray-matter"

/**
 * Recursively get all files in a directory (sorted for deterministic hashing)
 */
async function getAllFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  
  async function scan(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await scan(fullPath)
      } else {
        files.push(relative(dir, fullPath))
      }
    }
  }
  
  await scan(dir)
  return files.sort()
}

/**
 * Compute a content hash for an entire skill directory.
 * Hash includes: sorted file paths + their contents
 */
async function hashSkillDir(dir: string): Promise<string> {
  const files = await getAllFiles(dir)
  const hash = createHash("sha256")
  
  for (const file of files) {
    // Include file path in hash (detects renames/additions/deletions)
    hash.update(file)
    hash.update("\0")
    
    // Include file content
    const content = await readFile(join(dir, file))
    hash.update(content)
    hash.update("\0")
  }
  
  return hash.digest("hex")
}

interface SkillUpdate {
  skill: ManagedSkill
  newPath: string
  newContent: string
  existingContent: string
}

interface RepoGroup {
  repo: string
  protocol: "https" | "ssh"
  skills: ManagedSkill[]
}

function groupByRepo(skills: ManagedSkill[]): RepoGroup[] {
  const groups = new Map<string, RepoGroup>()

  for (const skill of skills) {
    if (!skill.installSource) continue
    // Skip local skills - they're symlinked and always up to date
    if (skill.installSource.protocol === "local") continue

    const key = `${skill.installSource.protocol}:${skill.installSource.repo}`
    if (!groups.has(key)) {
      groups.set(key, {
        repo: skill.installSource.repo,
        protocol: skill.installSource.protocol as "https" | "ssh",
        skills: []
      })
    }
    groups.get(key)!.skills.push(skill)
  }

  return Array.from(groups.values())
}

export interface UpdateOptions {
  skillsDir: string
  registryPath: string
  onConfirm: (updates: Array<{ name: string; hasChanges: boolean }>) => Promise<string[]>
}

export async function runUpdate(options: UpdateOptions): Promise<void> {
  const skillsStore = new SkillsStore(options.skillsDir, options.registryPath)
  const registryStore = new RegistryStore(options.registryPath)
  const registry = await registryStore.load()

  // Find skills with installSource (excluding local symlinked skills)
  const allSkillsWithSource = Object.values(registry.skills).filter(s => s.installSource)
  const localSkills = allSkillsWithSource.filter(s => s.installSource?.protocol === "local")
  const remoteSkills = allSkillsWithSource.filter(s => s.installSource?.protocol !== "local")

  if (allSkillsWithSource.length === 0) {
    console.log("No updatable skills found. Skills need installSource to be updated.")
    return
  }

  if (localSkills.length > 0) {
    console.log(`Skipping ${localSkills.length} local symlinked skills (always up to date)`)
  }

  if (remoteSkills.length === 0) {
    console.log("No remote skills to update.")
    return
  }

  console.log(`Found ${remoteSkills.length} remote skills to check`)

  // Group by repo
  const repoGroups = groupByRepo(remoteSkills)
  const allUpdates: SkillUpdate[] = []

  for (const group of repoGroups) {
    console.log(`\nChecking ${group.repo}...`)

    // Clone the repo
    let url: string
    if (group.repo.includes("://") || group.repo.startsWith("git@")) {
      url = group.repo
    } else if (group.protocol === "ssh") {
      url = `git@github.com:${group.repo}.git`
    } else {
      url = `https://github.com/${group.repo}`
    }

    const tempDir = join(tmpdir(), `simba-update-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })

    try {
      const git = simpleGit()
      await git.clone(url, tempDir, ["--depth", "1"])

      // Discover skills in the cloned repo
      const discovered = await discoverSkills(tempDir)
      const discoveredByPath = new Map(
        discovered.map(s => [s.relativePath, s])
      )

      // Check each skill for updates
      for (const skill of group.skills) {
        const skillPath = skill.installSource!.skillPath
        const remote = discoveredByPath.get(skillPath)

        if (!remote) {
          console.log(`  ⚠ ${skill.name}: skill path not found in repo (${skillPath})`)
          continue
        }

        const localDir = join(options.skillsDir, skill.name)
        
        // Hash entire directories to detect any file changes
        const [localHash, remoteHash] = await Promise.all([
          hashSkillDir(localDir),
          hashSkillDir(remote.path)
        ])

        if (localHash === remoteHash) {
          console.log(`  ✓ ${skill.name}: up to date`)
        } else {
          console.log(`  ↑ ${skill.name}: update available`)
          
          // Still read SKILL.md for version display purposes
          const existingContent = await readFile(join(localDir, "SKILL.md"), "utf-8")
          const newContent = await readFile(join(remote.path, "SKILL.md"), "utf-8")
          
          allUpdates.push({
            skill,
            newPath: remote.path,
            newContent,
            existingContent
          })
        }
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  }

  if (allUpdates.length === 0) {
    console.log("\nAll skills are up to date!")
    return
  }

  console.log(`\n${allUpdates.length} updates available:`)

  // Show updates and prompt for selection
  const updateInfo = allUpdates.map(u => ({
    name: u.skill.name,
    hasChanges: true
  }))

  const selectedNames = await options.onConfirm(updateInfo)

  if (selectedNames.length === 0) {
    console.log("No updates selected.")
    return
  }

  // Apply selected updates
  for (const name of selectedNames) {
    const update = allUpdates.find(u => u.skill.name === name)!
    const existingParsed = matter(update.existingContent)
    const newParsed = matter(update.newContent)

    const existingVersion = existingParsed.data.version as string | undefined
    const newVersion = newParsed.data.version as string | undefined

    if (existingVersion && newVersion) {
      console.log(`\n${name}: v${existingVersion} → v${newVersion}`)
    } else {
      console.log(`\n${name}: changes detected`)
    }

    const comparison = compareFiles(update.existingContent, update.newContent, "SKILL.md")
    if (comparison.diff) {
      renderDiff(comparison.diff, "current", "new")
    }

    // Re-clone to get the files (since we deleted tempDir)
    const source = update.skill.installSource!
    let url: string
    if (source.repo.includes("://") || source.repo.startsWith("git@")) {
      url = source.repo
    } else if (source.protocol === "ssh") {
      url = `git@github.com:${source.repo}.git`
    } else {
      url = `https://github.com/${source.repo}`
    }

    const tempDir = join(tmpdir(), `simba-update-apply-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })

    try {
      const git = simpleGit()
      await git.clone(url, tempDir, ["--depth", "1"])

      const discovered = await discoverSkills(tempDir)
      const remote = discovered.find(s => s.relativePath === source.skillPath)

      if (!remote) {
        console.log(`  Error: Could not find skill at ${source.skillPath}`)
        continue
      }

      // Remove old and add new
      await rm(join(options.skillsDir, name), { recursive: true })
      await skillsStore.addSkill(name, remote.path)

      registry.skills[name].installedAt = new Date().toISOString()
      console.log(`  Updated: ${name}`)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  }

  await registryStore.save(registry)
  console.log("\nUpdate complete!")
}

export default defineCommand({
  meta: { name: "update", description: "Update installed skills from their sources" },
  args: {},
  async run() {
    await runUpdate({
      skillsDir: getSkillsDir(),
      registryPath: getRegistryPath(),
      onConfirm: async (updates) => {
        const result = await p.multiselect({
          message: "Select skills to update:",
          options: updates.map(u => ({
            value: u.name,
            label: u.name,
          })),
          initialValues: updates.map(u => u.name), // Select all by default
        })

        if (p.isCancel(result)) {
          process.exit(0)
        }

        return result as string[]
      },
    })
  },
})
