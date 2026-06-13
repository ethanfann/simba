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

    expect(Object.keys(config.agents).sort()).toEqual(["claude", "pi", "universal"])
    expect(config.agents.universal.globalPath).toBe("~/.config/agents/skills")
    expect(config.agents.universal.alwaysAvailable).toBe(true)
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

  test("stores detectPath only for explicitly detected agents", async () => {
    const store = new ConfigStore(configPath)
    const config = await store.load()

    expect(config.agents.universal.detectPath).toBeUndefined()
    expect(config.agents.claude.detectPath).toBe("~/.claude")
    expect(config.agents.pi.detectPath).toBe("~/.pi/agent")
  })

  test("drops unsupported legacy agents from config", async () => {
    const toml = `[agents.cursor]
detected = true

[agents.amp]
detected = true

[agents.claude]
detected = true
`
    await writeFile(configPath, toml)

    const store = new ConfigStore(configPath)
    const config = await store.load()

    expect(config.agents.cursor).toBeUndefined()
    expect(config.agents.amp).toBeUndefined()
    expect(config.agents.claude.detected).toBe(true)
    expect(Object.keys(config.agents).sort()).toEqual(["claude", "pi", "universal"])
  })
})
