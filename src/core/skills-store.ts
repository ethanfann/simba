import { readdir, access, mkdir, cp, rm } from "node:fs/promises"
import { join } from "node:path"
import { createSymlink, removeSymlink } from "../utils/symlinks"
import type { SkillAssignment } from "./types"

export class SkillsStore {
  constructor(
    private skillsDir: string,
    private registryPath: string
  ) {}

  async ensureDir(): Promise<void> {
    await mkdir(this.skillsDir, { recursive: true })
  }

  async listSkills(): Promise<string[]> {
    try {
      const entries = await readdir(this.skillsDir, { withFileTypes: true })
      return entries.filter(e => e.isDirectory()).map(e => e.name)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return []
      }
      throw err
    }
  }

  async hasSkill(name: string): Promise<boolean> {
    try {
      await access(join(this.skillsDir, name))
      return true
    } catch {
      return false
    }
  }

  async addSkill(name: string, sourcePath: string): Promise<void> {
    await this.ensureDir()
    const destPath = join(this.skillsDir, name)
    await cp(sourcePath, destPath, { recursive: true })
  }

  async linkSkill(name: string, sourcePath: string): Promise<void> {
    await this.ensureDir()
    const destPath = join(this.skillsDir, name)
    await createSymlink(sourcePath, destPath)
  }

  async removeSkill(name: string): Promise<void> {
    const skillPath = join(this.skillsDir, name)
    await rm(skillPath, { recursive: true })
  }

  async assignSkill(
    name: string,
    agentSkillsDir: string,
    assignment: SkillAssignment
  ): Promise<void> {
    const sourcePath = join(this.skillsDir, name)

    if (assignment.type === "directory") {
      const targetPath = join(agentSkillsDir, name)
      await createSymlink(sourcePath, targetPath)
    } else {
      const sourceFile = join(sourcePath, assignment.target!)
      const targetPath = join(agentSkillsDir, `${name}.${assignment.target!.split(".").pop()}`)
      await createSymlink(sourceFile, targetPath)
    }
  }

  async unassignSkill(name: string, agentSkillsDir: string): Promise<void> {
    const targetPath = join(agentSkillsDir, name)
    await removeSymlink(targetPath)
  }

  getSkillPath(name: string): string {
    return join(this.skillsDir, name)
  }
}
