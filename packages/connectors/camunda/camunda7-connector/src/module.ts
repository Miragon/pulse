import fs from "node:fs"
import { z } from "zod"
import type { AppPlugin } from "@miragon/mcp-toolkit-core"
import type { MCPServer } from "mcp-use"
import type { Client } from "@miragon/pulse-camunda7-client"
import { createPlugin, type Camunda7SharedResources } from "./plugin.js"
import { DEFAULT_ENGINE_FLAVOR, providerForEntry } from "./providers/index.js"
import { allowsProfileSave, camunda7Toolsets } from "./lib/toolsets.js"
import { camunda7Instructions } from "./instructions.js"
import { fetchLatestDefinitionXml } from "./data/definition-info.js"

// Incomplete credentials fail the boot instead of silently sending unauthenticated requests.
const engineAuthSchema = z
  .object({
    type: z.enum(["basic", "bearer", "passthrough", "none"]),
    username: z.string().optional(),
    password: z.string().optional(),
    token: z.string().optional(),
  })
  .refine((a) => a.type !== "basic" || Boolean(a.username && a.password), {
    message: 'engine auth type "basic" requires username and password',
  })
  .refine((a) => a.type !== "bearer" || Boolean(a.token), {
    message: 'engine auth type "bearer" requires token',
  })

const engineSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      "Engine id must be lowercase alphanumeric / dashes, starting with a letter or digit",
    ),
  baseUrl: z.string().url(),
  cockpitUrl: z.string().url().optional(),
  /** A picker grouping only: `id` stays the flat join key against the metrics' `engine_id`. */
  environment: z
    .string()
    .min(1)
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      "Environment id must be lowercase alphanumeric / dashes, starting with a letter or digit",
    )
    // JS enumerates numeric keys first, which would reorder environments and shift engines[0].
    .regex(/^(?!\d+$)/, "Environment id must not be purely numeric")
    .optional(),
  /** Default "camunda7"; the single-engine shorthand reads CAMUNDA_ENGINE_FLAVOR. */
  flavor: z
    .enum(["cibseven", "operaton", "camunda7"], {
      error:
        'Engine flavor must be "cibseven", "operaton" or "camunda7" (the entry\'s `flavor`, or CAMUNDA_ENGINE_FLAVOR next to CAMUNDA_BASE_URL)',
    })
    .optional(),
  /** Per-engine override; engines without one use the global CAMUNDA_* auth. */
  auth: engineAuthSchema.optional(),
})

/** The longest delay a Node timer holds — a longer deadline would fire at once. */
const MAX_TIMEOUT_MS = 2_147_483_647

export const camunda7ConfigSchema = z
  .object({
    engines: z.array(engineSchema).min(1),
    authType: z.enum(["basic", "bearer", "passthrough", "none"]).default("none"),
    username: z.string().optional(),
    password: z.string().optional(),
    token: z.string().optional(),
    toolset: z.string().optional(),
    // Strict: deploying is code execution in the engine JVM (z.coerce.boolean reads "false" as true).
    allowDeployments: z
      .enum(["true", "false"], {
        error: 'CAMUNDA_ALLOW_DEPLOYMENTS must be exactly "true" or "false" (or unset)',
      })
      .optional()
      .transform((v) => v === "true"),
    // Strict: a typo ("30s", "3e4") fails the boot instead of becoming another deadline.
    requestTimeoutMs: z
      .union([
        z.number(),
        z
          .string()
          .regex(/^\d+$/, "CAMUNDA_REQUEST_TIMEOUT_MS must be a whole number of milliseconds")
          .transform(Number),
      ])
      .pipe(
        z
          .number()
          .int("CAMUNDA_REQUEST_TIMEOUT_MS must be a whole number of milliseconds")
          .min(1, "CAMUNDA_REQUEST_TIMEOUT_MS must be at least 1 ms")
          .max(MAX_TIMEOUT_MS, `CAMUNDA_REQUEST_TIMEOUT_MS must be at most ${MAX_TIMEOUT_MS} ms`),
      )
      .optional(),
    incidentIssueRepository: z
      .string()
      .regex(/^[^/\s]+\/[^/\s]+$/, "Expected `owner/repo`")
      .optional(),
    healthThresholds: z
      .object({
        criticalIncidents: z.coerce.number().int().positive().optional(),
        criticalClusterSize: z.coerce.number().int().positive().optional(),
      })
      .optional(),
  })
  // Global credentials are only the fallback for engines without their own `auth`.
  .refine(
    (c) =>
      c.authType !== "basic" || c.engines.every((e) => e.auth) || Boolean(c.username && c.password),
    {
      message:
        "CAMUNDA_AUTH_TYPE=basic requires CAMUNDA_USERNAME and CAMUNDA_PASSWORD (unless every engine carries its own auth) — otherwise engine requests would silently run unauthenticated",
    },
  )
  .refine((c) => c.authType !== "bearer" || c.engines.every((e) => e.auth) || Boolean(c.token), {
    message:
      "CAMUNDA_AUTH_TYPE=bearer requires CAMUNDA_TOKEN (unless every engine carries its own auth) — otherwise engine requests would silently run unauthenticated",
  })
  // A duplicate id would silently route both entries' traffic to one of them.
  .refine((c) => new Set(c.engines.map((e) => e.id)).size === c.engines.length, {
    message:
      "Engine ids must be unique across all environments — the id is the per-call `engine` selector and the join key against the metrics' engine_id label",
  })

