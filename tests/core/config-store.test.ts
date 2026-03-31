import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { ConfigStore } from "../../src/core/config-store"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("ConfigStore", () => {
  let tempDir: string
  let configPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "simba-test-"))
    configPath = join(tempDir, "config.toml")
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true })
  })

  test("creates default config if none exists", async () => {
    const store = new ConfigStore(configPath)
    const config = await store.load()

    expect(config.agents.claude).toBeDefined()
    expect(config.agents.claude.globalPath).toBe("~/.claude/skills")
    expect(config.sync.strategy).toBe("union")
  })

  test("saves and loads config", async () => {
    const store = new ConfigStore(configPath)
    const config = await store.load()

    config.agents.claude.detected = true
    await store.save(config)

    const store2 = new ConfigStore(configPath)
    const loaded = await store2.load()

    expect(loaded.agents.claude.detected).toBe(true)
  })

  test("detectPath uses CLI-owned locations for agents", async () => {
    const store = new ConfigStore(configPath)
    const config = await store.load()

    expect(config.agents.amp.detectPath).toBe("~/.config/amp")
    expect(config.agents.kimi.detectPath).toBe("~/.kimi")
    expect(config.agents.replit.detectPath).toBe(".replit")
  })

  test("migrates clawdbot to openclaw", async () => {
    const toml = `[agents.clawdbot]
detected = true
`
    await writeFile(configPath, toml)

    const store = new ConfigStore(configPath)
    const config = await store.load()

    // Old ID should not exist
    expect(config.agents.clawdbot).toBeUndefined()

    // New ID should exist with detection state carried over
    expect(config.agents.openclaw).toBeDefined()
    expect(config.agents.openclaw.detected).toBe(true)
    expect(config.agents.openclaw.id).toBe("openclaw")
  })

  test("migration does not duplicate if new ID already present", async () => {
    const toml = `[agents.clawdbot]
detected = true

[agents.openclaw]
detected = false
`
    await writeFile(configPath, toml)

    const store = new ConfigStore(configPath)
    const config = await store.load()

    expect(config.agents.clawdbot).toBeUndefined()
    // openclaw's own data takes precedence
    expect(config.agents.openclaw.detected).toBe(false)
  })
})
