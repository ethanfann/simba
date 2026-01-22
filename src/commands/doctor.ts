import { defineCommand } from "citty"
import { access, rm } from "node:fs/promises"
import { join } from "node:path"
import * as p from "@clack/prompts"
import { ConfigStore } from "../core/config-store"
import { RegistryStore } from "../core/registry-store"
import { AgentRegistry } from "../core/agent-registry"
import { getConfigPath, getSkillsDir, getRegistryPath, expandPath } from "../utils/paths"
import { isSymlink, getSymlinkTarget, createSymlink, removeSymlink } from "../utils/symlinks"
import type { Agent } from "../core/types"

interface BrokenLink {
  skill: string
  agent: string
  path: string
  reason: string
}

interface RogueFile {
  skill: string
  agent: string
  path: string
}

export interface DoctorResults {
  healthy: string[]
  broken: BrokenLink[]
  rogue: RogueFile[]
}

export interface DoctorOptions {
  skillsDir: string
  registryPath: string
  agents: Record<string, Agent>
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorResults> {
  const registryStore = new RegistryStore(options.registryPath)
  const registry = await registryStore.load()

  const results: DoctorResults = {
    healthy: [],
    broken: [],
    rogue: [],
  }

  for (const [skillName, skill] of Object.entries(registry.skills)) {
    let skillHealthy = true

    for (const [agentId, assignment] of Object.entries(skill.assignments)) {
      const agent = options.agents[agentId]
      if (!agent || !agent.detected) continue

      const agentSkillsDir = expandPath(agent.globalPath)
      const expectedPath = join(agentSkillsDir, skillName)
      const expectedTarget = join(options.skillsDir, skillName)

      const pathIsSymlink = await isSymlink(expectedPath)

      if (!pathIsSymlink) {
        try {
          await access(expectedPath)
          results.rogue.push({ skill: skillName, agent: agentId, path: expectedPath })
          skillHealthy = false
        } catch {
          results.broken.push({
            skill: skillName,
            agent: agentId,
            path: expectedPath,
            reason: "symlink missing",
          })
          skillHealthy = false
        }
        continue
      }

      const target = await getSymlinkTarget(expectedPath)

      try {
        await access(target!)
      } catch {
        results.broken.push({
          skill: skillName,
          agent: agentId,
          path: expectedPath,
          reason: "target missing",
        })
        skillHealthy = false
        continue
      }

      if (target !== expectedTarget) {
        results.broken.push({
          skill: skillName,
          agent: agentId,
          path: expectedPath,
          reason: `wrong target: ${target}`,
        })
        skillHealthy = false
      }
    }

    if (skillHealthy) {
      results.healthy.push(skillName)
    }
  }

  return results
}

export default defineCommand({
  meta: { name: "doctor", description: "Verify symlink integrity" },
  args: {
    fix: { type: "boolean", description: "Automatically fix issues", default: false },
  },
  async run({ args }) {
    const configStore = new ConfigStore(getConfigPath())
    const config = await configStore.load()

    const agentRegistry = new AgentRegistry(config.agents)
    const detected = await agentRegistry.detectAgents()

    console.log("\nChecking symlink integrity...\n")

    const results = await runDoctor({
      skillsDir: getSkillsDir(),
      registryPath: getRegistryPath(),
      agents: detected,
    })

    for (const skill of results.healthy) {
      console.log(`✓ ${skill}`)
    }

    for (const broken of results.broken) {
      console.log(`✗ ${broken.skill}`)
      console.log(`  └─ ${broken.agent}: BROKEN (${broken.reason})`)
    }

    for (const rogue of results.rogue) {
      console.log(`⚠ ${rogue.skill}`)
      console.log(`  └─ ${rogue.agent}: ROGUE (real file, not symlink)`)
    }

    console.log(`\nSummary: ${results.broken.length} broken, ${results.rogue.length} rogue, ${results.healthy.length} healthy`)

    if (results.broken.length === 0 && results.rogue.length === 0) {
      console.log("\nAll symlinks healthy!")
      return
    }

    if (!args.fix) {
      const shouldFix = await p.confirm({ message: "Fix issues?" })
      if (p.isCancel(shouldFix) || !shouldFix) return
    }

    for (const broken of results.broken) {
      const agent = detected[broken.agent]
      if (!agent) continue

      const expectedTarget = join(getSkillsDir(), broken.skill)
      await removeSymlink(broken.path)
      await createSymlink(expectedTarget, broken.path)
      console.log(`Fixed: ${broken.skill} (${broken.agent})`)
    }

    for (const rogue of results.rogue) {
      const agent = detected[rogue.agent]
      if (!agent) continue

      // Delete rogue directory/file and replace with symlink
      await rm(rogue.path, { recursive: true })
      const expectedTarget = join(getSkillsDir(), rogue.skill)
      await createSymlink(expectedTarget, rogue.path)
      console.log(`Fixed rogue: ${rogue.skill} (${rogue.agent})`)
    }

    console.log("\nRepairs complete!")
  },
})
