import { z } from "zod"
import type { AppPlugin } from "@miragon/mcp-toolkit-core"
import type { MCPServer } from "mcp-use"
import { createPlugin } from "./plugin.js"
import { analyticsToolsets } from "./toolsets.js"
import { analyticsInstructions } from "./instructions.js"
import type { FetchBpmnXml } from "./bpmn-name-lookup.js"
import type { ProfileSource } from "./server-locale.js"
import { NO_ENGINE_SCOPE_MESSAGE } from "./engine-ids.js"

/** The longest delay a Node timer holds — a longer deadline would fire at once. */
const MAX_TIMEOUT_MS = 2_147_483_647

const HEADERS_ERROR =
  'PROMETHEUS_HEADERS must be a JSON object of string header values, e.g. {"X-Scope-OrgID":"tenant-a"}'

/** `PROMETHEUS_HEADERS` JSON text (env) or an object (direct caller) → a header record. */
const headersSchema = z
  .union([
    z.record(z.string(), z.string()),
    z.string().transform((text, ctx) => {
      try {
        return JSON.parse(text) as unknown
      } catch {
        // Never echo the text: header values are often secrets (API keys).
        ctx.addIssue({ code: "custom", message: HEADERS_ERROR })
        return z.NEVER
      }
    }),
  ])
  .pipe(z.record(z.string(), z.string({ error: HEADERS_ERROR }), { error: HEADERS_ERROR }))

const analyticsConfigSchema = z.object({
  url: z.string().default("http://localhost:9090"),
  // Bearer token OR basic auth; the client rejects ambiguous combinations at boot.
  bearerToken: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  headers: headersSchema.optional(),
  // Strict: a typo fails the boot instead of being coerced into another deadline.
  timeoutMs: z
    .union([
      z.number(),
      z
        .string()
        .regex(/^\d+$/, "PROMETHEUS_TIMEOUT_MS must be a whole number of milliseconds")
        .transform(Number),
    ])
    .pipe(
      z
        .number()
        .int("PROMETHEUS_TIMEOUT_MS must be a whole number of milliseconds")
        .min(1, "PROMETHEUS_TIMEOUT_MS must be at least 1 ms")
        .max(MAX_TIMEOUT_MS, `PROMETHEUS_TIMEOUT_MS must be at most ${MAX_TIMEOUT_MS} ms`),
    )
    .optional(),
  /** Fallback for a standalone boot; injected `shared.engineIds` win. */
  engineIds: z
    .union([
      z.array(z.string()),
      z.string().transform((text) =>
        text
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
      ),
    ])
    .optional(),
  /** A plain string so a direct caller's unknown name fails closed instead of throwing. */
  toolset: z.string().optional(),
})

interface AnalyticsModuleShared {
  profileStore?: ProfileSource
  fetchBpmnXml?: FetchBpmnXml
  /** camunda7's configured engines; wins over `ANALYTICS_ENGINE_IDS`. */
  engineIds?: readonly string[]
}

/** Injected ids, else `ANALYTICS_ENGINE_IDS`, else none (fail-closed). */
function effectiveEngineIds(
  injected: readonly string[] | undefined,
  fromEnv: readonly string[] | undefined,
): readonly string[] {
  if (injected && injected.length > 0) {
    if (fromEnv && fromEnv.length > 0) {
      console.warn(
        `[analytics] ANALYTICS_ENGINE_IDS is ignored: the server's configured engines (${injected.join(", ")}) scope analytics.`,
      )
    }
    return injected
  }
  if (fromEnv && fromEnv.length > 0) return fromEnv
  console.warn(`[analytics] ${NO_ENGINE_SCOPE_MESSAGE}`)
  return []
}

export const analyticsModule = {
  name: "analytics",

  configFromEnv(env: NodeJS.ProcessEnv): Record<string, unknown> {
    // Blank = unset for every variable (a `KEY=` left in a .env file).
    // Credentials are passed verbatim otherwise — never trimmed into another secret.
    const trimmed = (name: string) => env[name]?.trim() || undefined
    const verbatim = (name: string) => (env[name]?.trim() ? env[name] : undefined)
    return {
      url: trimmed("PROMETHEUS_URL"),
      bearerToken: verbatim("PROMETHEUS_BEARER_TOKEN"),
      username: verbatim("PROMETHEUS_USERNAME"),
      password: verbatim("PROMETHEUS_PASSWORD"),
      headers: trimmed("PROMETHEUS_HEADERS"),
      timeoutMs: trimmed("PROMETHEUS_TIMEOUT_MS"),
      engineIds: trimmed("ANALYTICS_ENGINE_IDS"),
    }
  },

  knownEnvVars: [
    "PROMETHEUS_URL",
    "PROMETHEUS_BEARER_TOKEN",
    "PROMETHEUS_USERNAME",
    "PROMETHEUS_PASSWORD",
    "PROMETHEUS_HEADERS",
    "PROMETHEUS_TIMEOUT_MS",
    "ANALYTICS_ENGINE_IDS",
  ] as const,

  toolsets: analyticsToolsets,

  /** The default :9090 is a bare Prometheus, not the compose stack's :8460; without the hint queries 404 silently. */
  bootWarnings(env: NodeJS.ProcessEnv): string[] {
    if (env.PROMETHEUS_URL?.trim()) return []
    return [
      "PROMETHEUS_URL is not set — defaulting to http://localhost:9090. The repo's Compose stack publishes Prometheus on :8460 (PROMETHEUS_URL=http://localhost:8460).",
    ]
  },

  instructions(): string {
    return analyticsInstructions()
  },

  createPlugin(
    config: Record<string, unknown>,
    shared: AnalyticsModuleShared,
  ): AppPlugin<MCPServer> {
    const { toolset, engineIds, ...parsed } = analyticsConfigSchema.parse(config)
    return createPlugin({
      ...parsed,
      engineIds: effectiveEngineIds(shared.engineIds, engineIds),
      // Resolved once here, so the plugin only ever sees a declared name.
      toolset: analyticsToolsets.resolve(toolset),
      fetchBpmnXml: shared.fetchBpmnXml,
      profileStore: shared.profileStore,
    })
  },
}
