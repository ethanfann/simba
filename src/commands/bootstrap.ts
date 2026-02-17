import { defineCommand } from "citty"
import * as p from "@clack/prompts"
import { RegistryStore } from "../core/registry-store"
import { getRegistryPath } from "../utils/paths"
import type { ManagedSkill, InstallSource } from "../core/types"

/** Skills with installSource can be re-fetched from their origin */
export interface InstallableSkill {
  name: string
  skill: ManagedSkill & { installSource: InstallSource }
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

/** A group of skills from the same repo, to be cloned once */
export interface RepoGroup {
  repo: string
  protocol: InstallSource["protocol"]
  skills: Array<{ name: string; skillPath: string | undefined }>
}

/** Group installable skills by repo to minimize clones */
export function groupByRepo(skills: InstallableSkill[]): { remote: RepoGroup[]; local: RepoGroup[] } {
  const groups = new Map<string, RepoGroup>()

  for (const { name, skill } of skills) {
    const { repo, protocol, skillPath } = skill.installSource
    const existing = groups.get(repo)
    if (existing) {
      existing.skills.push({ name, skillPath })
    } else {
      groups.set(repo, { repo, protocol, skills: [{ name, skillPath }] })
    }
  }

  const remote: RepoGroup[] = []
  const local: RepoGroup[] = []

  for (const group of groups.values()) {
    if (group.protocol === "local") {
      local.push(group)
    } else {
      remote.push(group)
    }
  }

  return { remote, local }
}

function hasInstallSource(skill: ManagedSkill): skill is ManagedSkill & { installSource: InstallSource } {
  return skill.installSource !== undefined
}

/** Partition registry skills by whether they have an installSource */
export function partitionSkills(skills: Record<string, ManagedSkill>): PartitionedSkills {
  const installable: InstallableSkill[] = []
  const adopted: AdoptedSkill[] = []

  for (const [name, skill] of Object.entries(skills)) {
    if (hasInstallSource(skill)) {
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

    const { remote, local } = groupByRepo(installable)

    if (remote.length > 0) {
      p.log.info(
        `${remote.length} remote repo(s) to clone, ${remote.reduce((n, g) => n + g.skills.length, 0)} skill(s)`
      )
    }
    if (local.length > 0) {
      p.log.info(
        `${local.length} local repo(s) to link, ${local.reduce((n, g) => n + g.skills.length, 0)} skill(s)`
      )
    }

    // Subsequent tasks will handle cloning, copying, symlinks, etc.
    void args
    void remote
    void local
  },
})
