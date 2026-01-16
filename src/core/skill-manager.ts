import type { Agent, SkillMatrix, SkillStatus } from "./types"
import type { AgentRegistry } from "./agent-registry"

export class SkillManager {
  constructor(
    private registry: AgentRegistry,
    private agents: Record<string, Agent>
  ) {}

  async buildMatrix(): Promise<SkillMatrix[]> {
    const detectedAgents = Object.entries(this.agents).filter(
      ([_, agent]) => agent.detected
    )

    // Collect all skills from all agents
    const skillMap = new Map<
      string,
      Map<string, { present: boolean; hash: string | null }>
    >()

    for (const [agentId] of detectedAgents) {
      const skills = await this.registry.listSkills(agentId)

      for (const skill of skills) {
        if (!skillMap.has(skill.name)) {
          skillMap.set(skill.name, new Map())
        }
        skillMap.get(skill.name)!.set(agentId, {
          present: true,
          hash: skill.treeHash,
        })
      }
    }

    // Build matrix with status
    const matrix: SkillMatrix[] = []

    for (const [skillName, agentHashes] of skillMap) {
      const agents: Record<string, { present: boolean; hash: string | null }> =
        {}

      // Initialize all agents as not present
      for (const [agentId] of detectedAgents) {
        agents[agentId] = agentHashes.get(agentId) ?? {
          present: false,
          hash: null,
        }
      }

      const status = this.computeStatus(agentHashes)

      matrix.push({ skillName, agents, status })
    }

    return matrix.sort((a, b) => a.skillName.localeCompare(b.skillName))
  }

  private computeStatus(
    agentHashes: Map<string, { present: boolean; hash: string | null }>
  ): SkillStatus {
    const presentAgents = Array.from(agentHashes.entries()).filter(
      ([_, v]) => v.present
    )

    if (presentAgents.length === 0) {
      return "missing"
    }

    if (presentAgents.length === 1) {
      return "unique"
    }

    const hashes = new Set(presentAgents.map(([_, v]) => v.hash))
    return hashes.size === 1 ? "synced" : "conflict"
  }

  async syncUnique(skillName: string, sourceAgent: string): Promise<string[]> {
    const targetAgents = Object.entries(this.agents)
      .filter(([id, agent]) => agent.detected && id !== sourceAgent)
      .map(([id]) => id)

    for (const targetAgent of targetAgents) {
      await this.registry.copySkill(skillName, sourceAgent, targetAgent)
    }

    return targetAgents
  }

  async resolveConflict(
    skillName: string,
    winnerAgent: string,
    loserAgents: string[]
  ): Promise<void> {
    for (const loserAgent of loserAgents) {
      await this.registry.deleteSkill(skillName, loserAgent)
      await this.registry.copySkill(skillName, winnerAgent, loserAgent)
    }
  }
}
