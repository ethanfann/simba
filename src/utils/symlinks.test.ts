import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, writeFile, readlink, lstat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createSymlink, isSymlink, removeSymlink, getSymlinkTarget } from "./symlinks"

const testDir = join(tmpdir(), "simba-symlink-test-" + Date.now())

describe("symlinks", () => {
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("createSymlink creates directory symlink", async () => {
    const source = join(testDir, "source")
    const target = join(testDir, "target")
    await mkdir(source)
    await writeFile(join(source, "file.txt"), "test")

    await createSymlink(source, target)

    const stat = await lstat(target)
    expect(stat.isSymbolicLink()).toBe(true)
    expect(await readlink(target)).toBe(source)
  })

  test("isSymlink returns true for symlinks", async () => {
    const source = join(testDir, "source")
    const target = join(testDir, "target")
    await mkdir(source)
    await createSymlink(source, target)

    expect(await isSymlink(target)).toBe(true)
  })

  test("isSymlink returns false for regular files", async () => {
    const file = join(testDir, "file.txt")
    await writeFile(file, "test")

    expect(await isSymlink(file)).toBe(false)
  })

  test("removeSymlink removes symlink", async () => {
    const source = join(testDir, "source")
    const target = join(testDir, "target")
    await mkdir(source)
    await createSymlink(source, target)

    await removeSymlink(target)

    expect(await isSymlink(target)).toBe(false)
  })

  test("getSymlinkTarget returns target path", async () => {
    const source = join(testDir, "source")
    const target = join(testDir, "target")
    await mkdir(source)
    await createSymlink(source, target)

    expect(await getSymlinkTarget(target)).toBe(source)
  })
})
