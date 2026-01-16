import { mkdir, cp, readdir, writeFile, readFile, rm } from "node:fs/promises"
import { join, basename, dirname } from "node:path"

export interface SnapshotManifest {
  id: string
  reason: string
  created: string
  skills: string[]
}

export class SnapshotManager {
  constructor(
    private snapshotsDir: string,
    private maxCount: number
  ) {}

  async createSnapshot(skillPaths: string[], reason: string): Promise<string> {
    const id = this.generateId()
    const snapshotDir = join(this.snapshotsDir, id)
    const skillsBackupDir = join(snapshotDir, "skills")

    await mkdir(skillsBackupDir, { recursive: true })

    const skillNames: string[] = []

    for (const skillPath of skillPaths) {
      const skillName = basename(skillPath)
      skillNames.push(skillName)
      await cp(skillPath, join(skillsBackupDir, skillName), { recursive: true })
    }

    const manifest: SnapshotManifest = {
      id,
      reason,
      created: new Date().toISOString(),
      skills: skillNames,
    }

    await writeFile(
      join(snapshotDir, "manifest.json"),
      JSON.stringify(manifest, null, 2)
    )

    await this.pruneOldSnapshots()

    return id
  }

  async listSnapshots(): Promise<SnapshotManifest[]> {
    try {
      const entries = await readdir(this.snapshotsDir, { withFileTypes: true })
      const manifests: SnapshotManifest[] = []

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        try {
          const manifestPath = join(this.snapshotsDir, entry.name, "manifest.json")
          const content = await readFile(manifestPath, "utf-8")
          manifests.push(JSON.parse(content))
        } catch {
          continue
        }
      }

      return manifests.sort(
        (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()
      )
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return []
      }
      throw err
    }
  }

  async restore(snapshotId: string, targetDir: string): Promise<void> {
    const snapshotDir = join(this.snapshotsDir, snapshotId)
    const skillsBackupDir = join(snapshotDir, "skills")
    const manifestPath = join(snapshotDir, "manifest.json")

    const manifest: SnapshotManifest = JSON.parse(
      await readFile(manifestPath, "utf-8")
    )

    for (const skillName of manifest.skills) {
      const sourcePath = join(skillsBackupDir, skillName)
      const targetPath = join(targetDir, skillName)

      // Ensure parent exists, remove old version if present
      await mkdir(dirname(targetPath), { recursive: true })
      try {
        await rm(targetPath, { recursive: true })
      } catch {
        // Ignore if doesn't exist
      }

      await cp(sourcePath, targetPath, { recursive: true })
    }
  }

  async getLatestSnapshot(): Promise<SnapshotManifest | null> {
    const list = await this.listSnapshots()
    return list[0] ?? null
  }

  private generateId(): string {
    const now = new Date()
    // Include milliseconds for uniqueness when creating multiple snapshots quickly
    return now.toISOString().replace(/[:.]/g, "-").slice(0, 23)
  }

  private async pruneOldSnapshots(): Promise<void> {
    const list = await this.listSnapshots()

    if (list.length <= this.maxCount) return

    const toDelete = list.slice(this.maxCount)
    for (const snapshot of toDelete) {
      await rm(join(this.snapshotsDir, snapshot.id), { recursive: true })
    }
  }
}
