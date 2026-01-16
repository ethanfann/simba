import { defineCommand } from "citty"
import { ConfigStore } from "../core/config-store"
import { AgentRegistry } from "../core/agent-registry"
import { SkillManager } from "../core/skill-manager"
import { SnapshotManager } from "../core/snapshot"
import { getConfigPath, getSnapshotsDir } from "../utils/paths"
import * as readline from "node:readline"

export default defineCommand({
  meta: {
    name: "sync",
    description: "Sync skills across agents (union merge)",
  },
  args: {
    source: {
      type: "string",
      description: "Source of truth agent (one-way sync)",
    },
    dryRun: {
      type: "boolean",
      alias: "n",
      description: "Preview changes without applying",
      default: false,
    },
  },
  async run({ args }) {
    const configStore = new ConfigStore(getConfigPath())
    const config = await configStore.load()

    const registry = new AgentRegistry(config.agents)
    const manager = new SkillManager(registry, config.agents)
    const snapshots = new SnapshotManager(
      getSnapshotsDir(),
      config.snapshots.maxCount
    )

    const matrix = await manager.buildMatrix()

    const unique = matrix.filter((m) => m.status === "unique")
    const conflicts = matrix.filter((m) => m.status === "conflict")

    if (unique.length === 0 && conflicts.length === 0) {
      console.log("All skills are synced!")
      return
    }

    // Show what will happen
    if (unique.length > 0) {
      console.log("\nWill copy:")
      for (const skill of unique) {
        const source = Object.entries(skill.agents).find(([_, v]) => v.present)?.[0]
        const targets = Object.entries(skill.agents)
          .filter(([_, v]) => !v.present)
          .map(([id]) => id)
        console.log(`  ${skill.skillName}  →  ${targets.join(", ")}`)
      }
    }

    if (conflicts.length > 0 && !args.source) {
      console.log("\nConflicts (resolve manually):")
      for (const skill of conflicts) {
        const agents = Object.entries(skill.agents)
          .filter(([_, v]) => v.present)
          .map(([id]) => id)
        console.log(`  ${skill.skillName}: ${agents.join(" ≠ ")}`)
      }
    }

    if (args.dryRun) {
      console.log("\n(dry run - no changes made)")
      return
    }

    // Create snapshot before changes
    if (config.snapshots.autoSnapshot && (unique.length > 0 || conflicts.length > 0)) {
      const skillPaths = [...unique, ...conflicts].flatMap((skill) =>
        Object.entries(skill.agents)
          .filter(([_, v]) => v.present)
          .map(([agentId]) => registry.getSkillPath(skill.skillName, agentId))
      )
      await snapshots.createSnapshot(skillPaths, "pre-sync")
      console.log("\nSnapshot created.")
    }

    // Sync unique skills
    for (const skill of unique) {
      const source = Object.entries(skill.agents).find(([_, v]) => v.present)?.[0]
      if (!source) continue

      const synced = await manager.syncUnique(skill.skillName, source)
      console.log(`Synced ${skill.skillName} to ${synced.join(", ")}`)
    }

    // Handle conflicts with --source flag
    if (args.source && conflicts.length > 0) {
      for (const skill of conflicts) {
        const losers = Object.entries(skill.agents)
          .filter(([id, v]) => v.present && id !== args.source)
          .map(([id]) => id)

        await manager.resolveConflict(skill.skillName, args.source, losers)
        console.log(`Resolved ${skill.skillName} using ${args.source}`)
      }
    }

    console.log("\nSync complete!")
  },
})
