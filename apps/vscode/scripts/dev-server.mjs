import { spawn } from "node:child_process"
import * as esbuild from "esbuild"

const OUTFILE = "dist-dev/dev-host.mjs"

await esbuild.build({
  entryPoints: ["dev/host/dev-host.ts"],
  outfile: OUTFILE,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  loader: { ".bpmn": "text" },
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: "warning",
})

const host = spawn(process.execPath, [OUTFILE], { stdio: "inherit", env: process.env })
host.on("exit", (code) => process.exit(code ?? 0))
