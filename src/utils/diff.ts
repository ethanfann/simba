import { parseDiffFromFile, type FileDiffMetadata } from "@pierre/diffs"
import terminalKit from "terminal-kit"

const term = terminalKit.terminal

export interface DiffResult {
  identical: boolean
  diff?: FileDiffMetadata
}

export function compareFiles(oldContent: string, newContent: string, filename: string = "file"): DiffResult {
  if (oldContent === newContent) {
    return { identical: true }
  }

  const diff = parseDiffFromFile(
    { name: filename, contents: oldContent },
    { name: filename, contents: newContent }
  )

  return { identical: false, diff }
}

export function renderDiff(diff: FileDiffMetadata, leftLabel: string, rightLabel: string): void {
  term.bold(`\n  Comparing: `).defaultColor(`${leftLabel} vs ${rightLabel}\n\n`)

  for (const hunk of diff.hunks) {
    // Show hunk header
    term.gray(`  @@ -${hunk.deletionStart},${hunk.deletionLines} +${hunk.additionStart},${hunk.additionLines} @@\n`)

    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        for (const line of content.lines) {
          term.gray(`    ${line.trimEnd()}\n`)
        }
      } else if (content.type === "change") {
        for (const line of content.deletions) {
          term.red(`  - ${line.trimEnd()}\n`)
        }
        for (const line of content.additions) {
          term.green(`  + ${line.trimEnd()}\n`)
        }
      }
    }
  }

  term("\n")
}

export function renderIdenticalMessage(skillName: string): void {
  term.yellow(`\n  "${skillName}" has identical content in all agents.\n`)
  term.gray("  Choosing the first agent as source.\n\n")
}
