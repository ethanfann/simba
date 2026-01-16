import { readFile, readdir, stat } from "node:fs/promises"
import { join, relative } from "node:path"
import { createHash } from "node:crypto"
import type { SkillFile } from "../core/types"

export async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath)
  return createHash("sha256").update(content).digest("hex")
}

export async function hashTree(
  dirPath: string
): Promise<{ treeHash: string; files: SkillFile[] }> {
  const files: SkillFile[] = []
  await collectFiles(dirPath, dirPath, files)

  // Sort for deterministic ordering
  files.sort((a, b) => a.path.localeCompare(b.path))

  // Git-style: hash of "path:hash\n" entries
  const treeContent = files.map((f) => `${f.path}:${f.hash}`).join("\n")
  const treeHash = createHash("sha256").update(treeContent).digest("hex")

  return { treeHash, files }
}

async function collectFiles(
  basePath: string,
  currentPath: string,
  files: SkillFile[]
): Promise<void> {
  const entries = await readdir(currentPath, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(currentPath, entry.name)

    if (entry.isDirectory()) {
      await collectFiles(basePath, fullPath, files)
    } else if (entry.isFile()) {
      const hash = await hashFile(fullPath)
      files.push({
        path: relative(basePath, fullPath),
        hash,
      })
    }
  }
}
