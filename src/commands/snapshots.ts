import { defineCommand } from "citty"
import { ConfigStore } from "../core/config-store"
import { SnapshotManager } from "../core/snapshot"
import { getConfigPath, getSnapshotsDir } from "../utils/paths"

export default defineCommand({
  meta: {
    name: "snapshots",
    description: "List available snapshots",
  },
  async run() {
    const configStore = new ConfigStore(getConfigPath())
    const config = await configStore.load()

    const snapshots = new SnapshotManager(
      getSnapshotsDir(),
      config.snapshots.maxCount
    )

    const list = await snapshots.listSnapshots()

    if (list.length === 0) {
      console.log("No snapshots available.")
      return
    }

    console.log("\nAvailable snapshots:\n")

    for (const snapshot of list) {
      console.log(`  ${snapshot.id}`)
      console.log(`    Reason: ${snapshot.reason}`)
      console.log(`    Skills: ${snapshot.skills.length}`)
      console.log("")
    }

    console.log(`Total: ${list.length} snapshots`)
    console.log(`\nUse 'simba restore --snapshot <id>' to restore`)
  },
})
