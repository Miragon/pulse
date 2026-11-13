import { z } from "zod"
import { MAX_TIMEOUT_MS, PROFILE_NAME } from "@miragon/pulse-profile"
import type { ModulePlugin } from "@miragon/pulse-widget-shell/server"
import { createPlugin } from "./plugin.js"
import { DEFAULT_ENGINE_FLAVOR } from "./providers/index.js"
import { engineToolsets } from "./lib/mcp/toolsets.js"
import { engineInstructions } from "./instructions.js"
import { engineConfigErrorText } from "./engine-config-error.js"
import type { EngineEntry } from "./engine-provider.js"
import {
  type EngineProfiles,
  hasProfileFile,
  LOCAL_ENGINE_URL,
  loadEngineProfiles,
  referencedVariables,
  SINGLE_ENGINE_VARIABLES,
} from "./engine-profiles.js"
import type { RefusedProfile } from "./lib/engine/resolve-engine.js"

const TIMEOUT_ERROR = "ENGINE_REQUEST_TIMEOUT_MS must be a whole number of milliseconds"

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

/** A usable profile as `loadEngineProfiles` mapped it: checked there, so only its shape here. */
const engineEntry = z.custom<EngineEntry>(
  (value) => isObject(value) && typeof value.id === "string" && typeof value.baseUrl === "string",
  "Expected an engine entry: an id and the baseUrl of its REST API root",
)

/** A refused profile: its id and the reason for the model, never anything of the profile else. */
const refusedEngine = z.custom<RefusedProfile>(
  (value) => isObject(value) && typeof value.id === "string" && typeof value.reason === "string",
  "Expected a refused engine: its id and the reason",
)

/**
 * A config error names a value only when it has the shape of a lower-case id: anything else may
 * be a credential pasted into the wrong place.
 */
const SHOWN_VALUE = /^[a-z0-9][a-z0-9._-]{0,63}$/

/** Every configured engine id, refused ones included, in the order of the profiles. */
function configuredIds(c: {
  engines: readonly EngineEntry[]
  refused?: readonly RefusedProfile[]
  engineIds?: readonly string[]
}): readonly string[] {
  return c.engineIds ?? [...c.engines.map((e) => e.id), ...(c.refused ?? []).map((r) => r.id)]
}