/** End index of the JSON string literal opening at `openQuote` (escape-aware). */
function scanJsonString(text: string, openQuote: number): number {
  let j = openQuote + 1
  while (j < text.length && text[j] !== '"') {
    if (text[j] === "\\") j++
    j++
  }
  return j
}

/**
 * JSON.parse keeps the last duplicate, so a repeated environment key would silently
 * drop a block of engines. Only depth-1 keys count: entries repeat "id" by design.
 */
function assertUniqueTopLevelKeys(rawText: string): void {
  if (!rawText.trimStart().startsWith("{")) return
  const seen = new Set<string>()
  let depth = 0
  let i = 0
  while (i < rawText.length) {
    const c = rawText[i]
    if (c === '"') {
      const j = scanJsonString(rawText, i)
      const key = rawText.slice(i + 1, j)
      let k = j + 1
      while (k < rawText.length && /\s/.test(rawText[k])) k++
      if (depth === 1 && rawText[k] === ":") {
        if (seen.has(key)) {
          throw new Error(
            `Engine config: duplicate environment key "${key}" — JSON keeps only the LAST duplicate, silently dropping the other block's engines. Merge the blocks into one array.`,
          )
        }
        seen.add(key)
      }
      i = j + 1
      continue
    }
    if (c === "{" || c === "[") depth++
    else if (c === "}" || c === "]") depth--
    i++
  }
}

/**
 * Accepts the array form or the map form `{"prod-eu": [{id, baseUrl}]}`, whose keys
 * are stamped as `environment`. A contradicting per-entry `environment` is an error.
 */
function normalizeEnginesConfig(raw: unknown): unknown {
  if (Array.isArray(raw) || typeof raw !== "object" || raw === null) return raw
  return Object.entries(raw).flatMap(([environment, engines]) => {
    if (!Array.isArray(engines)) {
      throw new Error(
        `Engine config environment "${environment}" must map to an ARRAY of engine entries — got ${typeof engines}. Environment-map form: {"<environment>": [{id, baseUrl, …}, …], …}.`,
      )
    }
    return engines.map((engine: unknown) => {
      if (engine && typeof engine === "object") {
        const own = (engine as { environment?: unknown }).environment
        if (own !== undefined && own !== environment) {
          throw new Error(
            `Engine config: entry under environment "${environment}" carries a contradicting environment ${JSON.stringify(own)} — drop the per-entry field or move the entry.`,
          )
        }
        return { ...engine, environment }
      }
      return engine
    })
  })
}

/** A config that does not load names none: the boot fails on it with its own error. */
function passthroughEngineIds(env: NodeJS.ProcessEnv): string[] {
  let engines: unknown
  try {
    engines = loadEnginesFromEnv(env)
  } catch {
    return []
  }
  if (!Array.isArray(engines)) return []
  const fallback = env.CAMUNDA_AUTH_TYPE?.trim()
  return engines.flatMap((engine: unknown) => {
    const { id, auth } = (engine ?? {}) as { id?: unknown; auth?: { type?: unknown } }
    return (auth?.type ?? fallback) === "passthrough" && typeof id === "string" ? [id] : []
  })
}

