import { defineCommand } from "citty"
import { ConfigStore } from "../core/config-store"
import { AgentRegistry } from "../core/agent-registry"
import { getConfigPath } from "../utils/paths"
import { selectFromList, selectAgent } from "../utils/prompts"
import { mkdir, access } from "node:fs/promises"
import { join } from "node:path"

export default defineCommand({
  meta: {
    name: "import",
    description: "Copy a global skill into current project",
  },
  args: {
    skill: {
      type: "positional",
      description: "Skill name to import",
    },
    to: {
      type: "string",
      description: "Target directory (defaults to detected agent's project path)",
    },
    agent: {
      type: "string",
      description: "Source agent (defaults to first detected with skill)",
    },
  },
  async run({ args }) {
    const configStore = new ConfigStore(getConfigPath())
    const config = await configStore.load()
    const registry = new AgentRegistry(config.agents)

    let skillName = args.skill
    let agentId = args.agent

    // Interactive agent selection if not provided
    if (!agentId) {
      agentId = await selectAgent(config.agents, "Select source agent")
    }

    const agent = config.agents[agentId]
    if (!agent || !agent.detected) {
      console.error(`Agent not found or not detected: ${agentId}`)
      process.exit(1)
    }

    // Get available skills from selected agent
    const availableSkills = await registry.listSkills(agentId)

    if (availableSkills.length === 0) {
      console.log(`No skills found in ${agent.name}.`)
      return
    }

    // Interactive skill selection if not provided
    if (!skillName) {
      skillName = await selectFromList(
        "Select skill to import:",
        availableSkills.map((s) => ({ value: s.name, label: s.name }))
      )
    }

    // Find skill source
    const sourcePath = registry.getSkillPath(skillName, agentId)
    try {
      await access(join(sourcePath, "SKILL.md"))
    } catch {
      console.error(`Skill not found in ${agentId}: ${skillName}`)
      process.exit(1)
    }

    // Determine target path
    let targetPath: string

    if (args.to) {
      targetPath = join(args.to, skillName)
    } else {
      // Use project path of source agent
      targetPath = join(process.cwd(), agent.projectPath, skillName)
    }

    // Check if target exists
    try {
      await access(targetPath)
      console.error(`Skill already exists at: ${targetPath}`)
      process.exit(1)
    } catch {
      // Good, doesn't exist
    }

    // Copy skill
    await mkdir(join(targetPath, ".."), { recursive: true })
    await Bun.$`cp -r ${sourcePath} ${targetPath}`

    console.log(`\nImported: ${skillName}`)
    console.log(`From: ${agent.name}`)
    console.log(`To: ${targetPath}`)
  },
})
