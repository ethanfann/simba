import { defineCommand } from "citty"
import { ConfigStore } from "../core/config-store"
import { AgentRegistry } from "../core/agent-registry"
import { SkillManager } from "../core/skill-manager"
import { getConfigPath } from "../utils/paths"

export default defineCommand({
  meta: {
    name: "status",
    description: "Show skill matrix across agents",
  },
  args: {
    agent: {
      type: "string",
      description: "Filter to specific agent",
    },
  },
  async run({ args }) {
    const configStore = new ConfigStore(getConfigPath())
    const config = await configStore.load()

    const registry = new AgentRegistry(config.agents)
    const manager = new SkillManager(registry, config.agents)

    const matrix = await manager.buildMatrix()

    // Get detected agents
    const detectedAgents = Object.entries(config.agents)
      .filter(([_, a]) => a.detected)
      .filter(([id]) => !args.agent || id === args.agent)

    if (detectedAgents.length === 0) {
      console.log("No agents detected. Run 'simba detect' first.")
      return
    }

    // Print header
    const agentNames = detectedAgents.map(([_, a]) => a.shortName.padEnd(8))
    console.log(`\n${"Skill".padEnd(24)} ${agentNames.join(" ")}`)
    console.log("─".repeat(24 + agentNames.length * 9))

    // Print matrix
    const statusSymbols = {
      synced: "✓",
      conflict: "⚠",
      unique: "●",
      missing: "─",
    }

    for (const row of matrix) {
      const cells = detectedAgents.map(([id]) => {
        const cell = row.agents[id]
        if (!cell?.present) return "─".padStart(4).padEnd(8)
        if (row.status === "conflict") return "⚠".padStart(4).padEnd(8)
        return "✓".padStart(4).padEnd(8)
      })

      const skillName = row.skillName.slice(0, 23).padEnd(24)
      console.log(`${skillName} ${cells.join(" ")}`)
    }

    // Summary
    const synced = matrix.filter((m) => m.status === "synced").length
    const conflicts = matrix.filter((m) => m.status === "conflict").length
    const unique = matrix.filter((m) => m.status === "unique").length

    console.log("\n" + "─".repeat(24 + agentNames.length * 9))
    console.log(`✓ synced: ${synced}  ⚠ conflict: ${conflicts}  ● unique: ${unique}`)
  },
})
