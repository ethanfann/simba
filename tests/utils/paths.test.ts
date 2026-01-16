import { describe, test, expect } from "bun:test"
import { expandPath, getConfigDir, getConfigPath } from "../../src/utils/paths"
import { homedir } from "node:os"

describe("paths", () => {
  test("expandPath expands tilde", () => {
    const result = expandPath("~/.claude/skills")
    expect(result).toBe(`${homedir()}/.claude/skills`)
  })

  test("expandPath handles absolute paths", () => {
    const result = expandPath("/absolute/path")
    expect(result).toBe("/absolute/path")
  })

  test("getConfigDir returns XDG path", () => {
    const result = getConfigDir()
    expect(result).toContain("simba")
  })

  test("getConfigPath returns config.toml path", () => {
    const result = getConfigPath()
    expect(result).toEndWith("config.toml")
  })
})
