/**
 * A boot config error names the variable to fix, and in an engine list the entry, never the
 * schema's own path: `ENGINES_JSON[0].id: …`, `ENGINE_BASE_URL: …`, every issue on one line.
 */

/** Where the engine list came from: the single-engine shorthand, or a JSON list. */
export type EngineListOrigin =
  | { kind: "shorthand" }
  | {
      kind: "list"
      /** `ENGINES_JSON`, or `ENGINES_FILE=<path>`. */
      variable: string
      /** Entry i of the normalized list as written, e.g. `ENGINES_JSON["prod-eu"][0]`. */
      entries: readonly string[]
    }

/** The engine list as loaded (not yet checked) and where it came from. */
export interface EngineSource {
  engines: unknown
  origin: EngineListOrigin
}

/**
 * A JSON list's origin: each entry's place as written, `[1]`, or `["prod-eu"][0]` in the
 * environment-map form, in the order `normalizeEnginesConfig` flattens it. `shown` quotes an
 * environment key, or hides one that is not an id.
 */
export function listOrigin(
  raw: unknown,
  variable: string,
  separator: string,
  shown: (key: string) => string,
): EngineListOrigin {
  const places = Array.isArray(raw)
    ? raw.map((_, i) => `[${i}]`)
    : Object.entries(typeof raw === "object" && raw !== null ? raw : {}).flatMap(
        ([environment, engines]) =>
          Array.isArray(engines) ? engines.map((_, j) => `[${shown(environment)}][${j}]`) : [],
      )
  return { kind: "list", variable, entries: places.map((place) => variable + separator + place) }
}

interface ConfigIssue {
  path: readonly PropertyKey[]
  message: string
}

/** The variable behind each top-level setting (dotted for the nested ones). */
const SETTINGS: Readonly<Record<string, string>> = {
  authType: "ENGINE_AUTH_TYPE",
  username: "ENGINE_USERNAME",
  password: "ENGINE_PASSWORD",
  token: "ENGINE_TOKEN",
  defaultEngine: "ENGINE_DEFAULT",
  allowDeployments: "ENGINE_ALLOW_DEPLOYMENTS",
  requestTimeoutMs: "ENGINE_REQUEST_TIMEOUT_MS",
  incidentIssueRepository: "ENGINE_INCIDENT_ISSUE_REPO",
  "healthThresholds.criticalIncidents": "ENGINE_HEALTH_CRITICAL_INCIDENTS",
  "healthThresholds.criticalClusterSize": "ENGINE_HEALTH_CRITICAL_CLUSTER_SIZE",
}

/** The variable behind each field of the one engine the shorthand (or the default) builds. */
const SHORTHAND: Readonly<Record<string, string>> = {
  id: "ENGINE_ID",
  baseUrl: "ENGINE_BASE_URL",
  cockpitUrl: "ENGINE_COCKPIT_URL",
  flavor: "ENGINE_FLAVOR",
}

/** `["auth", "type"]` → `.auth.type`. */
function fieldPath(path: readonly PropertyKey[]): string {
  return path.map((key) => (typeof key === "number" ? `[${key}]` : `.${String(key)}`)).join("")
}

function placeOf(path: readonly PropertyKey[], origin: EngineListOrigin): string | undefined {
  if (path[0] !== "engines") return SETTINGS[path.map(String).join(".")]
  const [, index, ...field] = path
  if (origin.kind === "shorthand") return SHORTHAND[String(field[0])] ?? "ENGINE_BASE_URL"
  if (typeof index !== "number") return origin.variable
  return `${origin.entries[index] ?? `${origin.variable} entry ${index}`}${fieldPath(field)}`
}

/** One line: each issue behind the variable it came from, unless its message names it already. */
export function engineConfigErrorText(
  issues: readonly ConfigIssue[],
  origin: EngineListOrigin,
): string {
  const lines = issues.map(({ path, message }) => {
    const place = placeOf(path, origin)
    return place === undefined || message.startsWith(place) ? message : `${place}: ${message}`
  })
  return [...new Set(lines)].join("; ")
}
