import { defineCommand } from "citty"
import { ConfigStore } from "../core/config-store"
import { AgentRegistry } from "../core/agent-registry"
import { SnapshotManager } from "../core/snapshot"
import { getConfigPath, getSnapshotsDir } from "../utils/paths"

export interface MigrateOptions {
  from: string
  to: string
  dryRun: boolean
  configPath: string
  snapshotsDir: string
}

export async function runMigrate(options: MigrateOptions): Promise<void> {
  const configStore = new ConfigStore(options.configPath)
  const config = await configStore.load()

  const fromAgent = config.agents[options.from]
  const toAgent = config.agents[options.to]

  if (!fromAgent) {
    console.error(`Unknown agent: ${options.from}`)
    process.exit(1)
  }
  if (!toAgent) {
    console.error(`Unknown agent: ${options.to}`)
    process.exit(1)
  }
  if (!fromAgent.detected) {
    console.error(`Agent not detected: ${options.from}`)
    process.exit(1)
  }
  if (!toAgent.detected) {
    console.error(`Agent not detected: ${options.to}`)
    process.exit(1)
  }

  const registry = new AgentRegistry(config.agents)
  const snapshots = new SnapshotManager(
    options.snapshotsDir,
    config.snapshots.maxCount
  )

  const sourceSkills = await registry.listSkills(options.from)
  const targetSkills = await registry.listSkills(options.to)
  const targetNames = new Set(targetSkills.map((s) => s.name))

  const toCopy = sourceSkills.filter((s) => !targetNames.has(s.name))
  const skipped = sourceSkills.filter((s) => targetNames.has(s.name))

  console.log(`\nMigrating from ${fromAgent.name} to ${toAgent.name}`)
  console.log(`\nWill copy: ${toCopy.length} skills`)
  for (const skill of toCopy) {
    console.log(`  ${skill.name}`)
  }

  if (skipped.length > 0) {
    console.log(`\nSkipping (already exist): ${skipped.length} skills`)
    for (const skill of skipped) {
      console.log(`  ${skill.name}`)
    }
  }

  if (options.dryRun) {
    console.log("\n(dry run - no changes made)")
    return
  }

  if (toCopy.length === 0) {
    console.log("\nNothing to migrate.")
    return
  }

  // Create snapshot
  if (config.snapshots.autoSnapshot) {
    const skillPaths = toCopy.map((s) =>
      registry.getSkillPath(s.name, options.from)
    )
    await snapshots.createSnapshot(skillPaths, `migrate-${options.from}-${options.to}`)
    console.log("\nSnapshot created.")
  }

  // Copy skills
  for (const skill of toCopy) {
    await registry.copySkill(skill.name, options.from, options.to)
    console.log(`Copied: ${skill.name}`)
  }

  console.log("\nMigration complete!")
}

export default defineCommand({
  meta: {
    name: "migrate",
    description: "Copy all skills from one agent to another",
  },
  args: {
    from: {
      type: "positional",
      description: "Source agent",
      required: true,
    },
    to: {
      type: "positional",
      description: "Target agent",
      required: true,
    },
    dryRun: {
      type: "boolean",
      alias: "n",
      description: "Preview changes without applying",
      default: false,
    },
  },
  async run({ args }) {
    await runMigrate({
      from: args.from,
      to: args.to,
      dryRun: args.dryRun,
      configPath: getConfigPath(),
      snapshotsDir: getSnapshotsDir(),
    })
  },
})