export const engineConfigSchema = z
  .object({
    engines: z.array(engineEntry).min(1, "Names no engine"),
    /** Profiles the server refused: engine_list_engines lists them, a call to one fails. */
    refused: z.array(refusedEngine).optional(),
    /** Every profile name, refused ones included, in the order of the file: the `engine` enum. */
    engineIds: z.array(z.string()).optional(),
    /** Every profile, refused and nameless ones included: one alone is the default. */
    profileCount: z.number().int().positive().optional(),
    /** `ENGINE_DEFAULT`, else the file's `defaultProfile`. */
    defaultEngine: z.string().optional(),
    toolset: z.string().optional(),
    // Strict: deploying is code execution in the engine JVM (z.coerce.boolean reads "false" as true).
    allowDeployments: z
      .enum(["true", "false"], {
        error: 'ENGINE_ALLOW_DEPLOYMENTS must be exactly "true" or "false" (or unset)',
      })
      .optional()
      .transform((v) => v === "true"),
    // Strict: a typo ("30s", "3e4") fails the boot instead of becoming another deadline.
    requestTimeoutMs: z
      // Without its own error a union that matches no branch says only "Invalid input".
      .union([z.number(), z.string().regex(/^\d+$/, TIMEOUT_ERROR).transform(Number)], {
        error: TIMEOUT_ERROR,
      })
      .pipe(
        z
          .number()
          .int(TIMEOUT_ERROR)
          .min(1, "ENGINE_REQUEST_TIMEOUT_MS must be at least 1 ms")
          .max(MAX_TIMEOUT_MS, `ENGINE_REQUEST_TIMEOUT_MS must be at most ${MAX_TIMEOUT_MS} ms`),
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
  // No quotes around the ids: ZodError.message is the issues JSON, which would escape them.
  .superRefine((c, issues) => {
    const ids = configuredIds(c)
    if (c.defaultEngine !== undefined && !ids.includes(c.defaultEngine)) {
      const shown = (id: string, pattern: RegExp) =>
        pattern.test(id) ? id : "(not shown: not an id)"
      issues.addIssue({
        code: "custom",
        path: ["defaultEngine"],
        message: `ENGINE_DEFAULT=${shown(c.defaultEngine, SHOWN_VALUE)} names no configured engine (configured: ${ids.map((id) => shown(id, PROFILE_NAME)).join(", ")}).`,
      })
    }
  })

/** Checked at the mapping, so a bad setting fails the boot before it logs the toolsets. */
function checkedConfig(config: Record<string, unknown>) {
  const checked = engineConfigSchema.safeParse(config)
  if (!checked.success) throw new Error(engineConfigErrorText(checked.error.issues))
  return config
}

/** Shared by arming and disclosing, so a padded "true" never arms deployments silently. */
function allowDeploymentsFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  return env.ENGINE_ALLOW_DEPLOYMENTS?.trim() || undefined
}

/** The profiles, or none when they do not load: the boot fails on them with its own error. */
function profilesQuietly(env: NodeJS.ProcessEnv): EngineProfiles | undefined {
  try {
    return loadEngineProfiles(env)
  } catch {
    return undefined
  }
}

/** The single engine's settings a profile file makes meaningless. */
function ignoredSingleEngineWarning(env: NodeJS.ProcessEnv): string[] {
  if (!hasProfileFile(env)) return []
  const ignored = SINGLE_ENGINE_VARIABLES.filter((name) => env[name]?.trim())
  if (ignored.length === 0) return []
  const source = env.ENGINES_FILE?.trim() ? "ENGINES_FILE" : "ENGINES_JSON"
  return [
    `${ignored.join(", ")} ${ignored.length === 1 ? "is" : "are"} set next to ${source} and ignored: they describe the single engine, which a profile file replaces. A profile states its own url and auth, for example {"url": "…", "auth": {"type": "basic", "username": "…", "passwordEnv": "ENGINE_SECRET_PASSWORD"}}.`,
  ]
}

/** What the profiles tell the operator: refusals, a default that leads to one, passthrough. */
function profileWarnings(env: NodeJS.ProcessEnv): string[] {
  const profiles = profilesQuietly(env)
  if (profiles === undefined) return []
  const warnings = [...profiles.warnings]
  const explicit = env.ENGINE_DEFAULT?.trim()
  const fallback = explicit || profiles.defaultProfile
  if (profiles.refused.some(({ id }) => id === fallback)) {
    warnings.push(
      `${explicit ? "ENGINE_DEFAULT" : "defaultProfile"} names "${String(fallback)}", whose profile is refused: a call without engine fails with ENGINE_PROFILE_REFUSED until the profile is fixed, and never goes to another engine.`,
    )
  }
  const passthrough = profiles.engines.filter((e) => e.auth?.type === "passthrough")
  if (passthrough.length > 0) {
    warnings.push(
      `Passthrough auth on ${passthrough.map(({ id }) => `"${id}"`).join(", ")}: each caller's MCP bearer token goes to the engine unchanged. Only for a trusted single-audience setup: the engine must accept a token minted for this MCP server, and anyone who sees it there can replay it against this server and every other passthrough engine. Elsewhere give the engine its own basic or bearer credentials.`,
    )
  }
  return warnings
}

export const engineModule = {
  name: "engine",

  /** Env → raw config, checked against the schema here; `createPlugin` parses it again. */
  configFromEnv(env: NodeJS.ProcessEnv): Record<string, unknown> {
    const profiles = loadEngineProfiles(env)
    const config = {
      engines: profiles.engines,
      refused: profiles.refused,
      engineIds: profiles.engineIds,
      profileCount: profiles.profileCount,
      defaultEngine: env.ENGINE_DEFAULT?.trim() || profiles.defaultProfile,
      incidentIssueRepository: env.ENGINE_INCIDENT_ISSUE_REPO,
      allowDeployments: allowDeploymentsFromEnv(env),
      requestTimeoutMs: env.ENGINE_REQUEST_TIMEOUT_MS?.trim() || undefined,
      ...(env.ENGINE_HEALTH_CRITICAL_INCIDENTS || env.ENGINE_HEALTH_CRITICAL_CLUSTER_SIZE
        ? {
            healthThresholds: {
              criticalIncidents: env.ENGINE_HEALTH_CRITICAL_INCIDENTS,
              criticalClusterSize: env.ENGINE_HEALTH_CRITICAL_CLUSTER_SIZE,
            },
          }
        : {}),
    }
    return checkedConfig(config)
  },

  knownEnvVars: [
    "ENGINES_FILE",
    "ENGINES_JSON",
    "ENGINE_BASE_URL",
    "ENGINE_ID",
    "ENGINE_FLAVOR",
    "ENGINE_DEFAULT",
    "ENGINE_COCKPIT_URL",
    "ENGINE_AUTH_TYPE",
    "ENGINE_USERNAME",
    "ENGINE_PASSWORD",
    "ENGINE_TOKEN",
    "ENGINE_INCIDENT_ISSUE_REPO",
    "ENGINE_HEALTH_CRITICAL_INCIDENTS",
    "ENGINE_HEALTH_CRITICAL_CLUSTER_SIZE",
    "ENGINE_ALLOW_DEPLOYMENTS",
    "ENGINE_REQUEST_TIMEOUT_MS",
  ] as const,

  /** The ENGINE_SECRET_ variables the profiles name: the server reads them, so they are no typo. */
  referencedEnvVars(env: NodeJS.ProcessEnv): readonly string[] {
    return referencedVariables(env)
  },

  toolsets: engineToolsets,

  bootWarnings(env: NodeJS.ProcessEnv): string[] {
    const warnings: string[] = []
    if (!hasProfileFile(env) && !env.ENGINE_BASE_URL?.trim()) {
      const id = env.ENGINE_ID?.trim() || "default"
      const flavor = env.ENGINE_FLAVOR?.trim() || DEFAULT_ENGINE_FLAVOR
      warnings.push(
        `No engine is configured (ENGINES_FILE / ENGINES_JSON / ENGINE_BASE_URL): defaulting to ${LOCAL_ENGINE_URL} with engine id "${id}", where the Pulse starter's compose.yaml (Miragon/pulse-starter) and the Pulse playground (Miragon/pulse) serve their engine. Its cockpit links and name follow flavor "${flavor}"; both of those engines are CIB seven (ENGINE_FLAVOR=cibseven), and the starter's asks for a login (ENGINE_AUTH_TYPE=basic, demo/demo).`,
      )
    }
    warnings.push(...ignoredSingleEngineWarning(env), ...profileWarnings(env))
    if (allowDeploymentsFromEnv(env) === "true") {
      warnings.push(
        "ENGINE_ALLOW_DEPLOYMENTS=true: engine_create_deployment is registered under engine:admin. Deploying a process runs code inside the engine JVM (expressions, scripts and listener/delegate references execute with the engine's privileges): grant engine:admin only to callers you would trust with that.",
      )
    }
    return warnings
  },

  instructions(config: Record<string, unknown>) {
    const parsed = engineConfigSchema.parse(config)
    return engineInstructions({
      engineIds: configuredIds(parsed),
      profileCount: parsed.profileCount,
      defaultEngine: parsed.defaultEngine,
      toolset: engineToolsets.resolve(parsed.toolset),
    })
  },

  createPlugin(config: Record<string, unknown>): ModulePlugin {
    return createPlugin(engineConfigSchema.parse(config))
  },
}
