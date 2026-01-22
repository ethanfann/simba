import { symlink, unlink, readlink, lstat, mkdir } from "node:fs/promises"
import { dirname } from "node:path"

export async function createSymlink(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  try {
    await symlink(source, target)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      // Already exists - check if it's a symlink pointing to the right place
      const existing = await getSymlinkTarget(target)
      if (existing === source) return // Already correct symlink
      
      // Check what we're dealing with
      const stat = await lstat(target)
      if (stat.isSymbolicLink()) {
        await unlink(target)
      } else if (stat.isDirectory()) {
        // Real directory - don't delete, throw error
        throw new Error(`Cannot create symlink: ${target} is a directory (not managed by simba)`)
      } else {
        await unlink(target)
      }
      await symlink(source, target)
    } else {
      throw err
    }
  }
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
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) {
      await unlink(path)
    } else if (stat.isDirectory()) {
      // Real directory - don't delete, it's not managed by simba
      throw new Error(`Cannot remove: ${path} is a directory (not managed by simba)`)
    } else {
      await unlink(path)
    }
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
