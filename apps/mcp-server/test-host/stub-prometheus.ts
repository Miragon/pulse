import http from "node:http"
import type { AddressInfo } from "node:net"

export interface StubPrometheus {
  /** Origin to set as `PROMETHEUS_URL`. */
  url: string
  close(): Promise<void>
}

/** One series of the stub: its name, its labels and its value over the period. */
interface Series {
  name: string
  labels: Record<string, string>
  value: number
}

const P = "engine_"

/** The engines Prometheus holds series for: the stub's two configured ones. */
const ENGINES = ["stub", "down"] as const

/**
 * The activities of the `invoice` diagram (fixtures/invoice.bpmn, so their
 * names resolve through the stub engine's BPMN) plus one of a process whose
 * diagram the engine does not serve — that one keeps its id.
 */
const ACTIVITIES: Array<{ key: string; id: string; type: string; count: number; avgSec: number }> =
  [
    { key: "invoice", id: "approveInvoice", type: "userTask", count: 1240, avgSec: 187 },
    { key: "invoice", id: "Gateway_approved", type: "exclusiveGateway", count: 1240, avgSec: 0.02 },
    { key: "invoice", id: "StartEvent_received", type: "startEvent", count: 1240, avgSec: 0 },
    { key: "invoice", id: "EndEvent_paid", type: "noneEndEvent", count: 1100, avgSec: 0 },
    { key: "invoice", id: "EndEvent_rejected", type: "noneEndEvent", count: 140, avgSec: 0 },
    {
      key: "customer-onboarding",
      id: "Task_VerifyIdentity",
      type: "serviceTask",
      count: 48,
      avgSec: 30,
    },
  ]

/** The series of one process on one engine. */
function processSeries(
  key: string,
  engine: string,
  flows: { started: number; completed: number; incidents: number; avgSec: number },
  live: { running: number; incidents: number; failedJobs: number },
): Series[] {
  const at = { process_definition_key: key, engine_id: engine }
  return [
    { name: `${P}process_instance_started_total`, labels: at, value: flows.started },
    {
      name: `${P}process_instance_ended_total`,
      labels: { ...at, state: "COMPLETED" },
      value: flows.completed,
    },
    { name: `${P}incident_created_total`, labels: at, value: flows.incidents },
    { name: `${P}incident_resolved_total`, labels: at, value: Math.floor(flows.incidents / 3) },
    {
      name: `${P}process_instance_duration_milliseconds_sum`,
      labels: at,
      value: flows.completed * flows.avgSec * 1000,
    },
    {
      name: `${P}process_instance_duration_milliseconds_count`,
      labels: at,
      value: flows.completed,
    },
    { name: `${P}process_definitions_deployed`, labels: at, value: 1 },
    { name: `${P}process_instances_running`, labels: at, value: live.running },
    ...(live.incidents > 0
      ? [
          {
            name: `${P}incidents_open`,
            labels: { ...at, incident_type: "failedJob" },
            value: live.incidents,
          },
        ]
      : []),
    ...(live.failedJobs > 0
      ? [{ name: `${P}jobs_failed`, labels: at, value: live.failedJobs }]
      : []),
  ]
}

const SERIES: Series[] = [
  ...processSeries(
    "invoice",
    "stub",
    { started: 1240, completed: 1100, incidents: 12, avgSec: 30 * 3600 },
    { running: 13, incidents: 3, failedJobs: 1 },
  ),
  ...processSeries(
    "invoice",
    "down",
    { started: 310, completed: 290, incidents: 1, avgSec: 26 * 3600 },
    { running: 4, incidents: 0, failedJobs: 0 },
  ),
  ...processSeries(
    "customer-onboarding",
    "stub",
    { started: 48, completed: 40, incidents: 0, avgSec: 2 * 86_400 },
    { running: 2, incidents: 0, failedJobs: 0 },
  ),
  ...ACTIVITIES.flatMap(({ key, id, type, count, avgSec }) => {
    const labels = {
      process_definition_key: key,
      engine_id: "stub",
      activity_id: id,
      activity_type: type,
    }
    return [
      { name: `${P}activity_ended_total`, labels, value: count },
      { name: `${P}activity_duration_milliseconds_sum`, labels, value: count * avgSec * 1000 },
      { name: `${P}activity_duration_milliseconds_count`, labels, value: count },
    ]
  }),
  ...ENGINES.flatMap((engine, i) => [
    { name: `${P}jobs_executable`, labels: { engine_id: engine }, value: [14, 1][i] },
    { name: `${P}jobs_suspended`, labels: { engine_id: engine }, value: [0, 2][i] },
    { name: `${P}jobs_due_future`, labels: { engine_id: engine }, value: [6, 0][i] },
    { name: `${P}external_tasks_open`, labels: { engine_id: engine }, value: [2, 0][i] },
  ]),
]

/** `label="v"` and `label=~"a|b"` matchers of a selector. */
function matchers(selector: string): Array<(labels: Record<string, string>) => boolean> {
  return [...selector.matchAll(/(\w+)(=~?)"([^"]*)"/g)].map(([, label, op, value]) => {
    const allowed = op === "=~" ? value.split("|") : [value]
    return (labels) => allowed.includes(labels[label] ?? "")
  })
}

