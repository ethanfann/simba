// Core types for simba

export interface Agent {
  id: string
  name: string
  globalPath: string
  projectPath: string
  detected: boolean
}

export interface SkillFile {
  path: string
  hash: string
}

export interface SkillInfo {
  name: string
  treeHash: string
  files: SkillFile[]
  origin: string
  lastSeen: Date
  agents: string[]
}

export interface SyncConfig {
  strategy: "union" | "source"
  sourceAgent: string
}

export interface SnapshotConfig {
  maxCount: number
  autoSnapshot: boolean
}

export interface Config {
  agents: Record<string, Agent>
  sync: SyncConfig
  snapshots: SnapshotConfig
  skills: Record<string, SkillInfo>
}

export type SkillStatus = "synced" | "conflict" | "unique" | "missing"

export interface SkillMatrix {
  skillName: string
  agents: Record<string, { present: boolean; hash: string | null }>
  status: SkillStatus
}
