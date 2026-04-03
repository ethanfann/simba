#!/usr/bin/env bun

import { defineCommand, runMain, showUsage } from "citty"
import packageJson from "../package.json"

const main = defineCommand({
  meta: {
    name: "simba",
    version: packageJson.version,
    description: "AI skills manager",
  },
  async run({ cmd, rawArgs }) {
    if (rawArgs.length === 0) {
      await showUsage(cmd)
    }
  },
  subCommands: {
    init: () => import("./commands/init").then((m) => m.default),
    add: () => import("./commands/add").then((m) => m.default),
    remove: () => import("./commands/remove").then((m) => m.default),
    update: () => import("./commands/update").then((m) => m.default),
    list: () => import("./commands/list").then((m) => m.default),
    link: () => import("./commands/link").then((m) => m.default),
    unlink: () => import("./commands/unlink").then((m) => m.default),
    manage: () => import("./commands/manage").then((m) => m.default),
    doctor: () => import("./commands/doctor").then((m) => m.default),
  },
})

runMain(main)
