import { defineCommand } from "citty"
import * as p from "@clack/prompts"
import { RegistryStore } from "../core/registry-store"
import { SkillsStore } from "../core/skills-store"
import { ConfigStore } from "../core/config-store"
import { AgentRegistry } from "../core/agent-registry"
import { getSkillsDir, getRegistryPath, getConfigPath, expandPath } from "../utils/paths"

export interface AssignOptions {
  skill: string
  agents: string[]
  skillsDir: string
  registryPath: string
  agentPaths: Record<string, string>
}

export async function runAssign(options: AssignOptions): Promise<void> {
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

    await skillsStore.assignSkill(options.skill, agentPath, { type: "directory" })
    skill.assignments[agentId] = { type: "directory" }
    console.log(`Assigned ${options.skill} to ${agentId}`)
  }

  await registryStore.save(registry)
}

export default defineCommand({
  meta: { name: "assign", description: "Assign a skill to agents" },
  args: {
    skill: { type: "positional", description: "Skill name", required: false },
    agents: { type: "positional", description: "Agent IDs (comma-separated)", required: false },
  },
  async run({ args }) {
    const configStore = new ConfigStore(getConfigPath())
    const config = await configStore.load()

    const registryStore = new RegistryStore(getRegistryPath())
    const registry = await registryStore.load()

    // Get detected agents
    const agentRegistry = new AgentRegistry(config.agents)
    const detected = await agentRegistry.detectAgents()
    const detectedAgents = Object.entries(detected).filter(([, a]) => a.detected)

    const agentPaths: Record<string, string> = {}
    for (const [id, agent] of detectedAgents) {
      agentPaths[id] = expandPath(agent.globalPath)
    }

    // Interactive mode if args missing
    let skill = args.skill as string | undefined
    let agents: string[]

    if (!skill) {
      const skills = Object.keys(registry.skills)
      if (skills.length === 0) {
        console.log("No skills managed. Run 'simba adopt' first.")
        return
      }

      const result = await p.select({
        message: "Select a skill to assign",
        options: skills.map((s) => ({ value: s, label: s })),
      })
      if (p.isCancel(result)) process.exit(0)
      skill = result as string
    }

    if (!args.agents) {
      if (detectedAgents.length === 0) {
        console.log("No agents detected.")
        return
      }

      const result = await p.multiselect({
        message: "Select agents to assign to",
        options: detectedAgents.map(([id, a]) => ({ value: id, label: a.name })),
        required: true,
      })
      if (p.isCancel(result)) process.exit(0)
      agents = result as string[]
    } else {
      agents = (args.agents as string).split(",").map((a) => a.trim())
    }

    await runAssign({
      skill,
      agents,
      skillsDir: getSkillsDir(),
      registryPath: getRegistryPath(),
      agentPaths,
    })
  },
})
