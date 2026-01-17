import { readFile, writeFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import type { Registry } from "./types"

function createEmptyRegistry(): Registry {
  return { version: 1, skills: {} }
}

export class RegistryStore {
  constructor(private registryPath: string) {}

  async load(): Promise<Registry> {
    try {
      const content = await readFile(this.registryPath, "utf-8")
      return JSON.parse(content) as Registry
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return createEmptyRegistry()
      }
      throw err
    }
  }

  async save(registry: Registry): Promise<void> {
    await mkdir(dirname(this.registryPath), { recursive: true })
    await writeFile(this.registryPath, JSON.stringify(registry, null, 2))
  }
}
