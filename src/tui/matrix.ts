import termkit from "terminal-kit"
import { RegistryStore } from "../core/registry-store"
import { SkillsStore } from "../core/skills-store"
import { ConfigStore } from "../core/config-store"
import { AgentRegistry } from "../core/agent-registry"
import { getRegistryPath, getSkillsDir, getConfigPath, expandPath } from "../utils/paths"
import type { Agent, Registry } from "../core/types"

const term = termkit.terminal

interface MatrixState {
  skills: string[]
  agents: Agent[]
  registry: Registry
  cursorRow: number
  cursorCol: number
}

export async function runMatrixTUI(): Promise<void> {
  const registryStore = new RegistryStore(getRegistryPath())
  const registry = await registryStore.load()

  const configStore = new ConfigStore(getConfigPath())
  const config = await configStore.load()

  const skillsStore = new SkillsStore(getSkillsDir(), getRegistryPath())

  // Run fresh detection instead of relying on stale config
  const agentRegistry = new AgentRegistry(config.agents)
  const detected = await agentRegistry.detectAgents()
  const detectedAgents = Object.values(detected).filter(a => a.detected)
  const skills = Object.keys(registry.skills)

  if (skills.length === 0) {
    term.yellow("\nNo skills managed yet. Run 'simba adopt' first.\n")
    process.exit(0)
  }

  const state: MatrixState = {
    skills,
    agents: detectedAgents,
    registry,
    cursorRow: 0,
    cursorCol: 0,
  }

  term.clear()
  term.hideCursor()

  const render = () => {
    term.moveTo(1, 1)
    term.eraseLine()
    term.bold.cyan("Simba - Skills Manager")
    term("                              ")
    term.dim("[?] Help\n\n")

    // Header row
    term("                     ")
    for (let i = 0; i < state.agents.length; i++) {
      const agent = state.agents[i]
      const name = agent.name.slice(0, 8).padEnd(10)
      if (i === state.cursorCol && state.cursorRow === -1) {
        term.bgWhite.black(name)
      } else {
        term.bold(name)
      }
    }
    term("\n")
    term("─".repeat(21 + state.agents.length * 10) + "\n")

    // Skill rows
    for (let row = 0; row < state.skills.length; row++) {
      const skillName = state.skills[row]
      const skill = state.registry.skills[skillName]
      const displayName = skillName.slice(0, 18).padEnd(20)

      if (row === state.cursorRow) {
        term.bgWhite.black(displayName)
      } else {
        term(displayName)
      }
      term(" ")

      for (let col = 0; col < state.agents.length; col++) {
        const agent = state.agents[col]
        const isAssigned = !!skill.assignments[agent.id]
        const symbol = isAssigned ? "●" : "○"

        const isCursor = row === state.cursorRow && col === state.cursorCol

        if (isCursor) {
          term.bgYellow.black(` ${symbol} `.padEnd(10))
        } else if (isAssigned) {
          term.green(` ${symbol} `.padEnd(10))
        } else {
          term.dim(` ${symbol} `.padEnd(10))
        }
      }
      term("\n")
    }

    term("\n")
    term("─".repeat(21 + state.agents.length * 10) + "\n")
    term.dim("[Space] Toggle  [a] Assign all  [n] None  [Enter] Confirm  [q] Cancel\n")
  }

  const toggle = async () => {
    const skillName = state.skills[state.cursorRow]
    const agent = state.agents[state.cursorCol]
    const skill = state.registry.skills[skillName]

    try {
      if (skill.assignments[agent.id]) {
        await skillsStore.unassignSkill(skillName, expandPath(agent.globalPath))
        delete skill.assignments[agent.id]
      } else {
        await skillsStore.assignSkill(skillName, expandPath(agent.globalPath), { type: "directory" })
        skill.assignments[agent.id] = { type: "directory" }
      }
      await registryStore.save(state.registry)
    } catch (err) {
      term.moveTo(1, state.skills.length + 8)
      term.yellow(`Error: ${(err as Error).message}\n`)
    }
  }

  const assignAll = async () => {
    const skillName = state.skills[state.cursorRow]
    const skill = state.registry.skills[skillName]
    const errors: string[] = []

    for (const agent of state.agents) {
      if (!skill.assignments[agent.id]) {
        try {
          await skillsStore.assignSkill(skillName, expandPath(agent.globalPath), { type: "directory" })
          skill.assignments[agent.id] = { type: "directory" }
        } catch (err) {
          errors.push(`${agent.name}: ${(err as Error).message}`)
        }
      }
    }

    await registryStore.save(state.registry)
    
    if (errors.length > 0) {
      term.moveTo(1, state.skills.length + 8)
      term.yellow(`Errors:\n${errors.join("\n")}\n`)
    }
  }

  const unassignAll = async () => {
    const skillName = state.skills[state.cursorRow]
    const skill = state.registry.skills[skillName]

    for (const agent of state.agents) {
      if (skill.assignments[agent.id]) {
        await skillsStore.unassignSkill(skillName, expandPath(agent.globalPath))
        delete skill.assignments[agent.id]
      }
    }

    await registryStore.save(state.registry)
  }

  render()

  term.grabInput(true)

  term.on("key", async (key: string) => {
    switch (key) {
      case "UP":
        state.cursorRow = Math.max(0, state.cursorRow - 1)
        break
      case "DOWN":
        state.cursorRow = Math.min(state.skills.length - 1, state.cursorRow + 1)
        break
      case "LEFT":
        state.cursorCol = Math.max(0, state.cursorCol - 1)
        break
      case "RIGHT":
        state.cursorCol = Math.min(state.agents.length - 1, state.cursorCol + 1)
        break
      case " ":
        await toggle()
        break
      case "a":
        await assignAll()
        break
      case "n":
        await unassignAll()
        break
      case "ENTER":
        term.clear()
        term.hideCursor(false)
        term.grabInput(false)
        term.green("Changes saved.\n")
        process.exit(0)
      case "q":
      case "CTRL_C":
        term.clear()
        term.hideCursor(false)
        term.grabInput(false)
        term.yellow("Cancelled.\n")
        process.exit(0)
    }

    render()
  })
}
