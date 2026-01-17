import { defineCommand } from "citty"
import { ConfigStore } from "../core/config-store"
import { AgentRegistry } from "../core/agent-registry"
import { getConfigPath } from "../utils/paths"
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
      required: true,
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

    // Find skill source
    let sourceAgent: string | null = null
    let sourcePath: string | null = null

    if (args.agent) {
      const agent = config.agents[args.agent]
      if (!agent || !agent.detected) {
        console.error(`Agent not found or not detected: ${args.agent}`)
        process.exit(1)
      }

      const skillPath = registry.getSkillPath(args.skill, args.agent)
      try {
        await access(join(skillPath, "SKILL.md"))
        sourceAgent = args.agent
        sourcePath = skillPath
      } catch {
        console.error(`Skill not found in ${args.agent}: ${args.skill}`)
        process.exit(1)
      }
    } else {
      // Find first agent with this skill
      for (const [agentId, agent] of Object.entries(config.agents)) {
        if (!agent.detected) continue

        const skillPath = registry.getSkillPath(args.skill, agentId)
        try {
          await access(join(skillPath, "SKILL.md"))
          sourceAgent = agentId
          sourcePath = skillPath
          break
        } catch {
          continue
        }
      }
    }

    if (!sourceAgent || !sourcePath) {
      console.error(`Skill not found: ${args.skill}`)
      process.exit(1)
    }

    // Determine target path
    let targetPath: string

    if (args.to) {
      targetPath = join(args.to, args.skill)
    } else {
      // Use project path of source agent
      const agent = config.agents[sourceAgent]
      targetPath = join(process.cwd(), agent.projectPath, args.skill)
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

    console.log(`\nImported: ${args.skill}`)
    console.log(`From: ${config.agents[sourceAgent].name}`)
    console.log(`To: ${targetPath}`)
  },
})
