import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { RegistryStore } from "../../src/core/registry-store"

const testDir = join(tmpdir(), "simba-registry-test-" + Date.now())
const registryPath = join(testDir, "registry.json")

describe("RegistryStore", () => {
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("load returns empty registry when file missing", async () => {
    const store = new RegistryStore(registryPath)
    const registry = await store.load()
    expect(registry.version).toBe(1)
    expect(registry.skills).toEqual({})
  })

  test("save and load round-trips registry", async () => {
    const store = new RegistryStore(registryPath)
    const registry = {
      version: 1 as const,
      skills: {
        "test-skill": {
          name: "test-skill",
          source: "adopted:claude",
          installedAt: "2026-01-16T00:00:00Z",
          assignments: { claude: { type: "directory" as const } }
        }
      }
    }
    await store.save(registry)
    const loaded = await store.load()
    expect(loaded).toEqual(registry)
  })
})
