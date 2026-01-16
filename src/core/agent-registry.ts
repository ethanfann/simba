import { access, readdir, mkdir, cp, rm } from "node:fs/promises"
import { join, dirname } from "node:path"
import { expandPath } from "../utils/paths"
import { hashTree } from "../utils/hash"
import type { Agent, SkillInfo } from "./types"

export class AgentRegistry {
  constructor(private agents: Record<string, Agent>) {}

  async detectAgents(): Promise<Record<string, Agent>> {
    const results: Record<string, Agent> = {}

    for (const [id, agent] of Object.entries(this.agents)) {
      const globalPath = expandPath(agent.globalPath)
      const parentDir = dirname(globalPath)

      let detected = false
      try {
        await access(parentDir)
        detected = true
      } catch {
        detected = false
      }

      results[id] = { ...agent, detected }
    }

    return results
  }

  async listSkills(agentId: string): Promise<SkillInfo[]> {
    const agent = this.agents[agentId]
    if (!agent) throw new Error(`Unknown agent: ${agentId}`)

    const skillsPath = expandPath(agent.globalPath)
    const skills: SkillInfo[] = []

    try {
      const entries = await readdir(skillsPath, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const skillPath = join(skillsPath, entry.name)
        const skillMdPath = join(skillPath, "SKILL.md")

        try {
          await access(skillMdPath)
        } catch {
          continue // Skip directories without SKILL.md
        }

        const { treeHash, files } = await hashTree(skillPath)

        skills.push({
          name: entry.name,
          treeHash,
          files,
          origin: agentId,
          lastSeen: new Date(),
          agents: [agentId],
        })
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err
      }
    }

    return skills
  }

  async copySkill(
    skillName: string,
    fromAgent: string,
    toAgent: string
  ): Promise<void> {
    const from = this.agents[fromAgent]
    const to = this.agents[toAgent]

    if (!from || !to) {
      throw new Error(`Unknown agent: ${fromAgent} or ${toAgent}`)
    }

    const sourcePath = join(expandPath(from.globalPath), skillName)
    const destPath = join(expandPath(to.globalPath), skillName)

    await mkdir(dirname(destPath), { recursive: true })
    await cp(sourcePath, destPath, { recursive: true })
  }

  async deleteSkill(skillName: string, agentId: string): Promise<void> {
    const agent = this.agents[agentId]
    if (!agent) throw new Error(`Unknown agent: ${agentId}`)

    const skillPath = join(expandPath(agent.globalPath), skillName)
    await rm(skillPath, { recursive: true })
  }

  getSkillPath(skillName: string, agentId: string): string {
    const agent = this.agents[agentId]
    if (!agent) throw new Error(`Unknown agent: ${agentId}`)
    return join(expandPath(agent.globalPath), skillName)
  }
}
