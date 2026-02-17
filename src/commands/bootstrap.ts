import { defineCommand } from "citty"
import * as p from "@clack/prompts"
import simpleGit from "simple-git"
import * as tar from "tar"
import { tmpdir } from "node:os"
import { join, resolve, dirname } from "node:path"
import { access, mkdir, readFile, rm } from "node:fs/promises"
import { RegistryStore } from "../core/registry-store"
import { SkillsStore } from "../core/skills-store"
import { SnapshotManager } from "../core/snapshot"
import { AgentRegistry } from "../core/agent-registry"
import { ConfigStore } from "../core/config-store"
import { getRegistryPath, getSkillsDir, getSnapshotsDir, getConfigPath, expandPath } from "../utils/paths"
import { discoverSkills } from "./install"
import type { ManagedSkill, InstallSource, SkillAssignment } from "../core/types"

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
  status: "fetched" | "linked" | "failed" | "not-found" | "skipped" | "from-backup" | "exists"
  message?: string
}

/**
 * Check if a skill already exists. Returns an "exists" FetchResult to skip,
 * or undefined to proceed. With force: snapshots existing skill and removes it.
 */
async function checkExisting(
  name: string,
  skillsStore: SkillsStore,
  force: boolean,
  snapshots: SnapshotManager
): Promise<FetchResult | undefined> {
  const exists = await skillsStore.hasSkill(name)
  if (!exists) return undefined

  if (!force) {
    return { name, status: "exists", message: "already exists (use --force to overwrite)" }
  }

  // --force: snapshot then remove
  const skillPath = skillsStore.getSkillPath(name)
  await snapshots.createSnapshot([skillPath], `bootstrap --force: ${name}`)
  await skillsStore.removeSkill(name)
  return undefined
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
  options: { ssh: boolean; force: boolean; snapshots: SnapshotManager }
): Promise<FetchResult[]> {
  const results: FetchResult[] = []

  for (const group of groups) {
    // Pre-check all skills for existence before cloning
    const pending: Array<{ name: string; skillPath: string | undefined }> = []
    for (const skill of group.skills) {
      const existing = await checkExisting(skill.name, skillsStore, options.force, options.snapshots)
      if (existing !== undefined) {
        results.push(existing)
      } else {
        pending.push(skill)
      }
    }

    if (pending.length === 0) continue

    const url = resolveGitUrl(group.repo, group.protocol, options.ssh)
    const tempDir = join(tmpdir(), `simba-bootstrap-${Date.now()}`)

    try {
      await mkdir(tempDir, { recursive: true })
      const git = simpleGit()
      await git.clone(url, tempDir, ["--depth", "1"])

      for (const { name, skillPath } of pending) {
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
      for (const { name } of pending) {
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
  skillsStore: SkillsStore,
  options: { force: boolean; snapshots: SnapshotManager }
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
      const existing = await checkExisting(name, skillsStore, options.force, options.snapshots)
      if (existing !== undefined) {
        results.push(existing)
        continue
      }

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

/** Backup archive manifest matching simba backup output */
interface BackupManifest {
  skills: Record<string, unknown>
}

/** Handle adopted skills: warn by default, restore from backup archive when provided */
export async function handleAdoptedSkills(
  adopted: AdoptedSkill[],
  skillsStore: SkillsStore,
  backupPath: string | undefined,
  options: { force: boolean; snapshots: SnapshotManager }
): Promise<FetchResult[]> {
  if (adopted.length === 0) return []

  // No backup — warn about each adopted skill
  if (backupPath === undefined) {
    return adopted.map(({ name }) => ({
      name,
      status: "skipped" as const,
      message: "adopted skill — no installSource and no --backup provided",
    }))
  }

  // Extract backup to temp dir and read manifest
  const tempDir = join(dirname(backupPath), `.simba-bootstrap-${Date.now()}`)
  try {
    await mkdir(tempDir, { recursive: true })
    await tar.extract({ file: backupPath, cwd: tempDir })

    const manifestRaw = await readFile(join(tempDir, "manifest.json"), "utf-8")
    const manifest: BackupManifest = JSON.parse(manifestRaw) as BackupManifest

    const results: FetchResult[] = []
    for (const { name } of adopted) {
      if (!(name in manifest.skills)) {
        results.push({
          name,
          status: "skipped",
          message: "adopted skill — not found in backup archive",
        })
        continue
      }

      const existing = await checkExisting(name, skillsStore, options.force, options.snapshots)
      if (existing !== undefined) {
        results.push(existing)
        continue
      }

      const sourcePath = join(tempDir, "skills", name)
      try {
        await access(sourcePath)
      } catch {
        results.push({
          name,
          status: "skipped",
          message: "adopted skill — listed in manifest but missing from archive",
        })
        continue
      }

      await skillsStore.addSkill(name, sourcePath)
      results.push({ name, status: "from-backup" })
    }

    return results
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
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

export interface AssignResult {
  skill: string
  agent: string
  status: "assigned" | "skipped"
  message?: string
}

/** Detect agents and create symlinks for each skill's assignments */
export async function assignSkillsToAgents(
  registry: { skills: Record<string, ManagedSkill> },
  skillsStore: SkillsStore,
  fetchedSkills: Set<string>,
  config: { agents: Record<string, { globalPath: string; detected?: boolean }> }
): Promise<AssignResult[]> {
  const agentRegistry = new AgentRegistry(config.agents as Record<string, import("../core/types").Agent>)
  const detected = await agentRegistry.detectAgents()
  const results: AssignResult[] = []

  for (const skillName of fetchedSkills) {
    const skill = registry.skills[skillName]
    if (!skill) continue

    const assignments = skill.assignments
    for (const [agentId, assignment] of Object.entries(assignments)) {
      const agent = detected[agentId]
      if (!agent?.detected) {
        results.push({ skill: skillName, agent: agentId, status: "skipped", message: "agent not detected" })
        continue
      }

      const agentSkillsDir = expandPath(agent.globalPath)
      await skillsStore.assignSkill(skillName, agentSkillsDir, assignment)
      results.push({ skill: skillName, agent: agentId, status: "assigned" })
    }
  }

  return results
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

    // Dry-run: preview all actions without filesystem changes
    if (args.dryRun) {
      if (remote.length > 0) {
        p.log.step("Would clone remote repos:")
        for (const group of remote) {
          const url = resolveGitUrl(group.repo, group.protocol, args.ssh)
          p.log.message(`  ${url}`)
          for (const s of group.skills) {
            p.log.message(`    → ${s.name}${s.skillPath ? ` (${s.skillPath})` : ""}`)
          }
        }
      }

      if (local.length > 0) {
        p.log.step("Would link local repos:")
        for (const group of local) {
          p.log.message(`  ${group.repo}`)
          for (const s of group.skills) {
            p.log.message(`    → ${s.name}${s.skillPath ? ` (${s.skillPath})` : ""}`)
          }
        }
      }

      if (adopted.length > 0) {
        p.log.step(`Would handle ${adopted.length} adopted skill(s):`)
        for (const { name } of adopted) {
          const action = args.backup ? "restore from backup" : "skip (no --backup)"
          p.log.message(`  ${name}: ${action}`)
        }
      }

      // Preview agent assignments
      const configStore = new ConfigStore(getConfigPath())
      const config = await configStore.load()
      const agentRegistry = new AgentRegistry(config.agents as Record<string, import("../core/types").Agent>)
      const detected = await agentRegistry.detectAgents()
      const detectedNames = Object.entries(detected)
        .filter(([, a]) => a.detected)
        .map(([id]) => id)

      if (detectedNames.length > 0) {
        p.log.step(`Would assign to detected agents: ${detectedNames.join(", ")}`)
        const allSkillNames = [...installable.map(s => s.name), ...adopted.map(s => s.name)]
        for (const skillName of allSkillNames) {
          const skill = registry.skills[skillName]
          if (!skill) continue
          for (const [agentId, _assignment] of Object.entries(skill.assignments)) {
            const status = detected[agentId]?.detected ? "symlink" : "skip (not detected)"
            p.log.message(`  ${skillName} → ${agentId}: ${status}`)
          }
        }
      }

      p.outro("Dry run complete — no changes made")
      return
    }

    const skillsStore = new SkillsStore(getSkillsDir(), registryPath)
    const snapshots = new SnapshotManager(getSnapshotsDir(), 10)

    const remoteResults = await fetchRemoteRepos(remote, skillsStore, { ssh: args.ssh, force: args.force, snapshots })
    const localResults = await fetchLocalRepos(local, skillsStore, { force: args.force, snapshots })
    const adoptedResults = await handleAdoptedSkills(adopted, skillsStore, args.backup, { force: args.force, snapshots })
    const results = [...remoteResults, ...localResults, ...adoptedResults]

    // Agent assignment: symlink skills to detected agents
    const successStatuses = new Set<FetchResult["status"]>(["fetched", "linked", "from-backup", "exists"])
    const fetchedSkills = new Set(
      results.filter(r => successStatuses.has(r.status)).map(r => r.name)
    )

    let assignResults: AssignResult[] = []
    if (fetchedSkills.size > 0) {
      const configStore = new ConfigStore(getConfigPath())
      const config = await configStore.load()
      assignResults = await assignSkillsToAgents(registry, skillsStore, fetchedSkills, config)
    }

    // --- Summary output ---
    p.log.step("Summary")

    // Per-skill status
    for (const r of results) {
      const detail = r.message ? ` — ${r.message}` : ""
      switch (r.status) {
        case "fetched":
        case "linked":
        case "from-backup":
          p.log.success(`${r.name}: ${r.status}${detail}`)
          break
        case "exists":
        case "skipped":
        case "not-found":
          p.log.warn(`${r.name}: ${r.status}${detail}`)
          break
        case "failed":
          p.log.error(`${r.name}: ${r.status}${detail}`)
          break
      }
    }

    // Agent assignment counts per detected agent
    if (assignResults.length > 0) {
      const perAgent = new Map<string, { assigned: number; skipped: number }>()
      const skippedAgents = new Set<string>()

      for (const r of assignResults) {
        if (r.status === "skipped") {
          skippedAgents.add(r.agent)
          continue
        }
        const counts = perAgent.get(r.agent) ?? { assigned: 0, skipped: 0 }
        counts.assigned++
        perAgent.set(r.agent, counts)
      }

      if (perAgent.size > 0) {
        const agentSummaries = [...perAgent.entries()]
          .map(([agent, counts]) => `${agent}: ${counts.assigned} skill(s)`)
          .join(", ")
        p.log.success(`Agent assignments — ${agentSummaries}`)
      }

      if (skippedAgents.size > 0) {
        p.log.warn(`Skipped agents (not detected): ${[...skippedAgents].join(", ")}`)
      }
    }

    // Totals
    const counts = { fetched: 0, linked: 0, restored: 0, exists: 0, skipped: 0, failed: 0 }
    for (const r of results) {
      switch (r.status) {
        case "fetched": counts.fetched++; break
        case "linked": counts.linked++; break
        case "from-backup": counts.restored++; break
        case "exists": counts.exists++; break
        case "skipped":
        case "not-found": counts.skipped++; break
        case "failed": counts.failed++; break
      }
    }

    const parts: string[] = []
    if (counts.fetched > 0) parts.push(`${counts.fetched} fetched`)
    if (counts.linked > 0) parts.push(`${counts.linked} linked`)
    if (counts.restored > 0) parts.push(`${counts.restored} restored`)
    if (counts.exists > 0) parts.push(`${counts.exists} existing`)
    if (counts.skipped > 0) parts.push(`${counts.skipped} skipped`)
    if (counts.failed > 0) parts.push(`${counts.failed} failed`)

    const hasFailed = counts.failed > 0
    p.outro(`${hasFailed ? "Done (with errors)" : "Done"} — ${parts.join(", ")}`)
    if (hasFailed) process.exit(1)
  },
})
