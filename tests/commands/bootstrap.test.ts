import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, writeFile, readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as tar from "tar"
import { SkillsStore } from "../../src/core/skills-store"
import { SnapshotManager } from "../../src/core/snapshot"
import type { ManagedSkill, InstallSource, Agent } from "../../src/core/types"
import {
  partitionSkills,
  groupByRepo,
  resolveGitUrl,
  fetchLocalRepos,
  handleAdoptedSkills,
  assignSkillsToAgents,
  type InstallableSkill,
  type RepoGroup,
} from "../../src/commands/bootstrap"

const testDir = join(tmpdir(), "simba-bootstrap-test-" + Date.now())
const skillsDir = join(testDir, "skills")
const registryPath = join(testDir, "registry.json")
const snapshotsDir = join(testDir, "snapshots")

function makeManagedSkill(overrides: Partial<ManagedSkill> & { name: string }): ManagedSkill {
  return {
    name: overrides.name,
    source: overrides.source ?? "installed:test/repo",
    installedAt: overrides.installedAt ?? "2026-01-01T00:00:00Z",
    assignments: overrides.assignments ?? {},
    installSource: overrides.installSource,
  }
}

async function createSkillDir(baseDir: string, name: string) {
  const dir = join(baseDir, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "SKILL.md"), `# ${name}`)
  return dir
}

