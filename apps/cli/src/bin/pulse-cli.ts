#!/usr/bin/env node
/** Executable entry point: runs the CLI on the Node.js runtime and sets the exit code. */

import { run } from "../cli/run.js"
import { createNodeRuntime } from "./node-runtime.js"

// As PID 1 (the container image started without --init) the kernel drops every signal that has no
// handler, so neither Ctrl-C nor docker stop nor Kubernetes could end the CLI. Exit as the default
// action does elsewhere: 128 + the signal number.
if (process.pid === 1) {
  process.once("SIGINT", () => process.exit(130))
  process.once("SIGTERM", () => process.exit(143))
}

// No top-level await: the standalone bundle (tsdown.standalone.config.ts) is CommonJS, the only
// format a Node.js 24 single executable application runs. Until run() settles the exit code is
// 13, the one Node.js gives an unsettled top-level await, so an event loop that drains early never
// looks like success; a rejection still ends with exit code 1 (unhandled rejection).
process.exitCode = 13
void run(process.argv.slice(2), createNodeRuntime()).then((exitCode) => {
  process.exitCode = exitCode
})
