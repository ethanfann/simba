import { parse, stringify } from "smol-toml";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Config, Agent } from "./types";

// Add new agents here: [id, name, shortName, globalPath, projectPath]
const AGENT_DEFINITIONS: [string, string, string, string, string][] = [
    ["claude", "Claude Code", "Claude", "~/.claude/skills", ".claude/skills"],
    ["cursor", "Cursor", "Cursor", "~/.cursor/skills", ".cursor/skills"],
    ["codex", "Codex", "Codex", "~/.codex/skills", ".codex/skills"],
    ["copilot", "GitHub Copilot", "Copilot", "~/.copilot/skills", ".github/skills"],
    ["gemini", "Gemini CLI", "Gemini", "~/.gemini/skills", ".gemini/skills"],
    ["windsurf", "Windsurf", "Windsurf", "~/.codeium/windsurf/skills", ".windsurf/skills"],
    ["amp", "Amp", "Amp", "~/.config/agents/skills", ".agents/skills"],
    ["goose", "Goose", "Goose", "~/.config/goose/skills", ".goose/skills"],
    ["opencode", "OpenCode", "OpenCode", "~/.config/opencode/skills", ".opencode/skills"],
    ["kilo", "Kilo Code", "Kilo", "~/.kilocode/skills", ".kilocode/skills"],
    ["roo", "Roo Code", "Roo", "~/.roo/skills", ".roo/skills"],
    ["antigravity", "Antigravity", "Antigrav", "~/.gemini/antigravity/skills", ".agent/skills"],
    ["clawdbot", "Clawdbot", "Clawdbot", "~/.clawdbot/skills", "skills"],
    ["droid", "Droid", "Droid", "~/.factory/skills", ".factory/skills"],
];

const DEFAULT_AGENTS: Record<string, Agent> = Object.fromEntries(
    AGENT_DEFINITIONS.map(([id, name, shortName, globalPath, projectPath]) => [
        id,
        { id, name, shortName, globalPath, projectPath, detected: false },
    ]),
);

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

        // Merge agents and ensure shortName exists for each
        const mergedAgents = { ...defaults.agents };
        for (const [id, agent] of Object.entries(parsed.agents ?? {})) {
            mergedAgents[id] = {
                ...defaults.agents[id],
                ...agent,
                // Ensure shortName exists, fallback to first word of name or id
                shortName: agent.shortName ?? defaults.agents[id]?.shortName ?? agent.name?.split(" ")[0] ?? id,
            };
        }

        return {
            agents: mergedAgents,
            sync: { ...defaults.sync, ...parsed.sync },
            snapshots: { ...defaults.snapshots, ...parsed.snapshots },
            skills: parsed.skills ?? {},
        };
    }
}
