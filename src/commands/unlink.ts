import { defineCommand } from "citty"
import { RegistryStore } from "../core/registry-store"
import { SkillsStore } from "../core/skills-store"
import { ConfigStore } from "../core/config-store"
import { AgentRegistry } from "../core/agent-registry"
import { getSkillsDir, getRegistryPath, getConfigPath, expandPath } from "../utils/paths"

export interface UnassignOptions {
  skill: string
  agents: string[]
  skillsDir: string
  registryPath: string
  agentPaths: Record<string, string>
}

export async function runUnassign(options: UnassignOptions): Promise<void> {
  const skillsStore = new SkillsStore(options.skillsDir, options.registryPath)
  const registryStore = new RegistryStore(options.registryPath)
  const registry = await registryStore.load()

  const skill = registry.skills[options.skill]
  if (!skill) {
    console.error(`Skill not found: ${options.skill}`)
    process.exit(1)
  }

  for (const agentId of options.agents) {
    const agentPath = options.agentPaths[agentId]
    if (!agentPath) {
      console.error(`Unknown agent: ${agentId}`)
      continue
    }

    if (agentPath === options.skillsDir) {
      console.error(`Cannot unlink ${options.skill} from ${agentId}; remove the skill instead`)
      continue
    }

    await skillsStore.unassignSkill(options.skill, agentPath)
    delete skill.assignments[agentId]
    console.log(`Unlinked ${options.skill} from ${agentId}`)
  }

  await registryStore.save(registry)
}

export default defineCommand({
  meta: { name: "unlink", description: "Unlink a skill from install locations" },
  args: {
    skill: { type: "positional", description: "Skill name", required: true },
    agents: { type: "positional", description: "Install location IDs (comma-separated)", required: true },
  },
  async run({ args }) {
    const configStore = new ConfigStore(getConfigPath())
    const config = await configStore.load()

    const agentRegistry = new AgentRegistry(config.agents)
    const detected = await agentRegistry.detectAgents()

    const agentPaths: Record<string, string> = {}
    for (const [id, agent] of Object.entries(detected)) {
      if (agent.detected) {
        agentPaths[id] = expandPath(agent.globalPath)
      }
    }

    const agents = (args.agents as string).split(",").map(a => a.trim())

    await runUnassign({
      skill: args.skill,
      agents,
      skillsDir: getSkillsDir(),
      registryPath: getRegistryPath(),
      agentPaths,
    })
  },
})
