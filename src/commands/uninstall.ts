import { defineCommand } from "citty"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import * as p from "@clack/prompts"
import { RegistryStore } from "../core/registry-store"
import { SkillsStore } from "../core/skills-store"
import { ConfigStore } from "../core/config-store"
import { AgentRegistry } from "../core/agent-registry"
import { getSkillsDir, getRegistryPath, getConfigPath, expandPath } from "../utils/paths"

export interface UninstallOptions {
  skills: string[]
  skillsDir: string
  registryPath: string
  agentPaths: Record<string, string>
  deleteFiles: boolean
}

export async function runUninstall(options: UninstallOptions): Promise<void> {
  const skillsStore = new SkillsStore(options.skillsDir, options.registryPath)
  const registryStore = new RegistryStore(options.registryPath)
  const registry = await registryStore.load()

  for (const name of options.skills) {
    const skill = registry.skills[name]
    if (!skill) {
      console.log(`  Skill not found: ${name}`)
      continue
    }

    // Remove symlinks from all assigned agents
    for (const agentId of Object.keys(skill.assignments)) {
      const agentPath = options.agentPaths[agentId]
      if (agentPath) {
        try {
          await rm(join(agentPath, name), { recursive: true, force: true })
          console.log(`  Removed from ${agentId}`)
        } catch {
          // Ignore errors if symlink doesn't exist
        }
      }
    }

    // Remove from store if requested
    if (options.deleteFiles) {
      await rm(join(options.skillsDir, name), { recursive: true, force: true })
      console.log(`  Deleted files: ${name}`)
    }

    // Remove from registry
    delete registry.skills[name]

    console.log(`  Uninstalled: ${name}`)
  }

  await registryStore.save(registry)
  console.log("\nUninstall complete!")
}

export default defineCommand({
  meta: { name: "uninstall", description: "Remove a skill from Simba's store" },
  args: {
    skill: { type: "positional", description: "Skill name to uninstall", required: false },
  },
  async run({ args }) {
    const registryStore = new RegistryStore(getRegistryPath())
    const registry = await registryStore.load()

    const configStore = new ConfigStore(getConfigPath())
    const config = await configStore.load()

    // Get agent paths
    const agentRegistry = new AgentRegistry(config.agents)
    const detected = await agentRegistry.detectAgents()

    const agentPaths: Record<string, string> = {}
    for (const [id, agent] of Object.entries(detected)) {
      agentPaths[id] = expandPath(agent.globalPath)
    }

    let skills: string[]

    if (args.skill) {
      skills = [args.skill as string]
    } else {
      // Interactive mode
      const managedSkills = Object.keys(registry.skills)

      if (managedSkills.length === 0) {
        console.log("No skills managed.")
        return
      }

      const result = await p.multiselect({
        message: "Select skills to uninstall",
        options: managedSkills.map((s) => ({ value: s, label: s })),
        required: true,
      })

      if (p.isCancel(result)) process.exit(0)
      skills = result as string[]
    }

    // Confirm
    const confirm = await p.confirm({
      message: `Uninstall ${skills.length} skill(s)? This will remove them from all agents.`,
      initialValue: false,
    })

    if (p.isCancel(confirm) || !confirm) {
      console.log("Cancelled.")
      return
    }

    // Ask about deleting files
    const deleteFiles = await p.confirm({
      message: "Also delete skill files from Simba's store?",
      initialValue: true,
    })

    if (p.isCancel(deleteFiles)) {
      console.log("Cancelled.")
      return
    }

    await runUninstall({
      skills,
      skillsDir: getSkillsDir(),
      registryPath: getRegistryPath(),
      agentPaths,
      deleteFiles: deleteFiles as boolean,
    })
  },
})