/**
 * Precedence: CAMUNDA_ENGINES_FILE > CAMUNDA_ENGINES_JSON > CAMUNDA_BASE_URL > the local default engine.
 * CAMUNDA_ENGINE_ID exists because the id is the join key against the metrics'
 * `engine_id`: a mismatch reads as "no data", not as a config error.
 */
function loadEnginesFromEnv(env: NodeJS.ProcessEnv): unknown {
  const filePath = env.CAMUNDA_ENGINES_FILE?.trim()
  if (filePath) {
    const raw = fs.readFileSync(filePath, "utf8")
    assertUniqueTopLevelKeys(raw)
    return normalizeEnginesConfig(JSON.parse(raw))
  }
  const json = env.CAMUNDA_ENGINES_JSON?.trim()
  if (json) {
    assertUniqueTopLevelKeys(json)
    return normalizeEnginesConfig(JSON.parse(json))
  }
  const id = env.CAMUNDA_ENGINE_ID?.trim() || "default"
  const flavor = engineFlavorFromEnv(env)
  const shorthand = { id, ...(flavor ? { flavor } : {}) }
  const baseUrl = env.CAMUNDA_BASE_URL?.trim()
  if (baseUrl) {
    return [
      {
        ...shorthand,
        baseUrl,
        ...(env.CAMUNDA_COCKPIT_URL ? { cockpitUrl: env.CAMUNDA_COCKPIT_URL } : {}),
      },
    ]
  }
  return [{ ...shorthand, baseUrl: "http://localhost:8410/engine-rest" }]
}

/** Not validated here: the schema's `flavor` enum fails the boot on an unknown vendor. */
function engineFlavorFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  return env.CAMUNDA_ENGINE_FLAVOR?.trim() || undefined
}

/** Shared by arming and disclosing, so a padded "true" never arms deployments silently. */
function allowDeploymentsFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  return env.CAMUNDA_ALLOW_DEPLOYMENTS?.trim() || undefined
}

