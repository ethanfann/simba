import { defineCommand } from "citty"
import { runMatrixTUI } from "../tui/matrix"

export default defineCommand({
  meta: {
    name: "manage",
    description: "Open interactive skill management TUI",
  },
  async run() {
    await runMatrixTUI()
  },
})
