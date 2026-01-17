import { defineCommand } from "citty"
import { ConfigStore } from "../core/config-store"
import { SnapshotManager } from "../core/snapshot"
import { getConfigPath, getSnapshotsDir, expandPath } from "../utils/paths"

export default defineCommand({
  meta: {
    name: "undo",
    description: "Restore from most recent snapshot",
  },
  args: {
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

    const snapshots = new SnapshotManager(
      getSnapshotsDir(),
      config.snapshots.maxCount
    )

    const latest = await snapshots.getLatestSnapshot()

    if (!latest) {
      console.log("No snapshots available.")
      return
    }

    console.log(`\nLatest snapshot: ${latest.id}`)
    console.log(`Reason: ${latest.reason}`)
    console.log(`Created: ${latest.created}`)
    console.log(`Skills: ${latest.skills.join(", ")}`)

    if (args.dryRun) {
      console.log("\n(dry run - no changes made)")
      return
    }

    // Restore to all detected agents
    const targetAgents = Object.entries(config.agents)
      .filter(([_, a]) => a.detected)
      .map(([id, a]) => ({ id, path: expandPath(a.globalPath) }))

    for (const { id, path } of targetAgents) {
      await snapshots.restore(latest.id, path)
      console.log(`Restored to ${config.agents[id].name}`)
    }

    console.log("\nUndo complete!")
  },
})
