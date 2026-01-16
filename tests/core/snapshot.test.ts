import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { SnapshotManager } from "../../src/core/snapshot"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("SnapshotManager", () => {
  let tempDir: string
  let snapshotsDir: string
  let skillsDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "simba-snapshot-"))
    snapshotsDir = join(tempDir, "snapshots")
    skillsDir = join(tempDir, "skills")

    await mkdir(join(skillsDir, "my-skill"), { recursive: true })
    await writeFile(join(skillsDir, "my-skill/SKILL.md"), "# Original")
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true })
  })

  test("createSnapshot saves skill state", async () => {
    const manager = new SnapshotManager(snapshotsDir, 10)
    const id = await manager.createSnapshot([join(skillsDir, "my-skill")], "test")

    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}$/)

    const snapshotPath = join(snapshotsDir, id, "skills/my-skill/SKILL.md")
    const content = await readFile(snapshotPath, "utf-8")
    expect(content).toBe("# Original")
  })

  test("listSnapshots returns available snapshots", async () => {
    const manager = new SnapshotManager(snapshotsDir, 10)
    await manager.createSnapshot([join(skillsDir, "my-skill")], "test1")
    await manager.createSnapshot([join(skillsDir, "my-skill")], "test2")

    const list = await manager.listSnapshots()
    expect(list).toHaveLength(2)
  })

  test("restore recovers skill from snapshot", async () => {
    const manager = new SnapshotManager(snapshotsDir, 10)
    const id = await manager.createSnapshot([join(skillsDir, "my-skill")], "test")

    // Modify original
    await writeFile(join(skillsDir, "my-skill/SKILL.md"), "# Modified")

    // Restore
    await manager.restore(id, skillsDir)

    const content = await readFile(join(skillsDir, "my-skill/SKILL.md"), "utf-8")
    expect(content).toBe("# Original")
  })
})
