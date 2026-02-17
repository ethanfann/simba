import { parse, stringify } from "smol-toml";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Config, Agent } from "./types";

// Add new agents here: [id, name, shortName, globalPath, projectPath, universal]
const AGENT_DEFINITIONS: [string, string, string, string, string, boolean][] = [
    // Universal agents (use .agents/skills as project path)
    ["amp", "Amp", "Amp", "~/.config/agents/skills", ".agents/skills", true],
    ["codex", "Codex", "Codex", "~/.codex/skills", ".agents/skills", true],
    ["copilot", "GitHub Copilot", "Copilot", "~/.copilot/skills", ".agents/skills", true],
    ["gemini", "Gemini CLI", "Gemini", "~/.gemini/skills", ".agents/skills", true],
    ["opencode", "OpenCode", "OpenCode", "~/.config/opencode/skills", ".agents/skills", true],
    ["kimi", "Kimi Code CLI", "Kimi", "~/.config/agents/skills", ".agents/skills", true],
    ["replit", "Replit", "Replit", "~/.config/agents/skills", ".agents/skills", true],
    // Custom agents
    ["claude", "Claude Code", "Claude", "~/.claude/skills", ".claude/skills", false],
    ["cursor", "Cursor", "Cursor", "~/.cursor/skills", ".cursor/skills", false],
    ["windsurf", "Windsurf", "Windsurf", "~/.codeium/windsurf/skills", ".windsurf/skills", false],
    ["goose", "Goose", "Goose", "~/.config/goose/skills", ".goose/skills", false],
    ["kilo", "Kilo Code", "Kilo", "~/.kilocode/skills", ".kilocode/skills", false],
    ["roo", "Roo Code", "Roo", "~/.roo/skills", ".roo/skills", false],
    ["antigravity", "Antigravity", "Antigrav", "~/.gemini/antigravity/skills", ".agent/skills", false],
    ["droid", "Droid", "Droid", "~/.factory/skills", ".factory/skills", false],
    ["pi", "pi", "pi", "~/.pi/agent/skills", ".pi/skills", false],
    ["openclaw", "OpenClaw", "OpenClaw", "~/.openclaw/skills", "skills", false],
];

const DEFAULT_AGENTS: Record<string, Agent> = Object.fromEntries(
    AGENT_DEFINITIONS.map(([id, name, shortName, globalPath, projectPath, universal]) => [
        id,
        { id, name, shortName, globalPath, projectPath, universal, detected: false },
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
