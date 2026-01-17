import { symlink, unlink, readlink, lstat, mkdir } from "node:fs/promises"
import { dirname } from "node:path"

export async function createSymlink(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  await symlink(source, target)
}

export async function isSymlink(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path)
    return stat.isSymbolicLink()
  } catch {
    return false
  }
}

export async function removeSymlink(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err
    }
  }
}

export async function getSymlinkTarget(path: string): Promise<string | null> {
  try {
    return await readlink(path)
  } catch {
    return null
  }
}
