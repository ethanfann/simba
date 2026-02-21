import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
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

  test("load migrates clawdbot assignments to openclaw", async () => {
    const legacyRegistry = {
      version: 1,
      skills: {
        "legacy-skill": {
          name: "legacy-skill",
          source: "adopted:clawdbot",
          installedAt: "2026-01-16T00:00:00Z",
          assignments: {
            clawdbot: { type: "directory" },
          }
        }
      }
    }

    await writeFile(registryPath, JSON.stringify(legacyRegistry, null, 2))

    const store = new RegistryStore(registryPath)
    const loaded = await store.load()

    expect(loaded.skills["legacy-skill"].assignments.clawdbot).toBeUndefined()
    expect(loaded.skills["legacy-skill"].assignments.openclaw).toEqual({ type: "directory" })
  })

  test("load preserves explicit openclaw assignment when legacy key also exists", async () => {
    const mixedRegistry = {
      version: 1,
      skills: {
        "legacy-skill": {
          name: "legacy-skill",
          source: "adopted:clawdbot",
          installedAt: "2026-01-16T00:00:00Z",
          assignments: {
            clawdbot: { type: "directory" },
            openclaw: { type: "file", target: "rule.mdc" },
          }
        }
      }
    }

    await writeFile(registryPath, JSON.stringify(mixedRegistry, null, 2))

    const store = new RegistryStore(registryPath)
    const loaded = await store.load()

    expect(loaded.skills["legacy-skill"].assignments.openclaw).toEqual({ type: "file", target: "rule.mdc" })
    expect(loaded.skills["legacy-skill"].assignments.clawdbot).toBeUndefined()
  })
})