export const camunda7Module = {
  name: "camunda7",

  /** Pure env → raw-config mapping; validation happens in `createPlugin`. */
  configFromEnv(env: NodeJS.ProcessEnv): Record<string, unknown> {
    return {
      engines: loadEnginesFromEnv(env),
      authType: env.CAMUNDA_AUTH_TYPE,
      username: env.CAMUNDA_USERNAME,
      password: env.CAMUNDA_PASSWORD,
      token: env.CAMUNDA_TOKEN,
      incidentIssueRepository: env.CAMUNDA_INCIDENT_ISSUE_REPO,
      allowDeployments: allowDeploymentsFromEnv(env),
      requestTimeoutMs: env.CAMUNDA_REQUEST_TIMEOUT_MS?.trim() || undefined,
      ...(env.CAMUNDA_HEALTH_CRITICAL_INCIDENTS || env.CAMUNDA_HEALTH_CRITICAL_CLUSTER_SIZE
        ? {
            healthThresholds: {
              criticalIncidents: env.CAMUNDA_HEALTH_CRITICAL_INCIDENTS,
              criticalClusterSize: env.CAMUNDA_HEALTH_CRITICAL_CLUSTER_SIZE,
            },
          }
        : {}),
    }
  },

  knownEnvVars: [
    "CAMUNDA_ENGINES_FILE",
    "CAMUNDA_ENGINES_JSON",
    "CAMUNDA_BASE_URL",
    "CAMUNDA_ENGINE_ID",
    "CAMUNDA_ENGINE_FLAVOR",
    "CAMUNDA_COCKPIT_URL",
    "CAMUNDA_AUTH_TYPE",
    "CAMUNDA_USERNAME",
    "CAMUNDA_PASSWORD",
    "CAMUNDA_TOKEN",
    "CAMUNDA_INCIDENT_ISSUE_REPO",
    "CAMUNDA_HEALTH_CRITICAL_INCIDENTS",
    "CAMUNDA_HEALTH_CRITICAL_CLUSTER_SIZE",
    "CAMUNDA_ALLOW_DEPLOYMENTS",
    "CAMUNDA_REQUEST_TIMEOUT_MS",
  ] as const,

  toolsets: camunda7Toolsets,

  bootWarnings(env: NodeJS.ProcessEnv): string[] {
    const warnings: string[] = []
    const configured =
      env.CAMUNDA_ENGINES_FILE?.trim() ||
      env.CAMUNDA_ENGINES_JSON?.trim() ||
      env.CAMUNDA_BASE_URL?.trim()
    if (!configured) {
      const id = env.CAMUNDA_ENGINE_ID?.trim() || "default"
      const flavor = engineFlavorFromEnv(env) ?? DEFAULT_ENGINE_FLAVOR
      warnings.push(
        `No engine is configured (CAMUNDA_ENGINES_FILE / CAMUNDA_ENGINES_JSON / CAMUNDA_BASE_URL) — defaulting to http://localhost:8410/engine-rest with engine id "${id}". That id is the join key against the metrics' engine_id label: engine-scoped analytics return empty when it does not match the ENGINE_ID the engine stamps (the repo's Compose stack stamps "prod-a" — set CAMUNDA_ENGINE_ID to match). Its cockpit links and name follow flavor "${flavor}"; the Compose engine is CIB seven (CAMUNDA_ENGINE_FLAVOR=cibseven).`,
      )
    }
    const passthrough = passthroughEngineIds(env)
    if (passthrough.length > 0) {
      warnings.push(
        `Passthrough auth on ${passthrough.map((id) => `"${id}"`).join(", ")}: each caller's MCP bearer token goes to the engine unchanged. Only for a trusted single-audience setup — the engine must accept a token minted for this MCP server, and anyone who sees it there can replay it against this server and every other passthrough engine. Elsewhere give the engine its own basic or bearer credentials.`,
      )
    }
    if (allowDeploymentsFromEnv(env) === "true") {
      warnings.push(
        "CAMUNDA_ALLOW_DEPLOYMENTS=true — camunda7_create_deployment is registered under camunda7:admin. Deploying a process runs code inside the engine JVM (expressions, scripts and listener/delegate references execute with the engine's privileges): grant camunda7:admin only to callers you would trust with that.",
      )
    }
    return warnings
  },

  /** Offers saving a default only under OAuth: without it no request has a caller identity (#331). */
  instructions(config: Record<string, unknown>, { authenticated }: { authenticated: boolean }) {
    const parsed = camunda7ConfigSchema.parse(config)
    const toolset = camunda7Toolsets.resolve(parsed.toolset)
    return camunda7Instructions({
      engineIds: parsed.engines.map((e) => e.id),
      canSaveDefault: authenticated && allowsProfileSave(toolset),
      toolset,
    })
  },

  createPlugin(
    config: Record<string, unknown>,
    shared: Camunda7SharedResources,
  ): AppPlugin<MCPServer> {
    return createPlugin(camunda7ConfigSchema.parse(config), { profileStore: shared.profileStore })
  },
}

/**
 * Lets analytics read BPMN XML without the engine SDK (omitted `engineId`: the first engine).
 * `null` means not deployed; a failed read or an unknown engine REJECTS, so a failure
 * never reads as "not deployed".
 */
export function createBpmnXmlFetcher(
  config: Record<string, unknown>,
): ((processDefinitionKey: string, engineId?: string) => Promise<string | null>) | undefined {
  const parsed = camunda7ConfigSchema.parse(config)
  const clients = new Map<string, Client>()

  function clientFor(entry: (typeof parsed.engines)[number]): Client {
    const known = clients.get(entry.id)
    if (known) return known
    const auth = entry.auth ?? {
      type: parsed.authType,
      username: parsed.username,
      password: parsed.password,
      token: parsed.token,
    }
    const client = providerForEntry(entry).createClient(entry, auth, {
      timeoutMs: parsed.requestTimeoutMs,
    })
    clients.set(entry.id, client)
    return client
  }

  return async (processDefinitionKey, engineId) => {
    const entry =
      engineId === undefined ? parsed.engines[0] : parsed.engines.find((e) => e.id === engineId)
    if (!entry) throw new Error(`No engine "${engineId}" is configured.`)
    return fetchLatestDefinitionXml(clientFor(entry), processDefinitionKey)
  }
}
