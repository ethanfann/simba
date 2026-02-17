import { defineCommand } from "citty"
import * as p from "@clack/prompts"
import simpleGit from "simple-git"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { access, mkdir, rm } from "node:fs/promises"
import { RegistryStore } from "../core/registry-store"
import { SkillsStore } from "../core/skills-store"
import { getRegistryPath, getSkillsDir } from "../utils/paths"
import { discoverSkills } from "./install"
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

/** Build a git clone URL from repo string and protocol */
export function resolveGitUrl(repo: string, protocol: InstallSource["protocol"], sshOverride: boolean): string {
  const effectiveProtocol = sshOverride ? "ssh" : protocol
  // Already a full URL
  if (repo.includes("://") || repo.startsWith("git@")) {
    return repo
  }
  // GitHub shorthand (user/repo)
  if (effectiveProtocol === "ssh") {
    return `git@github.com:${repo}.git`
  }
  return `https://github.com/${repo}`
}

export interface FetchResult {
  name: string
  status: "fetched" | "linked" | "failed" | "not-found" | "skipped"
  message?: string
}

/** Locate a skill within a cloned repo by its skillPath, or discover by name */
async function locateSkillInClone(
  cloneDir: string,
  skillName: string,
  skillPath: string | undefined
): Promise<string | undefined> {
  // If we have an explicit skillPath, resolve it directly
  if (skillPath !== undefined) {
    const resolved = resolve(cloneDir, skillPath)
    try {
      await access(join(resolved, "SKILL.md"))
      return resolved
    } catch {
      return undefined
    }
  }

  // No skillPath — discover skills in clone and find by name
  const discovered = await discoverSkills(cloneDir)
  const match = discovered.find(s => s.name === skillName)
  return match?.path
}

/** Clone each remote repo group, extract skills, copy to central store */
export async function fetchRemoteRepos(
  groups: RepoGroup[],
  skillsStore: SkillsStore,
  options: { ssh: boolean }
): Promise<FetchResult[]> {
  const results: FetchResult[] = []

  for (const group of groups) {
    const url = resolveGitUrl(group.repo, group.protocol, options.ssh)
    const tempDir = join(tmpdir(), `simba-bootstrap-${Date.now()}`)

    try {
      await mkdir(tempDir, { recursive: true })
      const git = simpleGit()
      await git.clone(url, tempDir, ["--depth", "1"])

      for (const { name, skillPath } of group.skills) {
        const skillDir = await locateSkillInClone(tempDir, name, skillPath)
        if (skillDir === undefined) {
          results.push({ name, status: "not-found", message: `not found in ${group.repo}` })
          continue
        }

        await skillsStore.addSkill(name, skillDir)
        results.push({ name, status: "fetched" })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      for (const { name } of group.skills) {
        results.push({ name, status: "failed", message: `clone failed: ${message}` })
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  }

  return results
}

/** Verify local repo paths exist and symlink skills into central store */
export async function fetchLocalRepos(
  groups: RepoGroup[],
  skillsStore: SkillsStore
): Promise<FetchResult[]> {
  const results: FetchResult[] = []

  for (const group of groups) {
    const repoPath = group.repo

    try {
      await access(repoPath)
    } catch {
      for (const { name } of group.skills) {
        results.push({ name, status: "skipped", message: `local path not found: ${repoPath}` })
      }
      continue
    }

    for (const { name, skillPath } of group.skills) {
      const skillDir = await locateSkillInClone(repoPath, name, skillPath)
      if (skillDir === undefined) {
        results.push({ name, status: "not-found", message: `not found in ${repoPath}` })
        continue
      }

      await skillsStore.linkSkill(name, skillDir)
      results.push({ name, status: "linked" })
    }
  }

  return results
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

    const skillsStore = new SkillsStore(getSkillsDir(), registryPath)

    const remoteResults = await fetchRemoteRepos(remote, skillsStore, { ssh: args.ssh })
    const localResults = await fetchLocalRepos(local, skillsStore)
    const results = [...remoteResults, ...localResults]

    for (const r of results) {
      p.log.step(`${r.name}: ${r.status}${r.message ? ` — ${r.message}` : ""}`)
    }

    // Subsequent tasks will handle adopted skills, agent symlinks, etc.
    void args
  },
})
