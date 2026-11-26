// Records the fixtures of one dashboard: `pnpm record [-- --process <key>] [--time-zone <zone>]`
// (default: PROCESS_KEY of src/page.config.ts, this machine's time zone).
//
// Connects to a Pulse MCP server (MCP_URL, default http://localhost:8400/mcp, which `pnpm play`
// serves in the Pulse repo; MCP_TOKEN, when set, as its bearer token, sent over https or to a
// loopback host only: scripts/token-target.ts), runs every read the dashboard makes
// (src/data/process-dashboard.ts, three calls) in ONE run through widget-shell's page reader, the
// one the page reads through, with the clock fixed at the start and the days counted in the time
// zone, and writes fixtures/<key>.json in widget-shell's recording format (`recordToolCalls`): the
// time zone and each call with its answer. Ids are per engine boot, so a recording is never joined
// with another; record the whole dashboard again instead.
import { writeFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import {
  createPageReader,
  recordToolCalls,
  type RecordedToolCall,
  type ToolCaller,
  type ToolResult,
} from "@miragon/pulse-widget-shell/widgets"
import type { Fixture } from "../fixtures/fixture.ts"
import { DASHBOARD_READS } from "../src/data/process-dashboard.ts"
import { PROCESS_KEY } from "../src/page.config.ts"
import { clearTextTokenRefusal } from "./token-target.ts"

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: { process: { type: "string" }, "time-zone": { type: "string" } },
})
const key = values.process ?? PROCESS_KEY
const url = new URL(process.env.MCP_URL ?? "http://localhost:8400/mcp")
const token = process.env.MCP_TOKEN
const refusal = clearTextTokenRefusal(url, token)
if (refusal !== null) {
  console.error(refusal)
  process.exit(1)
}

const client = new Client({ name: "pulse-claude-artifact-recorder", version: "0.1.0" })
await client.connect(
  new StreamableHTTPClientTransport(url, {
    requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : undefined,
  }),
)

/** The server's tools, each answer as it came (a tool's `isError` answer too). */
const live: ToolCaller = async (name, args) =>
  (await client.callTool({ name, arguments: args })) as ToolResult
const { callTool, calls } = recordToolCalls(live)

const asOf = new Date()
// Without --time-zone the reader counts in this machine's zone, the one its dates render in.
const reader = createPageReader(callTool, { now: () => asOf, timeZone: values["time-zone"] })
const outcomes = await Promise.allSettled(
  Object.entries(DASHBOARD_READS).map(async ([section, read]) => {
    await read(reader, key)
    return section
  }),
)
await client.close()

const failed = outcomes.flatMap((outcome, i) =>
  outcome.status === "rejected"
    ? [`${Object.keys(DASHBOARD_READS)[i]}: ${String(outcome.reason)}`]
    : [],
)
/** The engine the server read: every answer of the page's tools names it. */
const engineOf = (call: RecordedToolCall) =>
  (call.result.structuredContent as { engine?: unknown } | undefined)?.engine
const engineId = calls.map(engineOf).find((id) => typeof id === "string") ?? "unknown"
const fixture: Fixture = {
  asOf: asOf.toISOString(),
  timeZone: reader.timeZone,
  process: key,
  engine: String(engineId),
  calls: calls.sort(
    (a, b) =>
      a.tool.localeCompare(b.tool) ||
      JSON.stringify(a.arguments).localeCompare(JSON.stringify(b.arguments)),
  ),
}
const file = new URL(`../fixtures/${key}.json`, import.meta.url)
writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`)
console.log(
  `Recorded ${String(calls.length)} calls of ${key} on ${fixture.engine} (${fixture.timeZone}) into ${file.pathname}`,
)
for (const failure of failed) console.warn(`  a section fails on the fixtures: ${failure}`)
