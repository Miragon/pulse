export interface PrometheusConfig {
  /** Userinfo moves into a Basic `Authorization` header: fetch rejects credentialed URLs. */
  url: string
  bearerToken?: string
  username?: string
  password?: string
  headers?: Record<string, string>
  timeoutMs?: number
}

export const DEFAULT_PROMETHEUS_TIMEOUT_MS = 30_000

/** The longest delay a Node timer holds — a longer deadline would fire at once. */
const MAX_TIMEOUT_MS = 2_147_483_647

const MAX_ERROR_TEXT = 500

export interface PromSample {
  metric: Record<string, string>
  value: number
}

export interface PrometheusQueryOptions {
  signal?: AbortSignal
}

export interface PrometheusClient {
  instant(query: string, options?: PrometheusQueryOptions): Promise<PromSample[]>
}

interface PromApiResponse {
  status: "success" | "error"
  errorType?: string
  error?: string
  data?: {
    resultType: string
    result: Array<{ metric: Record<string, string>; value: [number, string] }>
  }
}

function splitUserinfo(raw: string): { base: string; username?: string; password?: string } {
  let url: URL
  try {
    url = new URL(raw) // not URL.parse: that needs Node 22.1, the package supports 22.0
  } catch {
    // Not chained: the parse error carries the raw input.
    throw new Error("Prometheus URL (PROMETHEUS_URL) is not a valid URL")
  }
  const username = decodeURIComponent(url.username) || undefined
  const password = decodeURIComponent(url.password) || undefined
  url.username = ""
  url.password = ""
  return { base: url.toString().replace(/\/+$/, ""), username, password }
}

function authorizationFor(
  config: PrometheusConfig,
  userinfo: { username?: string; password?: string },
): { authorization?: string; secrets: Array<string | undefined> } {
  const explicitBasic = config.username !== undefined || config.password !== undefined
  if (userinfo.username !== undefined && (explicitBasic || config.bearerToken)) {
    throw new Error(
      "Prometheus auth is ambiguous: the URL carries credentials AND PROMETHEUS_USERNAME/PROMETHEUS_PASSWORD or PROMETHEUS_BEARER_TOKEN are set — use one",
    )
  }
  if (config.bearerToken && explicitBasic) {
    throw new Error(
      "Prometheus auth is ambiguous: set either PROMETHEUS_BEARER_TOKEN or PROMETHEUS_USERNAME + PROMETHEUS_PASSWORD, not both",
    )
  }
  if (explicitBasic && !(config.username && config.password)) {
    throw new Error("Prometheus basic auth needs both PROMETHEUS_USERNAME and PROMETHEUS_PASSWORD")
  }
  if (config.bearerToken) {
    return { authorization: `Bearer ${config.bearerToken}`, secrets: [config.bearerToken] }
  }
  const username = config.username ?? userinfo.username
  if (username === undefined) return { secrets: [] }
  const password = config.password ?? userinfo.password ?? ""
  const basic = Buffer.from(`${username}:${password}`).toString("base64")
  return { authorization: `Basic ${basic}`, secrets: [password, basic] }
}

/** RFC 9110 field-name token; a value must not break the header line. */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const HEADER_VALUE = /^[^\r\n\0]*$/

/**
 * Every form a secret can take in echoed text — as configured, trimmed
 * (header values are sent trimmed) and whitespace-collapsed — longest first,
 * so a value is masked whole before any shorter one inside it. Values under
 * 4 characters are skipped: masking those would shred ordinary text.
 */
function secretForms(secrets: Array<string | undefined>): string[] {
  const forms = new Set<string>()
  for (const secret of secrets) {
    if (!secret) continue
    for (const form of [secret, secret.trim(), secret.replace(/\s+/g, " ").trim()]) {
      if (form.length >= 4) forms.add(form)
    }
  }
  return [...forms].sort((a, b) => b.length - a.length)
}

function mask(text: string, secrets: readonly string[]): string {
  let masked = text
  for (const secret of secrets) masked = masked.split(secret).join("***")
  return masked
}

const ERROR_TYPE = /^[a-z_]{1,40}$/

function buildHeaders(
  config: PrometheusConfig,
  userinfo: { username?: string; password?: string },
): { headers: Headers; secrets: string[] } {
  const headers = new Headers()
  for (const [name, value] of Object.entries(config.headers ?? {})) {
    // Checked up front so the value (often a secret, e.g. an API key) never
    // lands in an error — only the header name is named.
    if (!HEADER_NAME.test(name) || !HEADER_VALUE.test(value)) {
      throw new Error(
        `Prometheus header "${name}" (PROMETHEUS_HEADERS) has an invalid name or value`,
      )
    }
    headers.set(name, value)
  }
  const { authorization, secrets } = authorizationFor(config, userinfo)
  if (authorization && headers.has("Authorization")) {
    throw new Error(
      "Prometheus auth is ambiguous: PROMETHEUS_HEADERS sets Authorization next to configured credentials",
    )
  }
  if (authorization) headers.set("Authorization", authorization)
  // The configured credential (not its header line, so an echo keeps the
  // scheme readable) plus every custom header value.
  return { headers, secrets: secretForms([...secrets, ...Object.values(config.headers ?? {})]) }
}

function resolveTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_PROMETHEUS_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new RangeError(
      `Prometheus timeout must be a positive integer of at most ${MAX_TIMEOUT_MS} ms, got ${timeoutMs}`,
    )
  }
  return timeoutMs
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function networkCode(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown; errors?: Array<{ code?: unknown }> } }).cause
  const code = cause?.code ?? cause?.errors?.find((e) => e.code)?.code
  return typeof code === "string" && code.length > 0 ? code : "network error"
}

