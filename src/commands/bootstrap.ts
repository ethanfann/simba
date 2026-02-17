import { defineCommand } from "citty"
import * as p from "@clack/prompts"
import { RegistryStore } from "../core/registry-store"
import { getRegistryPath } from "../utils/paths"
import type { ManagedSkill } from "../core/types"

/** Skills with installSource can be re-fetched from their origin */
export interface InstallableSkill {
  name: string
  skill: ManagedSkill
}

/** Skills without installSource were adopted locally and can't be auto-fetched */
export interface AdoptedSkill {
  name: string
  skill: ManagedSkill
}

export interface PartitionedSkills {
  installable: InstallableSkill[]
  adopted: AdoptedSkill[]
}

/** Partition registry skills by whether they have an installSource */
export function partitionSkills(skills: Record<string, ManagedSkill>): PartitionedSkills {
  const installable: InstallableSkill[] = []
  const adopted: AdoptedSkill[] = []

  for (const [name, skill] of Object.entries(skills)) {
    if (skill.installSource) {
      installable.push({ name, skill })
    } else {
      adopted.push({ name, skill })
    }
  }

  return { installable, adopted }
}

export default defineCommand({
  meta: { name: "bootstrap", description: "Restore all skills from registry" },
  args: {
    registryPath: {
      type: "positional",
      description: "Path to registry.json (default: ~/.config/simba/registry.json)",
      required: false,
    },
    backup: {
      type: "string",
      description: "Path to backup archive for restoring adopted skills",
      required: false,
    },
    force: {
      type: "boolean",
      description: "Overwrite existing skills (creates snapshot first)",
      default: false,
    },
    ssh: {
      type: "boolean",
      description: "Use SSH for all remote repos",
      default: false,
    },
    dryRun: {
      type: "boolean",
      alias: "n",
      description: "Preview actions without making changes",
      default: false,
    },
  },
  async run({ args }) {
    p.intro("simba bootstrap")

    const registryPath = args.registryPath || getRegistryPath()
    const registryStore = new RegistryStore(registryPath)
    const registry = await registryStore.load()

    const skillEntries = Object.entries(registry.skills)
    if (skillEntries.length === 0) {
      p.log.info("Registry is empty — nothing to bootstrap.")
      p.outro("Done")
      return
    }

    const { installable, adopted } = partitionSkills(registry.skills)

    p.log.info(
      `Found ${skillEntries.length} skill(s): ${installable.length} installable, ${adopted.length} adopted`
    )

    // Subsequent tasks will handle cloning, copying, symlinks, etc.
    void args
  },
})
