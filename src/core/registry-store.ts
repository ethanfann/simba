import { readFile, writeFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import type { Registry } from "./types"

const ASSIGNMENT_RENAMES: Record<string, string> = {
  clawdbot: "openclaw",
}

function createEmptyRegistry(): Registry {
  return { version: 1, skills: {} }
}

function migrateAssignmentAgentIds(registry: Registry): Registry {
  let changed = false
  const migratedSkills: Registry["skills"] = {}

  for (const [skillName, skill] of Object.entries(registry.skills)) {
    const hasOpenClaw = Object.prototype.hasOwnProperty.call(skill.assignments, "openclaw")
    let skillChanged = false
    const migratedAssignments: typeof skill.assignments = {}

    for (const [agentId, assignment] of Object.entries(skill.assignments)) {
      const newAgentId = ASSIGNMENT_RENAMES[agentId] ?? agentId

      if (newAgentId !== agentId) {
        skillChanged = true
      }

      // If both old and new keys exist, keep explicit new key.
      if (newAgentId === "openclaw" && hasOpenClaw && agentId !== "openclaw") {
        continue
      }

      migratedAssignments[newAgentId] = assignment
    }

    if (skillChanged) {
      changed = true
      migratedSkills[skillName] = { ...skill, assignments: migratedAssignments }
    } else {
      migratedSkills[skillName] = skill
    }
  }

  if (!changed) return registry
  return { ...registry, skills: migratedSkills }
}

export class RegistryStore {
  constructor(private registryPath: string) {}

  async load(): Promise<Registry> {
    try {
      const content = await readFile(this.registryPath, "utf-8")
      const parsed = JSON.parse(content) as Registry
      return migrateAssignmentAgentIds(parsed)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return createEmptyRegistry()
      }
      throw err
    }
  }

  async save(registry: Registry): Promise<void> {
    await mkdir(dirname(this.registryPath), { recursive: true })
    await writeFile(this.registryPath, JSON.stringify(registry, null, 2))
  }
}