/** Every failure message is safe to hand to the model: no URL, no credentials, upstream text truncated. */
export function createPrometheusClient(config: PrometheusConfig): PrometheusClient {
  const userinfo = splitUserinfo(config.url)
  const { base } = userinfo
  const { headers, secrets } = buildHeaders(config, userinfo)
  const timeoutMs = resolveTimeout(config.timeoutMs)

  // Masked before AND after collapsing whitespace, so neither form of a secret slips through.
  const safe = (text: string): string => {
    const flat = mask(mask(text, secrets).replace(/\s+/g, " ").trim(), secrets)
    return flat.length > MAX_ERROR_TEXT ? `${flat.slice(0, MAX_ERROR_TEXT)}…` : flat
  }

  const errorTypeOf = (value: unknown): string | undefined =>
    typeof value === "string" && ERROR_TYPE.test(value) ? safe(value) : undefined

  function httpError(response: Response, text: string): Error {
    const body = parseJson(text) as Partial<PromApiResponse> | null | undefined
    const errorType = errorTypeOf(body?.errorType)
    const raw = typeof body?.error === "string" ? body.error : text
    const detail = safe(raw) || `${response.statusText || "HTTP error"} — empty response body`
    const auth = response.status === 401 || response.status === 403
    return new Error(
      `Prometheus query failed (${response.status}${errorType ? ` ${errorType}` : ""}): ${detail}${
        auth ? " — check the configured Prometheus credentials" : ""
      }`,
    )
  }

  async function fetchText(
    url: string,
    caller: AbortSignal | undefined,
  ): Promise<{ response: Response; text: string }> {
    const deadline = AbortSignal.timeout(timeoutMs)
    const signal = caller ? AbortSignal.any([caller, deadline]) : deadline
    try {
      const response = await fetch(url, { method: "GET", headers, signal })
      return { response, text: await response.text() }
    } catch (err) {
      const message = deadline.aborted
        ? `Prometheus did not respond within ${timeoutMs} ms (timeout)`
        : caller?.aborted
          ? "Prometheus query cancelled by the caller"
          : `Prometheus unreachable (${networkCode(err)})`
      throw new Error(message, { cause: err })
    }
  }

  function parseEnvelope(response: Response, text: string): PromApiResponse {
    const body = parseJson(text)
    if (body !== null && typeof body === "object") return body as PromApiResponse
    const type = response.headers.get("Content-Type")?.split(";")[0]
    throw new Error(
      `Prometheus returned a non-JSON response (HTTP ${response.status}${
        type ? `, ${type}` : ""
      }) — is a proxy or login page in front of it?`,
    )
  }

  return {
    async instant(query, options = {}) {
      const url = `${base}/api/v1/query?query=${encodeURIComponent(query)}`
      const { response, text } = await fetchText(url, options.signal)
      if (!response.ok) throw httpError(response, text)
      const body = parseEnvelope(response, text)
      if (body.status !== "success" || !body.data) {
        const errorType = errorTypeOf(body.errorType)
        throw new Error(
          `Prometheus query error${errorType ? ` (${errorType})` : ""}: ${safe(
            body.error ?? "unknown",
          )}`,
        )
      }
      const out: PromSample[] = []
      for (const r of body.data.result) {
        const value = Number(r.value[1])
        if (Number.isNaN(value)) continue
        out.push({ metric: r.metric, value })
      }
      return out
    },
  }
}

// Every Prometheus query is a read, so cancelling one with the caller is always safe.
export function withCallerSignal(
  client: PrometheusClient,
  signal: AbortSignal | undefined,
): PrometheusClient {
  if (!signal) return client
  return {
    instant: (query, options) =>
      client.instant(query, { ...options, signal: options?.signal ?? signal }),
  }
}

export function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function escapeRegexValue(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export type EngineFilterInput = string | string[] | undefined

export function engineIdsOf(engine: EngineFilterInput): string[] | null {
  if (engine === undefined || engine === null) return null
  const ids = (Array.isArray(engine) ? engine : [engine]).filter((id) => id.length > 0)
  return ids.length > 0 ? ids : null
}

export function engineMatcher(engine: EngineFilterInput): string | undefined {
  if (engine === undefined || engine === null) return undefined
  if (Array.isArray(engine)) {
    if (engine.length === 0) return undefined
    if (engine.length === 1) return engineMatcher(engine[0])
    return `engine_id=~"${engine.map((e) => escapeLabelValue(escapeRegexValue(e))).join("|")}"`
  }
  if (engine.length === 0) return undefined
  return `engine_id="${escapeLabelValue(engine)}"`
}

export function selector(...matchers: Array<string | undefined>): string {
  const parts = matchers.filter((m): m is string => !!m && m.length > 0)
  return parts.length ? `{${parts.join(",")}}` : ""
}

// The repo stack's `--storage.tsdb.retention.time`; a longer window would silently read partial data.
export const RETENTION_DAYS = 30

export const PERIOD_RANGE = {
  "1d": "1d",
  "3d": "3d",
  "7d": "7d",
  "14d": "14d",
  "30d": "30d",
} as const
export type Period = keyof typeof PERIOD_RANGE

export const PERIODS = Object.keys(PERIOD_RANGE) as [Period, ...Period[]]
