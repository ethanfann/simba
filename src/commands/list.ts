import { defineCommand } from "citty"
import { RegistryStore } from "../core/registry-store"
import { ConfigStore } from "../core/config-store"
import { getRegistryPath, getConfigPath } from "../utils/paths"

export default defineCommand({
  meta: {
    name: "list",
    description: "List all managed skills",
  },
  async run() {
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
