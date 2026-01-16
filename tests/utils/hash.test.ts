import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { hashFile, hashTree } from "../../src/utils/hash"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("hash", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "simba-hash-"))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true })
  })

  test("hashFile produces consistent SHA-256 hash", async () => {
    const filePath = join(tempDir, "test.txt")
    await writeFile(filePath, "hello world")

    const hash1 = await hashFile(filePath)
    const hash2 = await hashFile(filePath)

    expect(hash1).toBe(hash2)
    expect(hash1).toMatch(/^[a-f0-9]{64}$/)
  })

  test("hashTree produces git-style tree hash", async () => {
    const skillDir = join(tempDir, "my-skill")
    await mkdir(skillDir)
    await writeFile(join(skillDir, "SKILL.md"), "# My Skill")
    await mkdir(join(skillDir, "scripts"))
    await writeFile(join(skillDir, "scripts", "run.sh"), "#!/bin/bash")

    const { treeHash, files } = await hashTree(skillDir)

    expect(treeHash).toMatch(/^[a-f0-9]{64}$/)
    expect(files).toHaveLength(2)
    expect(files.map((f) => f.path).sort()).toEqual(["SKILL.md", "scripts/run.sh"])
  })
})
