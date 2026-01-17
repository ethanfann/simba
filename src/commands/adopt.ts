import { defineCommand } from "citty"
import { readdir, rm, access } from "node:fs/promises"
import { join } from "node:path"
import * as p from "@clack/prompts"
import { ConfigStore } from "../core/config-store"
import { RegistryStore } from "../core/registry-store"
import { SkillsStore } from "../core/skills-store"
import { AgentRegistry } from "../core/agent-registry"
import { getConfigPath, getSkillsDir, getRegistryPath } from "../utils/paths"
import { isSymlink, createSymlink } from "../utils/symlinks"
import type { Agent, ManagedSkill } from "../core/types"

export interface AdoptOptions {
  skillsDir: string
  registryPath: string
  configPath: string
  agents: Record<string, Agent>
  dryRun: boolean
  onConflict: (skillName: string, agents: string[]) => Promise<string>
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

    try {
      const entries = await readdir(agent.globalPath, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const skillPath = join(agent.globalPath, entry.name)
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
  for (const [name, skills] of byName) {
    if (await skillsStore.hasSkill(name)) {
      console.log(`  Skipping ${name} (already in store)`)
      continue
    }

    if (skills.length === 1) {
      toAdopt.push({ name, skill: skills[0] })
    } else {
      const chosenAgent = await options.onConflict(name, skills.map(s => s.agentId))
      const chosen = skills.find(s => s.agentId === chosenAgent)!
      toAdopt.push({ name, skill: chosen })
    }
  }

  if (toAdopt.length === 0) {
    console.log("\nNo new skills to adopt.")
    return
  }

  console.log(`\nAdopting ${toAdopt.length} skills...`)

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
      onConflict: async (skillName, agents) => {
        const result = await p.select({
          message: `Conflict: "${skillName}" exists in multiple agents. Which version?`,
          options: agents.map(a => ({ value: a, label: a })),
        })
        if (p.isCancel(result)) process.exit(0)
        return result as string
      },
    })
  },
})
