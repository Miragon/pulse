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

/**
 * Self-contained module definition for host apps: config schema, env mapping,
 * and known env vars live HERE, next to the plugin they configure — the app
 * only selects modules and wires cross-module resources. Conforms structurally
 * to the app's `ModuleDefinition` port — no import of the app.
 */

// Incomplete credentials must fail the boot, not silently degrade to
// unauthenticated engine requests — a typo'd CAMUNDA_USERNAME would otherwise
// only surface as engine 401s (or go unnoticed against an auth-less engine).
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
  /**
   * Environment this engine's service runs in — a grouping level for the
   * two-stage environment→engine selection, never part of the engine identity
   * (`id` stays the flat join key against the metrics' `engine_id` label).
   */
  environment: z
    .string()
    .min(1)
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      "Environment id must be lowercase alphanumeric / dashes, starting with a letter or digit",
    )
    // A purely numeric id would be an array-index-like JSON key, which JS
    // object enumeration reorders FIRST — silently breaking the "pickers list
    // environments in config order" contract and shifting engines[0] (the
    // BPMN-XML source engine). Reject it loudly instead.
    .regex(/^(?!\d+$)/, "Environment id must not be purely numeric")
    .optional(),
  /**
   * Engine vendor of the C7 dialect (selects the provider). Default: "camunda7".
   * The single-engine shorthand takes it from CAMUNDA_ENGINE_FLAVOR.
   */
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
    // CAMUNDA_ALLOW_DEPLOYMENTS — parsed STRICTLY: deploy permission is code
    // execution inside the engine JVM, so anything but "true"/"false" fails
    // the boot loudly instead of guessing (z.coerce.boolean would even read
    // "false" as true). Optional: unset = off; createBpmnXmlFetcher parses
    // the same schema.
    allowDeployments: z
      .enum(["true", "false"], {
        error: 'CAMUNDA_ALLOW_DEPLOYMENTS must be exactly "true" or "false" (or unset)',
      })
      .optional()
      .transform((v) => v === "true"),
    // CAMUNDA_REQUEST_TIMEOUT_MS — per-request engine deadline. Strict like
    // the flag above: a typo ("30s", "3e4") fails the boot instead of being
    // coerced into some other deadline. Unset = the client default (30 s).
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
  // The global credentials are only the fallback for engines without their
  // own `auth` — when every engine carries one, don't demand them.
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
  // Engine ids must be unique ACROSS environments: the id is the flat join key
  // against the metrics' engine_id label and the per-call `engine` override —
  // a duplicate would silently route both entries' traffic to one of them.
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
 * Rejects duplicate top-level keys in the environment-map JSON text. JSON.parse
 * resolves duplicates last-wins BEFORE any consumer can see them, so a repeated
 * environment key (a classic hand-edited-ConfigMap slip) would silently drop a
 * whole block of engines — the boot would succeed with fewer engines and the
 * only symptom would be stale defaults failing soft. Only depth-1 keys count:
 * engine entries repeat "id"/"baseUrl" per engine by design.
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
 * Normalizes the two accepted engine-config JSON forms to the flat entry list
 * the config schema validates:
 *   - Array form: `[{id, baseUrl, environment?, …}, …]` — passed through.
 *   - Environment-map form: `{"prod-eu": [{id, baseUrl, …}, …], …}` — each key
 *     is an environment id stamped onto its entries' `environment` field.
 *
 * The map form is the "pick an environment, then an engine" configuration
 * shape: environments hold services, and the services that carry an engine are
 * listed under their environment. A per-entry `environment` inside a map value
 * that contradicts its key is a config error — silently preferring either side
 * would misfile the engine in every picker.
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

/**
 * The configured engines that forward each caller's MCP token (their own
 * `auth`, else `CAMUNDA_AUTH_TYPE`). A config that does not load names none:
 * the boot fails on it with its own error.
 */
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
 * Resolves the engine list from environment in this order of precedence:
 *   1. `CAMUNDA_ENGINES_FILE` — path to a JSON document (preferred at scale; fits ConfigMap workflows).
 *   2. `CAMUNDA_ENGINES_JSON` — inline JSON.
 *   3. `CAMUNDA_BASE_URL` (+ `CAMUNDA_COCKPIT_URL`) — the single-engine shorthand
 *      (the quick-start path), synthesized as `id: CAMUNDA_ENGINE_ID ?? "default"`
 *      and, when set, `flavor: CAMUNDA_ENGINE_FLAVOR`.
 *
 * Both JSON sources accept the flat array form and the environment-map form
 * (see [[normalizeEnginesConfig]]). Falls back to the local default engine
 * (`http://localhost:8410/engine-rest`) when nothing is set.
 *
 * `CAMUNDA_ENGINE_ID` exists because the engine id is a JOIN KEY, not a label:
 * the metrics plugin stamps its own `ENGINE_ID` onto every series as
 * `engine_id`, and every analytics query scoped to an engine (the cockpit's
 * BPMN heatmap, engine compare, …) matches on it. Without a way to name the
 * single-engine shorthand, the only alignment option was switching to the JSON
 * form — and a mismatch reads as "no data", not as a config error.
 * `CAMUNDA_ENGINE_FLAVOR` names the shorthand's vendor for the same reason: an
 * engine without a `flavor` is Camunda 7, so a CIB seven or Operaton engine
 * would otherwise need the JSON form to get its own cockpit links and name.
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

