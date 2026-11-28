// Records the fixtures of one dashboard:
// `pnpm record [-- --process <key>] [--time-zone <zone>] [--keep-text] [--from <recording>]`
// (default: PROCESS_KEY of src/page.config.ts, this machine's time zone).
//
// Connects to a Pulse MCP server (MCP_URL, default http://localhost:8400/mcp, which `pnpm play`
// serves in the Pulse repo; MCP_TOKEN, when set, as its bearer token, sent over https or to a
// loopback host only: scripts/token-target.ts), refuses to record a page that calls a tool the
// server does not mark read-only (PAGE_TOOLS of src/page.config.ts), runs every read the dashboard
// makes (src/data/process-dashboard.ts, three calls) in ONE run through widget-shell's page reader,
// the one the page reads through, with the clock fixed at the start and the days counted in the
// time zone, and writes fixtures/<key>.json in widget-shell's recording format (`recordToolCalls`):
// the time zone, whether it kept free text (`keepText`, which test/fixtures.test.ts holds) and each
// call with its answer, kept as src/data/recorded-reads.ts says (the fields the page reads; free
// text replaced unless --keep-text; the diagram without what the engine runs or evaluates). Ids
// are per engine boot, so a recording is never joined with another; record the whole dashboard
// again instead. `--from fixtures/<key>.json` records the same reads from an
// earlier recording instead of a server, on its clock and zone: a recording made before
// recorded-reads.ts changed keeps then only what the page reads now.
import { readFileSync, writeFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import {
  createPageReader,
  pageToolRefusals,
  playRecording,
  recordToolCalls,
  type RecordedToolCall,
  type ToolCaller,
  type ToolResult,
} from "@miragon/pulse-widget-shell/widgets"
import type { Fixture } from "../fixtures/fixture.ts"
import { DASHBOARD_READS } from "../src/data/process-dashboard.ts"
import { RECORDED_READS } from "../src/data/recorded-reads.ts"
import { PAGE_TOOLS, PROCESS_KEY } from "../src/page.config.ts"
import { clearTextTokenRefusal } from "./token-target.ts"

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    process: { type: "string" },
    "time-zone": { type: "string" },
    "keep-text": { type: "boolean", default: false },
    from: { type: "string" },
  },
})

/** Where the answers come from: a live server, or an earlier recording (`--from`). */
interface Source {
  readonly callTool: ToolCaller
  readonly asOf: Date
  readonly timeZone: string | undefined
  readonly process: string | undefined
  readonly close: () => Promise<void>
}

function fail(lines: readonly string[]): never {
  for (const line of lines) console.error(line)
  process.exit(1)
}

/** An earlier recording, replayed on its clock and in its zone. */
function recordingSource(file: string): Source {
  const earlier = JSON.parse(readFileSync(file, "utf8")) as Fixture
  const played = playRecording(earlier)
  const asOf = new Date(earlier.asOf)
  const close = async () => undefined
  return {
    callTool: played.callTool,
    asOf,
    timeZone: earlier.timeZone,
    process: earlier.process,
    close,
  }
}

/** The server's tools, each answer as it came (a tool's `isError` answer too), checked first. */
async function serverSource(): Promise<Source> {
  const url = new URL(process.env.MCP_URL ?? "http://localhost:8400/mcp")
  const token = process.env.MCP_TOKEN
  const refusal = clearTextTokenRefusal(url, token)
  if (refusal !== null) fail([refusal])
  const client = new Client({ name: "pulse-claude-artifact-recorder", version: "0.1.0" })
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : undefined,
    }),
  )
  // A page writes nothing: every tool it calls is one the server lists as read-only.
  const refusals = pageToolRefusals(PAGE_TOOLS, (await client.listTools()).tools)
  if (refusals.length > 0) {
    await client.close()
    fail([`${url.href} does not serve this page's tools as a page reads them:`, ...refusals])
  }
  const callTool: ToolCaller = async (name, args) =>
    (await client.callTool({ name, arguments: args })) as ToolResult
  return {
    callTool,
    asOf: new Date(),
    timeZone: undefined,
    process: undefined,
    close: () => client.close(),
  }
}

const source = values.from === undefined ? await serverSource() : recordingSource(values.from)
const key = values.process ?? source.process ?? PROCESS_KEY
const { callTool, calls, lacking } = recordToolCalls(source.callTool, {
  reads: RECORDED_READS,
  keepText: values["keep-text"],
})

// Without --time-zone the reader counts in the recording's zone, else in this machine's, the one
// its dates render in.
const reader = createPageReader(callTool, {
  now: () => source.asOf,
  timeZone: values["time-zone"] ?? source.timeZone,
})
const outcomes = await Promise.allSettled(
  Object.entries(DASHBOARD_READS).map(async ([section, read]) => {
    await read(reader, key)
    return section
  }),
)
await source.close()

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
  asOf: source.asOf.toISOString(),
  timeZone: reader.timeZone,
  process: key,
  engine: String(engineId),
  keepText: values["keep-text"],
  calls: calls.sort(
    (a, b) =>
      a.tool.localeCompare(b.tool) ||
      JSON.stringify(a.arguments).localeCompare(JSON.stringify(b.arguments)),
  ),
}
const file = new URL(`../fixtures/${key}.json`, import.meta.url)
writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`)
const text = values["keep-text"] ? "free text kept" : "free text replaced (--keep-text keeps it)"
console.log(
  `Recorded ${String(calls.length)} calls of ${key} on ${fixture.engine} (${fixture.timeZone}) into ${file.pathname}, ${text}`,
)
for (const { tool, path } of lacking) {
  console.warn(
    `  the page reads ${path} of ${tool}, which its answer lacks: adapt the page's types`,
  )
}
for (const failure of failed) console.warn(`  a section fails on the fixtures: ${failure}`)
