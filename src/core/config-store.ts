import { parse, stringify } from "smol-toml";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Config, Agent } from "./types";

interface AgentDefinition {
    id: string;
    name: string;
    shortName: string;
    globalPath: string;
    projectPath: string;
    detectPath?: string;
    detectPaths?: string[];
    universal: boolean;
}

const AGENT_DEFINITIONS: AgentDefinition[] = [
    // Universal agents (use .agents/skills as project path)
    {
        id: "amp",
        name: "Amp",
        shortName: "Amp",
        globalPath: "~/.config/agents/skills",
        projectPath: ".agents/skills",
        detectPath: "~/.config/amp",
        universal: true,
    },
    {
        id: "codex",
        name: "Codex",
        shortName: "Codex",
        globalPath: "~/.codex/skills",
        projectPath: ".agents/skills",
        detectPath: "~/.codex",
        universal: true,
    },
    {
        id: "copilot",
        name: "GitHub Copilot",
        shortName: "Copilot",
        globalPath: "~/.copilot/skills",
        projectPath: ".agents/skills",
        detectPath: "~/.copilot",
        universal: true,
    },
    {
        id: "gemini",
        name: "Gemini CLI",
        shortName: "Gemini",
        globalPath: "~/.gemini/skills",
        projectPath: ".agents/skills",
        detectPath: "~/.gemini",
        universal: true,
    },
    {
        id: "opencode",
        name: "OpenCode",
        shortName: "OpenCode",
        globalPath: "~/.config/opencode/skills",
        projectPath: ".agents/skills",
        detectPath: "~/.config/opencode",
        universal: true,
    },
    {
        id: "kimi",
        name: "Kimi Code CLI",
        shortName: "Kimi",
        globalPath: "~/.config/agents/skills",
        projectPath: ".agents/skills",
        detectPath: "~/.kimi",
        universal: true,
    },
    {
        id: "replit",
        name: "Replit",
        shortName: "Replit",
        globalPath: "~/.config/agents/skills",
        projectPath: ".agents/skills",
        detectPath: ".replit",
        universal: true,
    },

    // Custom agents
    {
        id: "claude",
        name: "Claude Code",
        shortName: "Claude",
        globalPath: "~/.claude/skills",
        projectPath: ".claude/skills",
        detectPath: "~/.claude",
        universal: false,
    },
    {
        id: "cursor",
        name: "Cursor",
        shortName: "Cursor",
        globalPath: "~/.cursor/skills",
        projectPath: ".cursor/skills",
        detectPath: "~/.cursor",
        universal: false,
    },
    {
        id: "windsurf",
        name: "Windsurf",
        shortName: "Windsurf",
        globalPath: "~/.codeium/windsurf/skills",
        projectPath: ".windsurf/skills",
        detectPath: "~/.codeium/windsurf",
        universal: false,
    },
    {
        id: "goose",
        name: "Goose",
        shortName: "Goose",
        globalPath: "~/.config/goose/skills",
        projectPath: ".goose/skills",
        detectPath: "~/.config/goose",
        universal: false,
    },
    {
        id: "kilo",
        name: "Kilo Code",
        shortName: "Kilo",
        globalPath: "~/.kilocode/skills",
        projectPath: ".kilocode/skills",
        detectPath: "~/.kilocode",
        universal: false,
    },
    {
        id: "roo",
        name: "Roo Code",
        shortName: "Roo",
        globalPath: "~/.roo/skills",
        projectPath: ".roo/skills",
        detectPath: "~/.roo",
        universal: false,
    },
    {
        id: "antigravity",
        name: "Antigravity",
        shortName: "Antigrav",
        globalPath: "~/.gemini/antigravity/skills",
        projectPath: ".agent/skills",
        detectPath: "~/.gemini/antigravity",
        universal: false,
    },
    {
        id: "droid",
        name: "Droid",
        shortName: "Droid",
        globalPath: "~/.factory/skills",
        projectPath: ".factory/skills",
        detectPath: "~/.factory",
        universal: false,
    },
    {
        id: "pi",
        name: "pi",
        shortName: "pi",
        globalPath: "~/.pi/agent/skills",
        projectPath: ".pi/skills",
        detectPath: "~/.pi/agent",
        universal: false,
    },
    {
        id: "openclaw",
        name: "OpenClaw",
        shortName: "OpenClaw",
        globalPath: "~/.openclaw/skills",
        projectPath: "skills",
        detectPath: "~/.openclaw",
        universal: false,
    },
    {
        id: "augment",
        name: "Augment",
        shortName: "Augment",
        globalPath: "~/.augment/skills",
        projectPath: ".augment/skills",
        detectPath: "~/.augment",
        universal: false,
    },
    {
        id: "cline",
        name: "Cline",
        shortName: "Cline",
        globalPath: "~/.cline/skills",
        projectPath: ".cline/skills",
        detectPath: "~/.cline",
        universal: false,
    },
    {
        id: "codebuddy",
        name: "CodeBuddy",
        shortName: "CodeBuddy",
        globalPath: "~/.codebuddy/skills",
        projectPath: ".codebuddy/skills",
        detectPaths: [".codebuddy", "~/.codebuddy"],
        universal: false,
    },
    {
        id: "commandcode",
        name: "Command Code",
        shortName: "CmdCode",
        globalPath: "~/.commandcode/skills",
        projectPath: ".commandcode/skills",
        detectPath: "~/.commandcode",
        universal: false,
    },
    {
        id: "continue",
        name: "Continue",
        shortName: "Continue",
        globalPath: "~/.continue/skills",
        projectPath: ".continue/skills",
        detectPaths: [".continue", "~/.continue"],
        universal: false,
    },
    {
        id: "cortex",
        name: "Cortex Code",
        shortName: "Cortex",
        globalPath: "~/.snowflake/cortex/skills",
        projectPath: ".cortex/skills",
        detectPath: "~/.snowflake/cortex",
        universal: false,
    },
    {
        id: "crush",
        name: "Crush",
        shortName: "Crush",
        globalPath: "~/.config/crush/skills",
        projectPath: ".crush/skills",
        detectPath: "~/.config/crush",
        universal: false,
    },
    {
        id: "junie",
        name: "Junie",
        shortName: "Junie",
        globalPath: "~/.junie/skills",
        projectPath: ".junie/skills",
        detectPath: "~/.junie",
        universal: false,
    },
    {
        id: "iflow",
        name: "iFlow CLI",
        shortName: "iFlow",
        globalPath: "~/.iflow/skills",
        projectPath: ".iflow/skills",
        detectPath: "~/.iflow",
        universal: false,
    },
    {
        id: "kiro",
        name: "Kiro CLI",
        shortName: "Kiro",
        globalPath: "~/.kiro/skills",
        projectPath: ".kiro/skills",
        detectPath: "~/.kiro",
        universal: false,
    },
    {
        id: "kode",
        name: "Kode",
        shortName: "Kode",
        globalPath: "~/.kode/skills",
        projectPath: ".kode/skills",
        detectPath: "~/.kode",
        universal: false,
    },
    {
        id: "mcpjam",
        name: "MCPJam",
        shortName: "MCPJam",
        globalPath: "~/.mcpjam/skills",
        projectPath: ".mcpjam/skills",
        detectPath: "~/.mcpjam",
        universal: false,
    },
    {
        id: "mistralvibe",
        name: "Mistral Vibe",
        shortName: "Vibe",
        globalPath: "~/.vibe/skills",
        projectPath: ".vibe/skills",
        detectPath: "~/.vibe",
        universal: false,
    },
    {
        id: "mux",
        name: "Mux",
        shortName: "Mux",
        globalPath: "~/.mux/skills",
        projectPath: ".mux/skills",
        detectPath: "~/.mux",
        universal: false,
    },
    {
        id: "openhands",
        name: "OpenHands",
        shortName: "OpenHands",
        globalPath: "~/.openhands/skills",
        projectPath: ".openhands/skills",
        detectPath: "~/.openhands",
        universal: false,
    },
    {
        id: "qoder",
        name: "Qoder",
        shortName: "Qoder",
        globalPath: "~/.qoder/skills",
        projectPath: ".qoder/skills",
        detectPath: "~/.qoder",
        universal: false,
    },
    {
        id: "qwen",
        name: "Qwen Code",
        shortName: "Qwen",
        globalPath: "~/.qwen/skills",
        projectPath: ".qwen/skills",
        detectPath: "~/.qwen",
        universal: false,
    },
    {
        id: "trae",
        name: "Trae",
        shortName: "Trae",
        globalPath: "~/.trae/skills",
        projectPath: ".trae/skills",
        detectPath: "~/.trae",
        universal: false,
    },
    {
        id: "traecn",
        name: "Trae CN",
        shortName: "TraeCN",
        globalPath: "~/.trae-cn/skills",
        projectPath: ".trae/skills",
        detectPath: "~/.trae-cn",
        universal: false,
    },
    {
        id: "zencoder",
        name: "Zencoder",
        shortName: "Zencoder",
        globalPath: "~/.zencoder/skills",
        projectPath: ".zencoder/skills",
        detectPath: "~/.zencoder",
        universal: false,
    },
    {
        id: "neovate",
        name: "Neovate",
        shortName: "Neovate",
        globalPath: "~/.neovate/skills",
        projectPath: ".neovate/skills",
        detectPath: "~/.neovate",
        universal: false,
    },
    {
        id: "pochi",
        name: "Pochi",
        shortName: "Pochi",
        globalPath: "~/.pochi/skills",
        projectPath: ".pochi/skills",
        detectPath: "~/.pochi",
        universal: false,
    },
    {
        id: "adal",
        name: "AdaL",
        shortName: "AdaL",
        globalPath: "~/.adal/skills",
        projectPath: ".adal/skills",
        detectPath: "~/.adal",
        universal: false,
    },
];

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
            universal: definition.universal,
            detected: false,
        },
    ]),
);

