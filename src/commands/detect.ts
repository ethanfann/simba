import { defineCommand } from "citty"
import { ConfigStore } from "../core/config-store"
import { AgentRegistry } from "../core/agent-registry"
import { getConfigPath } from "../utils/paths"

export default defineCommand({
  meta: {
    name: "detect",
    description: "Scan for installed agents and skills",
  },
  args: {
    refresh: {
      type: "boolean",
      description: "Force rescan even if already detected",
      default: false,
    },
  },
  async run({ args }) {
    const configStore = new ConfigStore(getConfigPath())
    const config = await configStore.load()

    const registry = new AgentRegistry(config.agents)
    const detected = await registry.detectAgents()

    // Update config with detection results
    for (const [id, agent] of Object.entries(detected)) {
      config.agents[id] = agent
    }

    // Scan skills from detected agents
    let totalSkills = 0
    for (const [id, agent] of Object.entries(detected)) {
      if (!agent.detected) continue

      const skills = await registry.listSkills(id)
      totalSkills += skills.length

      for (const skill of skills) {
        config.skills[skill.name] = {
          ...config.skills[skill.name],
          ...skill,
          agents: [
            ...new Set([
              ...(config.skills[skill.name]?.agents ?? []),
              id,
            ]),
          ],
        }
      }
    }

    await configStore.save(config)

    // Output results
    console.log("\nDetected agents:")
    for (const [id, agent] of Object.entries(detected)) {
      const status = agent.detected ? "✓" : "─"
      console.log(`  ${status} ${agent.name}`)
    }

    console.log(`\nTotal skills found: ${totalSkills}`)
  },
})
