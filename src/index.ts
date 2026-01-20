#!/usr/bin/env bun

import { defineCommand, runMain } from "citty"

const main = defineCommand({
  meta: {
    name: "simba",
    version: "0.2.0",
    description: "AI skills manager",
  },
  subCommands: {
    adopt: () => import("./commands/adopt").then((m) => m.default),
    assign: () => import("./commands/assign").then((m) => m.default),
    backup: () => import("./commands/backup").then((m) => m.default),
    detect: () => import("./commands/detect").then((m) => m.default),
    doctor: () => import("./commands/doctor").then((m) => m.default),
    import: () => import("./commands/import").then((m) => m.default),
    install: () => import("./commands/install").then((m) => m.default),
    list: () => import("./commands/list").then((m) => m.default),
    manage: () => import("./commands/manage").then((m) => m.default),
    migrate: () => import("./commands/migrate").then((m) => m.default),
    restore: () => import("./commands/restore").then((m) => m.default),
    snapshots: () => import("./commands/snapshots").then((m) => m.default),
    status: () => import("./commands/status").then((m) => m.default),
    sync: () => import("./commands/sync").then((m) => m.default),
    unassign: () => import("./commands/unassign").then((m) => m.default),
    uninstall: () => import("./commands/uninstall").then((m) => m.default),
    undo: () => import("./commands/undo").then((m) => m.default),
    update: () => import("./commands/update").then((m) => m.default),
  },
})

runMain(main)
