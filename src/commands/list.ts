import { defineCommand } from "citty"
import { RegistryStore } from "../core/registry-store"
import { ConfigStore } from "../core/config-store"
import { AgentRegistry } from "../core/agent-registry"
import { SkillManager } from "../core/skill-manager"
import { getRegistryPath, getConfigPath } from "../utils/paths"

export interface ListOptions {
  registryPath: string
  agents: Record<string, { name: string }>
}

export interface SkillInfo {
  name: string
  agentNames: string[]
}

export async function listSkills(options: ListOptions): Promise<SkillInfo[]> {
  const registryStore = new RegistryStore(options.registryPath)
  const registry = await registryStore.load()

  const skills = Object.values(registry.skills)

  return skills.map((skill) => {
    const assignments = Object.keys(skill.assignments)
    const agentNames = assignments.map((id) => options.agents[id]?.name || id)
    return { name: skill.name, agentNames }
  })
}

export default defineCommand({
  meta: {
    name: "list",
    description: "List all managed skills",
  },
  args: {
    matrix: {
      type: "boolean",
      alias: "m",
      description: "Show skill matrix across agents",
      default: false,
    },
    agent: {
      type: "string",
      description: "Filter to specific agent",
    },
  },
  async run({ args }) {
    if (args.matrix) {
      const configStore = new ConfigStore(getConfigPath())
      const config = await configStore.load()

      const registry = new AgentRegistry(config.agents)
      const detected = await registry.detectAgents()
      const manager = new SkillManager(registry, detected)

      const matrix = await manager.buildMatrix()

      // Get detected agents
      const detectedAgents = Object.entries(detected)
        .filter(([_, a]) => a.detected)
        .filter(([id]) => !args.agent || id === args.agent)

      if (detectedAgents.length === 0) {
        console.log("No install locations available. Run 'simba init' first.")
        return
      }

      // Print header
      const agentNames = detectedAgents.map(([_, a]) => a.shortName.padEnd(8))
      console.log(`\n${"Skill".padEnd(24)} ${agentNames.join(" ")}`)
      console.log("─".repeat(24 + agentNames.length * 9))

      // Print matrix
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
      return
    }

    const registryStore = new RegistryStore(getRegistryPath())
    const registry = await registryStore.load()

    const configStore = new ConfigStore(getConfigPath())
    const config = await configStore.load()

    const skills = Object.values(registry.skills)

    if (skills.length === 0) {
      console.log("No skills managed. Run 'simba adopt' to get started.")
      return
    }

    console.log("\nManaged skills:\n")

    for (const skill of skills) {
      const assignments = Object.keys(skill.assignments)
      const agentNames = assignments.map(id => config.agents[id]?.name || id)

      console.log(`  ${skill.name}`)
      if (agentNames.length > 0) {
        console.log(`    └─ ${agentNames.join(", ")}`)
      } else {
        console.log(`    └─ (not assigned)`)
      }
    }

    console.log(`\nTotal: ${skills.length} skills`)
  },
})
