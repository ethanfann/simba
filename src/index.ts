#!/usr/bin/env bun

import { defineCommand, runMain } from "citty"

const main = defineCommand({
  meta: {
    name: "simba",
    version: "0.1.0",
    description: "AI skills sync/backup/migrate tool",
  },
  subCommands: {
    detect: () => import("./commands/detect").then((m) => m.default),
    status: () => import("./commands/status").then((m) => m.default),
    sync: () => import("./commands/sync").then((m) => m.default),
    migrate: () => import("./commands/migrate").then((m) => m.default),
    backup: () => import("./commands/backup").then((m) => m.default),
    restore: () => import("./commands/restore").then((m) => m.default),
    import: () => import("./commands/import").then((m) => m.default),
    undo: () => import("./commands/undo").then((m) => m.default),
    snapshots: () => import("./commands/snapshots").then((m) => m.default),
    adopt: () => import("./commands/adopt").then((m) => m.default),
  },
})

runMain(main)
