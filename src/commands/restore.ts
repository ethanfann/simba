import { defineCommand } from "citty"
import { ConfigStore } from "../core/config-store"
import { AgentRegistry } from "../core/agent-registry"
import { SnapshotManager } from "../core/snapshot"
import { getConfigPath, getSnapshotsDir, expandPath } from "../utils/paths"
import { selectFromList, selectAgent, inputText } from "../utils/prompts"
import { mkdir, readFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import * as tar from "tar"

export default defineCommand({
  meta: {
    name: "restore",
    description: "Restore skills from backup",
  },
  args: {
    path: {
      type: "positional",
      description: "Backup path (.tar.gz)",
    },
    to: {
      type: "string",
      description: "Restore to specific agent only",
    },
    snapshot: {
      type: "string",
      description: "Restore from snapshot ID instead of backup file",
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

    let snapshotId = args.snapshot
    let backupPath = args.path

    // Interactive mode if no path or snapshot provided
    if (!backupPath && !snapshotId) {
      const mode = await selectFromList("Restore from:", [
        { value: "snapshot", label: "Snapshot", hint: "restore from auto-saved snapshot" },
        { value: "backup", label: "Backup file", hint: "restore from .tar.gz archive" },
      ])

      if (mode === "snapshot") {
        const snapshots = new SnapshotManager(getSnapshotsDir(), config.snapshots.maxCount)
        const list = await snapshots.listSnapshots()

        if (list.length === 0) {
          console.log("No snapshots available.")
          return
        }

        snapshotId = await selectFromList(
          "Select snapshot:",
          list.map((s) => ({
            value: s.id,
            label: s.id,
            hint: `${s.reason} (${s.skills.length} skills)`,
          }))
        )
      } else {
        backupPath = await inputText("Backup file path:", { placeholder: "./backup.tar.gz" })
      }
    }

    // Handle snapshot restore
    if (snapshotId) {
      const snapshots = new SnapshotManager(
        getSnapshotsDir(),
        config.snapshots.maxCount
      )
      const list = await snapshots.listSnapshots()
      const snapshot = list.find((s) => s.id === snapshotId)

      if (!snapshot) {
        console.error(`Snapshot not found: ${snapshotId}`)
        process.exit(1)
      }

      console.log(`\nRestoring from snapshot: ${snapshot.id}`)
      console.log(`Skills: ${snapshot.skills.join(", ")}`)

      if (args.dryRun) {
        console.log("\n(dry run - no changes made)")
        return
      }

      // Restore to all detected agents or specific one
      const targetAgents = args.to
        ? [args.to]
        : Object.entries(config.agents)
            .filter(([_, a]) => a.detected)
            .map(([id]) => id)

      for (const agentId of targetAgents) {
        const agent = config.agents[agentId]
        if (!agent) continue
        await snapshots.restore(snapshotId, expandPath(agent.globalPath))
        console.log(`Restored to ${agent.name}`)
      }

      console.log("\nRestore complete!")
      return
    }

    // Handle backup file restore
    if (!backupPath) {
      console.error("No backup path provided.")
      process.exit(1)
    }

    const tempDir = join(dirname(backupPath), `.simba-restore-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })

    // Extract backup
    await tar.extract({
      file: backupPath,
      cwd: tempDir,
    })

    // Read manifest
    const manifest = JSON.parse(
      await readFile(join(tempDir, "manifest.json"), "utf-8")
    )

    console.log(`\nRestoring from backup: ${backupPath}`)
    console.log(`Created: ${manifest.created}`)
    console.log(`Skills: ${Object.keys(manifest.skills).length}`)

    if (args.dryRun) {
      console.log("\nWould restore:")
      for (const skillName of Object.keys(manifest.skills)) {
        console.log(`  ${skillName}`)
      }
      console.log("\n(dry run - no changes made)")
      await Bun.$`rm -rf ${tempDir}`
      return
    }

    // Determine target agents
    const targetAgents = args.to
      ? [args.to]
      : Object.entries(config.agents)
          .filter(([_, a]) => a.detected)
          .map(([id]) => id)

    // Copy skills to targets
    for (const agentId of targetAgents) {
      const agent = config.agents[agentId]
      if (!agent) continue

      const skillsPath = expandPath(agent.globalPath)
      await mkdir(skillsPath, { recursive: true })

      for (const skillName of Object.keys(manifest.skills)) {
        const sourcePath = join(tempDir, "skills", skillName)
        const destPath = join(skillsPath, skillName)
        await Bun.$`cp -r ${sourcePath} ${destPath}`
      }

      console.log(`Restored to ${agent.name}`)
    }

    // Cleanup temp
    await Bun.$`rm -rf ${tempDir}`

    console.log("\nRestore complete!")
  },
})