/** The series `name` that match the selector written right after `written` in `q`. */
function select(q: string, written: string, name: string = written): Series[] {
  const at = q.indexOf(written)
  if (at < 0) return []
  const rest = q.slice(at + written.length)
  const selector = rest.startsWith("{") ? rest.slice(0, rest.indexOf("}") + 1) : ""
  const tests = matchers(selector)
  return SERIES.filter((s) => s.name === name && tests.every((test) => test(s.labels)))
}

/**
 * The `engine_<x>_milliseconds` histogram whose `_bucket` series `q` reads,
 * found with indexOf instead of a backtracking `\w+` (CodeQL js/polynomial-redos).
 */
function histogramIn(q: string): string | undefined {
  const end = q.indexOf("_milliseconds_bucket")
  if (end === -1) return undefined
  const start = q.lastIndexOf("engine_", end)
  if (start === -1 || !/^\w+$/.test(q.slice(start, end))) return undefined
  return q.slice(start, end + "_milliseconds".length)
}

/** The first series name `q` reads (a histogram's `_bucket` read as its `_sum`). */
function seriesIn(q: string): { written: string; name: string } | undefined {
  const bucket = histogramIn(q)
  if (bucket) return { written: `${bucket}_bucket`, name: `${bucket}_sum` }
  const names = [...new Set(SERIES.map((s) => s.name))]
    .map((n) => ({ n, at: q.indexOf(n) }))
    .filter(({ at }) => at >= 0)
    .sort((a, b) => a.at - b.at || b.n.length - a.n.length)
  return names[0] && { written: names[0].n, name: names[0].n }
}

/** Sum `series` per the `by (…)` labels (`le` dropped), or into one sample. */
function group(series: Series[], by: string[], value: (members: Series[]) => number) {
  const keys = by.filter((l) => l !== "le")
  const groups = new Map<string, Series[]>()
  for (const s of series) {
    const id = JSON.stringify(keys.map((k) => s.labels[k] ?? ""))
    groups.set(id, [...(groups.get(id) ?? []), s])
  }
  return [...groups.values()].map((members) => ({
    metric: Object.fromEntries(keys.map((k) => [k, members[0].labels[k] ?? ""])),
    value: value(members),
  }))
}

const total = (series: Series[]) => series.reduce((sum, s) => sum + s.value, 0)

/**
 * A small PromQL evaluator for the exact query shapes analytics sends: `sum`
 * and `sum by (…)` over one series (with its selector; a counter's born-series
 * count and a gauge's node fold read as the series itself, the stub has one
 * node and no births), the mean as `sum(_sum) / sum(_count)`, and
 * `histogram_quantile` read off the mean (×0.8 for the median, ×2.2 for p95).
 * A window anchored with `@` (the period before) reads 85 % of the period's
 * counts.
 */
/**
 * The label list of the outer `by (…)` in `q`, cut with indexOf (CodeQL
 * js/polynomial-redos). A leading plain `sum(`/`max(` adds everything up,
 * whatever an inner node fold groups by.
 */
function groupLabelsIn(q: string): string | undefined {
  if (q.startsWith("sum(") || q.startsWith("max(")) return undefined
  const open = q.indexOf("by (")
  if (open === -1) return undefined
  const close = q.indexOf(")", open + 4)
  return close === -1 ? undefined : q.slice(open + 4, close)
}

function evaluate(q: string): Array<{ metric: Record<string, string>; value: number }> {
  const read = seriesIn(q)
  if (!read) return []
  const by =
    groupLabelsIn(q)
      ?.split(",")
      .map((l) => l.trim()) ?? []
  const factor = q.includes(" @ ") ? 0.85 : 1
  const series = select(q, read.written, read.name).map((s) => ({
    ...s,
    value: s.value * factor,
  }))
  if (series.length === 0) return []
  const counts = select(q, read.written, read.name.replace(/_sum$/, "_count"))
  if (q.startsWith("histogram_quantile")) {
    const scale = q.startsWith("histogram_quantile(0.5") ? 0.8 : 2.2
    return group(series, by, (members) => {
      const ids = new Set(members.map((m) => JSON.stringify(m.labels)))
      const n = total(counts.filter((c) => ids.has(JSON.stringify(c.labels))))
      return n > 0 ? (total(members) / n) * scale : Number.NaN
    }).filter((s) => !Number.isNaN(s.value))
  }
  if (q.includes(") / sum(")) {
    const n = total(counts)
    // The mean of the period before is the same mean: undo the window factor.
    return n > 0 ? [{ metric: {}, value: total(series) / factor / n }] : []
  }
  return group(series, by, total)
}

/**
 * A Prometheus stand-in for the host simulation: `/api/v1/query` over a fixed
 * landscape of two engines and two processes, the `invoice` process with the
 * activities of the stub engine's diagram, so the analytics views render real
 * figures with names and the layout scenarios measure real tables.
 */
export async function startStubPrometheus(): Promise<StubPrometheus> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stub")
    const query = url.searchParams.get("query") ?? ""
    const ts = Date.now() / 1000
    const result =
      url.pathname === "/api/v1/query"
        ? evaluate(query).map((s) => ({ metric: s.metric, value: [ts, String(s.value)] }))
        : []
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ status: "success", data: { resultType: "vector", result } }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
