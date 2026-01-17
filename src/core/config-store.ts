import { parse, stringify } from "smol-toml"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import type { Config, Agent } from "./types"

// Add new agents here: [id, name, globalPath, projectPath]
const AGENT_DEFINITIONS: [string, string, string, string][] = [
  ["claude", "Claude Code", "~/.claude/skills", ".claude/skills"],
  ["cursor", "Cursor", "~/.cursor/skills", ".cursor/skills"],
  ["codex", "Codex", "~/.codex/skills", ".codex/skills"],
  ["copilot", "GitHub Copilot", "~/.copilot/skills", ".github/skills"],
  ["gemini", "Gemini CLI", "~/.gemini/skills", ".gemini/skills"],
  ["windsurf", "Windsurf", "~/.codeium/windsurf/skills", ".windsurf/skills"],
  ["amp", "Amp", "~/.config/agents/skills", ".agents/skills"],
  ["goose", "Goose", "~/.config/goose/skills", ".goose/skills"],
  ["opencode", "OpenCode", "~/.config/opencode/skill", ".opencode/skill"],
  ["kilo", "Kilo Code", "~/.kilocode/skills", ".kilocode/skills"],
  ["roo", "Roo Code", "~/.roo/skills", ".roo/skills"],
  ["antigravity", "Antigravity", "~/.gemini/antigravity/skills", ".agent/skills"],
  ["clawdbot", "Clawdbot", "~/.clawdbot/skills", "skills"],
  ["droid", "Droid", "~/.factory/skills", ".factory/skills"],
]

const DEFAULT_AGENTS: Record<string, Agent> = Object.fromEntries(
  AGENT_DEFINITIONS.map(([id, name, globalPath, projectPath]) => [
    id,
    { id, name, globalPath, projectPath, detected: false },
  ])
)

function createDefaultConfig(): Config {
  return {
    agents: { ...DEFAULT_AGENTS },
    sync: {
      strategy: "union",
      sourceAgent: "",
    },
    snapshots: {
      maxCount: 10,
      autoSnapshot: true,
    },
    skills: {},
  }
}

export class ConfigStore {
  constructor(private configPath: string) {}

  async load(): Promise<Config> {
    try {
      const content = await readFile(this.configPath, "utf-8")
      const parsed = parse(content) as unknown as Config
      return this.mergeWithDefaults(parsed)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return createDefaultConfig()
      }
      throw err
    }
  }

  async save(config: Config): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true })
    const toml = stringify(config as unknown as Record<string, unknown>)
    await writeFile(this.configPath, toml)
  }

  private mergeWithDefaults(parsed: Partial<Config>): Config {
    const defaults = createDefaultConfig()
    return {
      agents: { ...defaults.agents, ...parsed.agents },
      sync: { ...defaults.sync, ...parsed.sync },
      snapshots: { ...defaults.snapshots, ...parsed.snapshots },
      skills: parsed.skills ?? {},
    }
  }
}
