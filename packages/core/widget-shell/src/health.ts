/**
 * Readiness checks the server's OWN dependencies only: engine or Prometheus outages are reported by
 * the tools, and pulling the server out of rotation would turn a visible error into a silent absence.
 * The bare `<path>` aliases readiness for single-URL probes. Outside the OAuth gate, so no token.
 */

/** Structural, so hosts pass an `MCPServer` without this module importing mcp-use or hono. */
export interface HttpRouteHost {
  get(path: string, handler: (ctx: unknown) => Response | Promise<Response>): unknown
}

export type ReadinessCheck = () => void | Promise<void>

export interface HealthOptions {
  path?: string
  readiness?: Record<string, ReadinessCheck>
  /** A hung dependency must fail the probe, not hang it. */
  timeoutMs?: number
  label?: string
  /** Readiness then answers 503 `draining` so a load balancer stops routing while requests finish. */
  draining?: () => boolean
}

export type HealthStatus = "up" | "down"

export interface HealthReport {
  status: HealthStatus | "draining"
  checks: Record<string, HealthStatus>
}

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  })

async function withTimeout(check: ReadinessCheck, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    timer.unref()
  })
  try {
    // `.then(check)` turns a synchronous throw into a rejection.
    await Promise.race([Promise.resolve().then(check), timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function runReadinessChecks(
  checks: Record<string, ReadinessCheck>,
  timeoutMs: number,
  label: string,
): Promise<HealthReport> {
  const entries = await Promise.all(
    Object.entries(checks).map(async ([name, check]): Promise<[string, HealthStatus]> => {
      try {
        await withTimeout(check, timeoutMs)
        return [name, "up"]
      } catch (error) {
        // The reason goes to the log, not the unauthenticated response body.
        console.warn(`[${label}] readiness check "${name}" failed:`, error)
        return [name, "down"]
      }
    }),
  )
  const status: HealthStatus = entries.every(([, s]) => s === "up") ? "up" : "down"
  return { status, checks: Object.fromEntries(entries) }
}

/** Register `installMetrics` first if probe traffic should be counted. */
export function installHealthEndpoints(server: HttpRouteHost, options: HealthOptions = {}): void {
  const {
    path = "/health",
    readiness = {},
    timeoutMs = 2000,
    label = "health",
    draining = () => false,
  } = options
  const live = (): Response => jsonResponse(200, { status: "up" })
  const ready = async (): Promise<Response> => {
    if (draining()) return jsonResponse(503, { status: "draining", checks: {} })
    const report = await runReadinessChecks(readiness, timeoutMs, label)
    // Re-checked: a probe in flight when the drain began must not report up.
    if (draining()) return jsonResponse(503, { ...report, status: "draining" })
    return jsonResponse(report.status === "up" ? 200 : 503, report)
  }
  server.get(`${path}/live`, live)
  server.get(`${path}/ready`, ready)
  server.get(path, ready)
}
