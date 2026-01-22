import { defineCommand } from "citty"
import { readdir, rm, access, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import * as p from "@clack/prompts"
import matter from "gray-matter"
import { ConfigStore } from "../core/config-store"
import { RegistryStore } from "../core/registry-store"
import { SkillsStore } from "../core/skills-store"
import { AgentRegistry } from "../core/agent-registry"
import { getConfigPath, getSkillsDir, getRegistryPath, expandPath } from "../utils/paths"
import { isSymlink, createSymlink } from "../utils/symlinks"
import { compareFiles, renderDiff, renderIdenticalMessage } from "../utils/diff"
import type { Agent, ManagedSkill } from "../core/types"

export interface ConflictingSkill {
  agentId: string
  path: string
}

export interface AdoptOptions {
  skillsDir: string
  registryPath: string
  configPath: string
  agents: Record<string, Agent>
  dryRun: boolean
  onConflict: (skillName: string, skills: ConflictingSkill[]) => Promise<string>
}

interface DiscoveredSkill {
  name: string
  agentId: string
  path: string
}

export async function runAdopt(options: AdoptOptions): Promise<void> {
  const skillsStore = new SkillsStore(options.skillsDir, options.registryPath)
  const registryStore = new RegistryStore(options.registryPath)
  const registry = await registryStore.load()

  const discovered: DiscoveredSkill[] = []
  for (const [agentId, agent] of Object.entries(options.agents)) {
    if (!agent.detected) continue

    const agentPath = expandPath(agent.globalPath)
    try {
      const entries = await readdir(agentPath, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const skillPath = join(agentPath, entry.name)
        if (await isSymlink(skillPath)) continue

        try {
          await access(join(skillPath, "SKILL.md"))
        } catch {
          continue
        }

        discovered.push({ name: entry.name, agentId, path: skillPath })
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
    }
  }

  const byName = new Map<string, DiscoveredSkill[]>()
  for (const skill of discovered) {
    if (!byName.has(skill.name)) byName.set(skill.name, [])
    byName.get(skill.name)!.push(skill)
  }

  const toAdopt: Array<{ name: string; skill: DiscoveredSkill }> = []
  const toTakeover: Array<{ name: string; skills: DiscoveredSkill[] }> = []
  
  for (const [name, skills] of byName) {
    if (await skillsStore.hasSkill(name)) {
      // Already in store - take over rogue copies
      toTakeover.push({ name, skills })
      continue
    }

    if (skills.length === 1) {
      toAdopt.push({ name, skill: skills[0] })
    } else {
      const conflictingSkills = skills.map(s => ({ agentId: s.agentId, path: s.path }))
      const chosenAgent = await options.onConflict(name, conflictingSkills)
      const chosen = skills.find(s => s.agentId === chosenAgent)!
      toAdopt.push({ name, skill: chosen })
    }
  }

  if (toAdopt.length === 0 && toTakeover.length === 0) {
    console.log("\nNo new skills to adopt.")
    return
  }

  if (toAdopt.length > 0) {
    console.log(`\nAdopting ${toAdopt.length} skills...`)
  }

  if (options.dryRun) {
    for (const { name, skill } of toAdopt) {
      console.log(`  Would adopt: ${name} (from ${skill.agentId})`)
    }
    console.log("\n(dry run - no changes made)")
    return
  }

  for (const { name, skill } of toAdopt) {
    await skillsStore.addSkill(name, skill.path)
    await rm(skill.path, { recursive: true })
    await createSymlink(join(options.skillsDir, name), skill.path)

    const managedSkill: ManagedSkill = {
      name,
      source: `adopted:${skill.agentId}`,
      installedAt: new Date().toISOString(),
      assignments: { [skill.agentId]: { type: "directory" } }
    }
    registry.skills[name] = managedSkill

    console.log(`  Adopted: ${name} (from ${skill.agentId})`)
  }

  // Take over rogue copies (skill already in store, but real dirs exist at agents)
  if (toTakeover.length > 0) {
    console.log(`\nTaking over ${toTakeover.length} rogue skills...`)
    
    if (!options.dryRun) {
      for (const { name, skills } of toTakeover) {
        for (const skill of skills) {
          await rm(skill.path, { recursive: true })
          await createSymlink(join(options.skillsDir, name), skill.path)
          
          // Update registry assignment
          if (!registry.skills[name].assignments[skill.agentId]) {
            registry.skills[name].assignments[skill.agentId] = { type: "directory" }
          }
          
          console.log(`  Replaced: ${name} (${skill.agentId})`)
        }
      }
    } else {
      for (const { name, skills } of toTakeover) {
        for (const skill of skills) {
          console.log(`  Would replace: ${name} (${skill.agentId})`)
        }
      }
    }
  }

  await registryStore.save(registry)
  console.log("\nAdoption complete!")
}

export default defineCommand({
  meta: { name: "adopt", description: "Adopt skills from agents into Simba's store" },
  args: {
    dryRun: { type: "boolean", alias: "n", description: "Preview changes without applying", default: false },
  },
  async run({ args }) {
    const configStore = new ConfigStore(getConfigPath())
    const config = await configStore.load()

    const agentRegistry = new AgentRegistry(config.agents)
    const detected = await agentRegistry.detectAgents()

    const detectedAgents = Object.fromEntries(
      Object.entries(detected).filter(([, a]) => a.detected)
    )

    if (Object.keys(detectedAgents).length === 0) {
      console.log("No agents detected. Run 'simba detect' first.")
      return
    }

    console.log("\nScanning agents for skills...")
    for (const [id, agent] of Object.entries(detectedAgents)) {
      console.log(`  ${agent.name}`)
    }

    await runAdopt({
      skillsDir: getSkillsDir(),
      registryPath: getRegistryPath(),
      configPath: getConfigPath(),
      agents: detectedAgents,
      dryRun: args.dryRun,
      onConflict: async (skillName, skills) => {
        // Read SKILL.md content and metadata from each conflicting skill
        const contents = await Promise.all(
          skills.map(async (s) => {
            const skillPath = join(s.path, "SKILL.md")
            const [content, stats] = await Promise.all([
              readFile(skillPath, "utf-8"),
              stat(skillPath),
            ])
            const parsed = matter(content)
            return {
              agentId: s.agentId,
              content,
              mtime: stats.mtime,
              version: parsed.data.version as string | undefined,
            }
          })
        )

        // Check if all versions are identical
        const firstContent = contents[0].content
        const allIdentical = contents.every((c) => c.content === firstContent)

        if (allIdentical) {
          renderIdenticalMessage(skillName)
          return contents[0].agentId
        }

        // Compare semver strings (basic: split by dots, compare numerically)
        const compareSemver = (a: string, b: string): number => {
          const pa = a.split(".").map((n) => parseInt(n, 10) || 0)
          const pb = b.split(".").map((n) => parseInt(n, 10) || 0)
          for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const diff = (pa[i] || 0) - (pb[i] || 0)
            if (diff !== 0) return diff
          }
          return 0
        }

        // Find newest: prefer version comparison if all have versions
        const allHaveVersions = contents.every((c) => c.version)
        const newest = allHaveVersions
          ? contents.reduce((a, b) => (compareSemver(a.version!, b.version!) >= 0 ? a : b))
          : contents.reduce((a, b) => (a.mtime > b.mtime ? a : b))

        // Show diff between first two versions (most common case)
        const comparison = compareFiles(
          contents[0].content,
          contents[1].content,
          "SKILL.md"
        )

        if (comparison.diff) {
          renderDiff(comparison.diff, contents[0].agentId, contents[1].agentId)
        }

        // Format options with version or date
        const formatDate = (d: Date) =>
          d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

        const result = await p.select({
          message: `Conflict: "${skillName}" exists in multiple agents. Which version?`,
          options: contents.map((c) => {
            const info = c.version ? `v${c.version}` : formatDate(c.mtime)
            const isNewest = c.agentId === newest.agentId
            return {
              value: c.agentId,
              label: `${c.agentId} (${info})${isNewest ? " ← newest" : ""}`,
            }
          }),
        })
        if (p.isCancel(result)) process.exit(0)
        return result as string
      },
    })
  },
})