// Map old agent IDs to new ones for config migration
const AGENT_RENAMES: Record<string, string> = {
    clawdbot: "openclaw",
};

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
    };
}

export class ConfigStore {
    constructor(private configPath: string) {}

    async load(): Promise<Config> {
        try {
            const content = await readFile(this.configPath, "utf-8");
            const parsed = parse(content) as unknown as Config;
            return this.mergeWithDefaults(parsed);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
                return createDefaultConfig();
            }
            throw err;
        }
    }

    async save(config: Config): Promise<void> {
        await mkdir(dirname(this.configPath), { recursive: true });
        const toml = stringify(config as unknown as Record<string, unknown>);
        await writeFile(this.configPath, toml);
    }

    private mergeWithDefaults(parsed: Partial<Config>): Config {
        const defaults = createDefaultConfig();

        // Merge agents, handling renames and ensuring shortName/universal exist
        const mergedAgents = { ...defaults.agents };
        for (const [id, agent] of Object.entries(parsed.agents ?? {})) {
            const newId = AGENT_RENAMES[id] ?? id;

            // Skip old ID if it was renamed and the new ID already has parsed data
            if (AGENT_RENAMES[id] && parsed.agents?.[newId]) continue;

            const isRenamed = id !== newId;
            const def = defaults.agents[newId];
            mergedAgents[newId] = {
                ...def,
                ...(isRenamed ? { detected: agent.detected } : agent),
                id: newId,
                // Defaults always win for display name and universal flag
                name: def?.name ?? agent.name ?? newId,
                shortName: def?.shortName ?? agent.shortName ?? agent.name?.split(" ")[0] ?? newId,
                detectPath: def?.detectPath ?? agent.detectPath,
                detectPaths: def?.detectPaths ?? agent.detectPaths,
                universal: def?.universal ?? false,
            };
        }

        // Remove stale renamed keys
        for (const oldId of Object.keys(AGENT_RENAMES)) {
            delete mergedAgents[oldId];
        }

        return {
            agents: mergedAgents,
            sync: { ...defaults.sync, ...parsed.sync },
            snapshots: { ...defaults.snapshots, ...parsed.snapshots },
            skills: parsed.skills ?? {},
        };
    }
}
