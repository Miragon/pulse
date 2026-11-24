// Records the fixtures of one dashboard: `pnpm record [-- --process <key>] [--time-zone <zone>]`
// (default: the PROCESS_KEY of src/app.tsx, this machine's time zone).
//
// Connects to a Pulse MCP server (MCP_URL, default http://localhost:8400/mcp, which `pnpm play`
// serves in the Pulse repo; MCP_TOKEN, when set, as its bearer token, sent over https or to a
// loopback host only: scripts/token-target.ts), runs every read the dashboard makes
// (src/data/process-dashboard.ts, three calls) in ONE run with the clock fixed at the start and
// the days counted in the time zone, and writes fixtures/<key>.json: the time zone and each call
// with its answer. Ids are per engine boot, so a recording is never joined with another; record
// the whole dashboard again instead.
import { writeFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import type { Fixture, RecordedCall } from "../fixtures/mock-claude.ts"
import { DASHBOARD_READS } from "../src/data/process-dashboard.ts"
import type { Connector, ToolResult } from "../src/engine/connector.ts"
import { createEngine, viewerTimeZone } from "../src/engine/engine.ts"
import { pageProcessKey } from "./process-key.ts"
import { clearTextTokenRefusal } from "./token-target.ts"

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: { process: { type: "string" }, "time-zone": { type: "string" } },
})
const key = values.process ?? pageProcessKey()
const timeZone = values["time-zone"] ?? viewerTimeZone()
const url = new URL(process.env.MCP_URL ?? "http://localhost:8400/mcp")
const token = process.env.MCP_TOKEN
const refusal = clearTextTokenRefusal(url, token)
if (refusal !== null) {
  console.error(refusal)
  process.exit(1)
}

/** A result as the fixture keeps it: its structured data, else its text (an error's, say). */
function compact(result: ToolResult): ToolResult {
  if (!result.isError && result.structuredContent !== undefined) {
    return { structuredContent: result.structuredContent }
  }
  const content = (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => ({ type: "text", text: part.text ?? "" }))
  return result.isError ? { isError: true, content } : { content }
}

const client = new Client({ name: "pulse-claude-artifact-recorder", version: "0.1.0" })
await client.connect(
  new StreamableHTTPClientTransport(url, {
    requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : undefined,
  }),
)

const calls: RecordedCall[] = []
const connector: Connector = {
  async callTool(name, args) {
    const result = (await client.callTool({ name, arguments: args })) as ToolResult
    calls.push({ tool: name, arguments: args, result: compact(result) })
    return result
  },
}

const asOf = new Date()
const engine = createEngine(connector, { now: () => asOf, timeZone })
const outcomes = await Promise.allSettled(
  Object.entries(DASHBOARD_READS).map(async ([section, read]) => {
    await read(engine, key)
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
const engineOf = (call: RecordedCall) =>
  (call.result.structuredContent as { engine?: unknown } | undefined)?.engine
const engineId = calls.map(engineOf).find((id) => typeof id === "string") ?? "unknown"
const fixture: Fixture = {
  asOf: asOf.toISOString(),
  timeZone,
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
  `Recorded ${String(calls.length)} calls of ${key} on ${fixture.engine} (${timeZone}) into ${file.pathname}`,
)
for (const failure of failed) console.warn(`  a section fails on the fixtures: ${failure}`)
