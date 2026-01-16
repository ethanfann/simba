import { parse, stringify } from "smol-toml"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import type { Config, Agent } from "./types"

const DEFAULT_AGENTS: Record<string, Agent> = {
  claude: {
    id: "claude",
    name: "Claude Code",
    globalPath: "~/.claude/skills",
    projectPath: ".claude/skills",
    detected: false,
  },
  cursor: {
    id: "cursor",
    name: "Cursor",
    globalPath: "~/.cursor/skills",
    projectPath: ".cursor/skills",
    detected: false,
  },
  codex: {
    id: "codex",
    name: "Codex",
    globalPath: "~/.codex/skills",
    projectPath: ".codex/skills",
    detected: false,
  },
  opencode: {
    id: "opencode",
    name: "OpenCode",
    globalPath: "~/.config/opencode/skill",
    projectPath: ".opencode/skill",
    detected: false,
  },
  antigravity: {
    id: "antigravity",
    name: "Antigravity",
    globalPath: "~/.gemini/antigravity/skills",
    projectPath: ".agent/skills",
    detected: false,
  },
}

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
