import { test, expect, describe } from "bun:test"
import { getSkillsDir, getRegistryPath } from "./paths"
import { join } from "node:path"
import { homedir } from "node:os"

describe("paths", () => {
  test("getSkillsDir returns XDG-compliant path", () => {
    const expected = join(homedir(), ".config", "simba", "skills")
    expect(getSkillsDir()).toBe(expected)
  })

  test("getRegistryPath returns registry.json path", () => {
    const expected = join(homedir(), ".config", "simba", "registry.json")
    expect(getRegistryPath()).toBe(expected)
  })
})
