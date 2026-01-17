import { homedir } from "node:os"
import { join } from "node:path"

export function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2))
  }
  return path
}

export function getConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(xdgConfig, "simba")
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.toml")
}

export function getSnapshotsDir(): string {
  return join(getConfigDir(), "snapshots")
}

export function getSkillsDir(): string {
  return join(getConfigDir(), "skills")
}

export function getRegistryPath(): string {
  return join(getConfigDir(), "registry.json")
}