/**
 * CAMUNDA_ENGINE_FLAVOR as the shorthand reads it — trimmed, empty = unset —
 * shared by `loadEnginesFromEnv` (the engine entry) and `bootWarnings` (the
 * zero-config disclosure). Not validated here: the config schema's `flavor`
 * enum fails the boot on an unknown vendor.
 */
function engineFlavorFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  return env.CAMUNDA_ENGINE_FLAVOR?.trim() || undefined
}

/**
 * CAMUNDA_ALLOW_DEPLOYMENTS as the module reads it — trimmed, empty = unset —
 * shared by `configFromEnv` (what arms the tool) and `bootWarnings` (what
 * discloses it), so a padded "true" can never arm deployments silently.
 */
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
      // Only trimmed (empty = unset, like the other CAMUNDA_* vars — e.g. a
      // compose `${CAMUNDA_ALLOW_DEPLOYMENTS:-}`); the schema rejects anything
      // but "true"/"false".
      allowDeployments: allowDeploymentsFromEnv(env),
      requestTimeoutMs: env.CAMUNDA_REQUEST_TIMEOUT_MS?.trim() || undefined,
      // Engine-health verdict thresholds — only forwarded when set, so the
      // module's defaults apply otherwise.
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

  /** This module's slice of the app's unknown-env-var typo warner. */
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

  /**
   * The toolset vocabulary — the composition root resolves ONE concrete
   * toolset per boot with it (fail-closed: `read-only` without a suffix on an
   * unauthenticated boot, `operations` under OAuth, `read-only` for an empty
   * or unknown suffix; `admin` only when named) and threads it into
   * `config.toolset`.
   */
  toolsets: camunda7Toolsets,

  /**
   * Boot-time hints for active deployments:
   *
   * - With no engine env at all the module silently falls back to
   *   `http://localhost:8410/engine-rest` — which reaches the repo's Compose
   *   engine, so BPM tools work while engine-scoped analytics (heatmap,
   *   engine compare) join on a mismatched `engine_id` and read as "no data",
   *   not as a config error, and its cockpit links follow the default flavor
   *   (Camunda 7) although the Compose engine is CIB seven. Mirrors the
   *   analytics module's PROMETHEUS_URL warning.
   * - `CAMUNDA_ALLOW_DEPLOYMENTS=true` arms code execution inside the engine
   *   JVM for every `camunda7:admin` caller — stated on every boot.
   */
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

  /**
   * The module's server-instructions snippet for this boot: the engine
   * routing rule over the CONFIGURED ids (the `engine` parameter itself only
   * carries a one-line description), the date format, the tool families and
   * the health routing. Offers saving a default only when a caller can: the
   * toolset registers the save AND OAuth is installed — without OAuth no
   * request has a caller identity (#331), so the save would refuse and
   * ENGINE_NOT_SELECTED does not offer it either.
   */
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
 * Builds an engine-agnostic BPMN-XML lookup from this module's raw config —
 * the piece other modules (analytics' heatmap and the names in its views)
 * consume via injection instead of depending on the engine SDK. Reads on the
 * configured engine `engineId` names (omitted: the FIRST configured engine),
 * with the same per-engine-auth-wins precedence as the plugin's registry
 * clients (one client per engine, made on its first read; under passthrough
 * auth each read carries the current caller's token). The diagram is the
 * definition view's: the key's latest version over every tenant, read by id
 * (`fetchLatestDefinitionXml`). Resolves `null` when that engine has no such
 * definition; a failed read (unreachable, timed out, refused) and an engine
 * id that is not configured REJECT, so the consumer never mistakes a failure
 * for "not deployed" (it degrades on its own: the heatmap draws no diagram,
 * the views show ids).
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
    // Same client construction (incl. passthrough semantics) as the plugin's
    // registry clients — via the entry's vendor provider.
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