describe("bootstrap", () => {
  beforeEach(async () => {
    await mkdir(skillsDir, { recursive: true })
    await mkdir(snapshotsDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe("partitionSkills", () => {
    test("skills with installSource classified as installable", () => {
      const skills: Record<string, ManagedSkill> = {
        "skill-a": makeManagedSkill({
          name: "skill-a",
          installSource: { repo: "user/repo", protocol: "https" },
        }),
      }

      const { installable, adopted } = partitionSkills(skills)

      expect(installable).toHaveLength(1)
      expect(installable[0].name).toBe("skill-a")
      expect(adopted).toHaveLength(0)
    })

    test("skills without installSource classified as adopted", () => {
      const skills: Record<string, ManagedSkill> = {
        "skill-b": makeManagedSkill({ name: "skill-b", source: "adopted:claude" }),
      }

      const { installable, adopted } = partitionSkills(skills)

      expect(installable).toHaveLength(0)
      expect(adopted).toHaveLength(1)
      expect(adopted[0].name).toBe("skill-b")
    })

    test("mixed skills partitioned correctly", () => {
      const skills: Record<string, ManagedSkill> = {
        installed: makeManagedSkill({
          name: "installed",
          installSource: { repo: "org/repo", protocol: "ssh" },
        }),
        adopted: makeManagedSkill({ name: "adopted", source: "adopted:claude" }),
        "also-installed": makeManagedSkill({
          name: "also-installed",
          installSource: { repo: "org/other", protocol: "https" },
        }),
      }

      const result = partitionSkills(skills)

      expect(result.installable).toHaveLength(2)
      expect(result.adopted).toHaveLength(1)
    })

    test("empty registry produces empty partitions", () => {
      const result = partitionSkills({})

      expect(result.installable).toHaveLength(0)
      expect(result.adopted).toHaveLength(0)
    })
  })

  describe("groupByRepo", () => {
    test("skills from same repo grouped together", () => {
      const skills: InstallableSkill[] = [
        {
          name: "skill-a",
          skill: makeManagedSkill({
            name: "skill-a",
            installSource: { repo: "user/repo", protocol: "https", skillPath: "./a" },
          }) as ManagedSkill & { installSource: InstallSource },
        },
        {
          name: "skill-b",
          skill: makeManagedSkill({
            name: "skill-b",
            installSource: { repo: "user/repo", protocol: "https", skillPath: "./b" },
          }) as ManagedSkill & { installSource: InstallSource },
        },
      ]

      const { remote } = groupByRepo(skills)

      expect(remote).toHaveLength(1)
      expect(remote[0].skills).toHaveLength(2)
      expect(remote[0].skills.map(s => s.name)).toEqual(["skill-a", "skill-b"])
    })

    test("local and remote repos separated", () => {
      const skills: InstallableSkill[] = [
        {
          name: "remote-skill",
          skill: makeManagedSkill({
            name: "remote-skill",
            installSource: { repo: "user/repo", protocol: "https" },
          }) as ManagedSkill & { installSource: InstallSource },
        },
        {
          name: "local-skill",
          skill: makeManagedSkill({
            name: "local-skill",
            installSource: { repo: "/home/user/skills", protocol: "local" },
          }) as ManagedSkill & { installSource: InstallSource },
        },
      ]

      const { remote, local } = groupByRepo(skills)

      expect(remote).toHaveLength(1)
      expect(remote[0].skills[0].name).toBe("remote-skill")
      expect(local).toHaveLength(1)
      expect(local[0].skills[0].name).toBe("local-skill")
    })

    test("different repos produce separate groups", () => {
      const skills: InstallableSkill[] = [
        {
          name: "s1",
          skill: makeManagedSkill({
            name: "s1",
            installSource: { repo: "org/repo-a", protocol: "https" },
          }) as ManagedSkill & { installSource: InstallSource },
        },
        {
          name: "s2",
          skill: makeManagedSkill({
            name: "s2",
            installSource: { repo: "org/repo-b", protocol: "ssh" },
          }) as ManagedSkill & { installSource: InstallSource },
        },
      ]

      const { remote } = groupByRepo(skills)

      expect(remote).toHaveLength(2)
    })
  })

  describe("resolveGitUrl", () => {
    test("GitHub shorthand with https", () => {
      expect(resolveGitUrl("user/repo", "https", false)).toBe("https://github.com/user/repo")
    })

    test("GitHub shorthand with ssh", () => {
      expect(resolveGitUrl("user/repo", "ssh", false)).toBe("git@github.com:user/repo.git")
    })

    test("ssh override converts https to ssh", () => {
      expect(resolveGitUrl("user/repo", "https", true)).toBe("git@github.com:user/repo.git")
    })

    test("full URL passed through unchanged", () => {
      const url = "https://gitlab.com/org/repo.git"
      expect(resolveGitUrl(url, "https", false)).toBe(url)
    })

    test("git@ URL passed through unchanged", () => {
      const url = "git@github.com:user/repo.git"
      expect(resolveGitUrl(url, "https", false)).toBe(url)
    })
  })

  describe("fetchLocalRepos", () => {
    test("existing local path links skill", async () => {
      const localRepo = join(testDir, "local-repo")
      await createSkillDir(localRepo, "my-skill")

      const groups: RepoGroup[] = [
        { repo: localRepo, protocol: "local", skills: [{ name: "my-skill", skillPath: "my-skill" }] },
      ]

      const store = new SkillsStore(skillsDir, registryPath)
      const snapshots = new SnapshotManager(snapshotsDir, 10)
      const results = await fetchLocalRepos(groups, store, { force: false, snapshots })

      expect(results).toHaveLength(1)
      expect(results[0].status).toBe("linked")
      expect(results[0].name).toBe("my-skill")
    })

    test("missing local path skips with warning", async () => {
      const groups: RepoGroup[] = [
        {
          repo: "/nonexistent/path",
          protocol: "local",
          skills: [{ name: "skill-x", skillPath: undefined }],
        },
      ]

      const store = new SkillsStore(skillsDir, registryPath)
      const snapshots = new SnapshotManager(snapshotsDir, 10)
      const results = await fetchLocalRepos(groups, store, { force: false, snapshots })

      expect(results).toHaveLength(1)
      expect(results[0].status).toBe("skipped")
      expect(results[0].message).toContain("/nonexistent/path")
    })

    test("existing skill skipped without --force", async () => {
      const localRepo = join(testDir, "local-repo")
      await createSkillDir(localRepo, "existing-skill")
      // Pre-populate in store
      await createSkillDir(skillsDir, "existing-skill")

      const groups: RepoGroup[] = [
        { repo: localRepo, protocol: "local", skills: [{ name: "existing-skill", skillPath: "existing-skill" }] },
      ]

      const store = new SkillsStore(skillsDir, registryPath)
      const snapshots = new SnapshotManager(snapshotsDir, 10)
      const results = await fetchLocalRepos(groups, store, { force: false, snapshots })

      expect(results).toHaveLength(1)
      expect(results[0].status).toBe("exists")
    })

    test("--force snapshots then overwrites existing skill", async () => {
      const localRepo = join(testDir, "local-repo")
      await createSkillDir(localRepo, "force-skill")
      await createSkillDir(skillsDir, "force-skill")

      const groups: RepoGroup[] = [
        { repo: localRepo, protocol: "local", skills: [{ name: "force-skill", skillPath: "force-skill" }] },
      ]

      const store = new SkillsStore(skillsDir, registryPath)
      const snapshots = new SnapshotManager(snapshotsDir, 10)
      const results = await fetchLocalRepos(groups, store, { force: true, snapshots })

      expect(results).toHaveLength(1)
      expect(results[0].status).toBe("linked")

      // Snapshot was created
      const snapshotEntries = await readdir(snapshotsDir)
      expect(snapshotEntries.length).toBeGreaterThan(0)
    })
  })

  describe("handleAdoptedSkills", () => {
    test("without --backup returns skipped warnings", async () => {
      const adopted = [
        { name: "adopted-a", skill: makeManagedSkill({ name: "adopted-a", source: "adopted:claude" }) },
        { name: "adopted-b", skill: makeManagedSkill({ name: "adopted-b", source: "adopted:windsurf" }) },
      ]

      const store = new SkillsStore(skillsDir, registryPath)
      const snapshots = new SnapshotManager(snapshotsDir, 10)
      const results = await handleAdoptedSkills(adopted, store, undefined, { force: false, snapshots })

      expect(results).toHaveLength(2)
      expect(results[0].status).toBe("skipped")
      expect(results[1].status).toBe("skipped")
      expect(results[0].message).toContain("no installSource")
    })

    test("with --backup restores matching skills", async () => {
      // Create a backup archive
      const backupSrc = join(testDir, "backup-src")
      await createSkillDir(join(backupSrc, "skills"), "restored-skill")
      const manifest = { skills: { "restored-skill": {} } }
      await writeFile(join(backupSrc, "manifest.json"), JSON.stringify(manifest))

      const backupPath = join(testDir, "backup.tar.gz")
      await tar.create({ gzip: true, file: backupPath, cwd: backupSrc }, ["manifest.json", "skills"])

      const adopted = [
        { name: "restored-skill", skill: makeManagedSkill({ name: "restored-skill", source: "adopted:claude" }) },
      ]

      const store = new SkillsStore(skillsDir, registryPath)
      const snapshots = new SnapshotManager(snapshotsDir, 10)
      const results = await handleAdoptedSkills(adopted, store, backupPath, { force: false, snapshots })

      expect(results).toHaveLength(1)
      expect(results[0].status).toBe("from-backup")
      expect(results[0].name).toBe("restored-skill")

      // Skill actually copied to store
      const stored = await readdir(skillsDir)
      expect(stored).toContain("restored-skill")
    })

    test("adopted skill not in backup manifest is skipped", async () => {
      const backupSrc = join(testDir, "backup-src2")
      await mkdir(backupSrc, { recursive: true })
      const manifest = { skills: {} }
      await writeFile(join(backupSrc, "manifest.json"), JSON.stringify(manifest))

      const backupPath = join(testDir, "backup-empty.tar.gz")
      await tar.create({ gzip: true, file: backupPath, cwd: backupSrc }, ["manifest.json"])

      const adopted = [
        { name: "unknown-skill", skill: makeManagedSkill({ name: "unknown-skill", source: "adopted:claude" }) },
      ]

      const store = new SkillsStore(skillsDir, registryPath)
      const snapshots = new SnapshotManager(snapshotsDir, 10)
      const results = await handleAdoptedSkills(adopted, store, backupPath, { force: false, snapshots })

      expect(results).toHaveLength(1)
      expect(results[0].status).toBe("skipped")
      expect(results[0].message).toContain("not found in backup")
    })
  })

  describe("error isolation (fetchLocalRepos)", () => {
    test("failed repo does not abort other repos", async () => {
      const goodRepo = join(testDir, "good-repo")
      await createSkillDir(goodRepo, "good-skill")

      const groups: RepoGroup[] = [
        { repo: "/nonexistent", protocol: "local", skills: [{ name: "bad-skill", skillPath: undefined }] },
        { repo: goodRepo, protocol: "local", skills: [{ name: "good-skill", skillPath: "good-skill" }] },
      ]

      const store = new SkillsStore(skillsDir, registryPath)
      const snapshots = new SnapshotManager(snapshotsDir, 10)
      const results = await fetchLocalRepos(groups, store, { force: false, snapshots })

      expect(results).toHaveLength(2)

      const bad = results.find(r => r.name === "bad-skill")
      const good = results.find(r => r.name === "good-skill")
      expect(bad?.status).toBe("skipped")
      expect(good?.status).toBe("linked")
    })
  })

  describe("assignSkillsToAgents", () => {
    test("skips undetected agents", async () => {
      await createSkillDir(skillsDir, "shared-skill")

      const registry = {
        skills: {
          "shared-skill": makeManagedSkill({
            name: "shared-skill",
            assignments: {
              replit: { type: "directory" },
            },
          }),
        },
      }

      const agents: Record<string, Agent> = {
        amp: {
          id: "amp",
          name: "Amp",
          shortName: "Amp",
          globalPath: join(testDir, ".config/agents/skills"),
          projectPath: ".agents/skills",
          detected: true,
        },
        replit: {
          id: "replit",
          name: "Replit",
          shortName: "Replit",
          globalPath: join(testDir, ".config/agents/skills"),
          projectPath: ".agents/skills",
          detected: false,
        },
      }

      const store = new SkillsStore(skillsDir, registryPath)
      const results = await assignSkillsToAgents(registry, store, new Set(["shared-skill"]), { agents })

      // replit is not detected, so the assignment is skipped
      expect(results).toHaveLength(1)
      expect(results[0].status).toBe("skipped")
    })
  })
})
