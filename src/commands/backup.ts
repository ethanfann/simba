import { defineCommand } from "citty"
import { ConfigStore } from "../core/config-store"
import { AgentRegistry } from "../core/agent-registry"
import { getConfigPath, expandPath } from "../utils/paths"
import { inputText } from "../utils/prompts"
import { mkdir, writeFile, readFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import * as tar from "tar"

export default defineCommand({
  meta: {
    name: "backup",
    description: "Export all skills to archive",
  },
  args: {
    path: {
      type: "positional",
      description: "Output path (.tar.gz)",
    },
    includeConfig: {
      type: "boolean",
      description: "Include simba config in backup",
      default: false,
    },
  },
  async run({ args }) {
    const configStore = new ConfigStore(getConfigPath())
    const config = await configStore.load()
    const registry = new AgentRegistry(config.agents)

    // Prompt for path if not provided
    const defaultPath = `./simba-backup-${new Date().toISOString().slice(0, 10)}.tar.gz`
    let outputPath = args.path
    if (!outputPath) {
      outputPath = await inputText("Output path:", {
        placeholder: defaultPath,
        defaultValue: defaultPath,
      })
    }

    // Collect all unique skills
    const allSkills = new Map<string, { path: string; origin: string }>()

    for (const [agentId, agent] of Object.entries(config.agents)) {
      if (!agent.detected) continue

      const skills = await registry.listSkills(agentId)
      for (const skill of skills) {
        if (!allSkills.has(skill.name)) {
          allSkills.set(skill.name, {
            path: registry.getSkillPath(skill.name, agentId),
            origin: agentId,
          })
        }
      }
    }

    if (allSkills.size === 0) {
      console.log("No skills to backup.")
      return
    }

    // Create temp directory for backup structure
    const tempDir = join(dirname(outputPath), `.simba-backup-${Date.now()}`)
    const skillsDir = join(tempDir, "skills")
    await mkdir(skillsDir, { recursive: true })

    // Copy skills to temp structure
    const manifest = {
      version: "1",
      created: new Date().toISOString(),
      simba_version: "0.1.0",
      source_agents: [...new Set(Array.from(allSkills.values()).map((s) => s.origin))],
      skills: {} as Record<string, { hash: string; origin: string; files: string[] }>,
      includes_config: args.includeConfig,
    }

    for (const [name, { path, origin }] of allSkills) {
      const destPath = join(skillsDir, name)
      await Bun.$`cp -r ${path} ${destPath}`

      const skill = (await registry.listSkills(origin)).find((s) => s.name === name)
      if (skill) {
        manifest.skills[name] = {
          hash: skill.treeHash,
          origin,
          files: skill.files.map((f) => f.path),
        }
      }
    }

    // Write manifest
    await writeFile(
      join(tempDir, "manifest.json"),
      JSON.stringify(manifest, null, 2)
    )

    // Include config if requested
    if (args.includeConfig) {
      const configContent = await readFile(getConfigPath(), "utf-8")
      await writeFile(join(tempDir, "config.toml"), configContent)
    }

    // Create tar.gz
    await tar.create(
      {
        gzip: true,
        file: outputPath,
        cwd: tempDir,
      },
      ["manifest.json", "skills", ...(args.includeConfig ? ["config.toml"] : [])]
    )

    // Cleanup temp
    await Bun.$`rm -rf ${tempDir}`

    console.log(`\nBackup created: ${outputPath}`)
    console.log(`Skills: ${allSkills.size}`)
    console.log(`Config included: ${args.includeConfig}`)
  },
})
