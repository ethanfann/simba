import { parse, stringify } from "smol-toml"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import type { Config, Agent } from "./types"

interface AgentDefinition {
  id: string
  name: string
  shortName: string
  globalPath: string
  projectPath: string
  detectPath?: string
  detectPaths?: string[]
  alwaysAvailable?: boolean
}

const AGENT_DEFINITIONS: AgentDefinition[] = [
  {
    id: "universal",
    name: "Universal (XDG)",
    shortName: "Universal",
    globalPath: "~/.config/agents/skills",
    projectPath: ".agents/skills",
    alwaysAvailable: true,
  },
  {
    id: "claude",
    name: "Claude Code",
    shortName: "Claude",
    globalPath: "~/.claude/skills",
    projectPath: ".claude/skills",
    detectPath: "~/.claude",
  },
  {
    id: "pi",
    name: "pi",
    shortName: "pi",
    globalPath: "~/.pi/agent/skills",
    projectPath: ".pi/skills",
    detectPath: "~/.pi/agent",
  },
]

const DEFAULT_AGENTS: Record<string, Agent> = Object.fromEntries(
  AGENT_DEFINITIONS.map((definition) => [
    definition.id,
    {
      id: definition.id,
      name: definition.name,
      shortName: definition.shortName,
      globalPath: definition.globalPath,
      projectPath: definition.projectPath,
      detectPath: definition.detectPath,
      detectPaths: definition.detectPaths,
      alwaysAvailable: definition.alwaysAvailable,
      detected: false,
    },
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
    const mergedAgents = { ...defaults.agents }

    for (const [id, agent] of Object.entries(parsed.agents ?? {})) {
      const def = defaults.agents[id]
      if (!def) continue

      mergedAgents[id] = {
        ...def,
        ...agent,
        id,
        name: def.name,
        shortName: def.shortName,
        globalPath: def.globalPath,
        projectPath: def.projectPath,
        detectPath: def.detectPath,
        detectPaths: def.detectPaths,
        alwaysAvailable: def.alwaysAvailable,
      }
    }

    return {
      agents: mergedAgents,
      sync: { ...defaults.sync, ...parsed.sync },
      snapshots: { ...defaults.snapshots, ...parsed.snapshots },
      skills: parsed.skills ?? {},
    }
  }
}
