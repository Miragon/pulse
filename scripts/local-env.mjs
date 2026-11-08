/**
 * The playground stack as scripts/local.mjs sees it: its services, ports and URLs, the settings
 * the server and the CLI get against it, and who holds a port (pure;
 * scripts/local-env.test.mjs).
 */

export const COMPOSE_FILE = "playground/docker/docker-compose.yml"

/** The `name:` of the Compose file: a stack started by hand runs under it too. */
export const COMPOSE_PROJECT = "pulse"

/**
 * The stack's services. `probe` answers 200 once the service is ready (asked on 127.0.0.1: the
 * stack binds only there), `ports` are every host port it publishes, `profile` the Compose
 * profile that adds it. `waitFor: false`: shown by stack:status, not waited for.
 */
export const SERVICES = [
  {
    id: "engine",
    ports: [8410],
    probe: "http://127.0.0.1:8410/engine-rest/engine",
    url: "http://localhost:8410/webapp",
    note: "REST http://localhost:8410/engine-rest, login demo / demo",
  },
  {
    id: "engine-b",
    profile: "multi-engine",
    ports: [8411],
    probe: "http://127.0.0.1:8411/engine-rest/engine",
    url: "http://localhost:8411/webapp",
    note: "second engine, login demo / demo",
  },
  {
    id: "keycloak",
    profile: "auth",
    ports: [8480],
    probe: "http://127.0.0.1:8480/realms/miragon",
    url: "http://localhost:8480",
    note: "realm miragon, user demo / demo, admin console admin / admin",
  },
]

/** The MCP server's port when PORT is unset (the `dev` script's default and `.mcp.json`'s). */
export const DEFAULT_SERVER_PORT = 8400

/** What answers 200 once the MCP server serves (and 503 while it drains). */
export const SERVER_READY_PATH = "/health/ready"

/**
 * The ports the official MCP inspector (the server app's `dev:inspector`) listens on, all on
 * 127.0.0.1, as `{ variable, port, fromEnv }`: its web UI, the MCP Apps sandbox and the origin
 * the apps run under. Each comes from the inspector's own variable, else its default; the
 * sandbox falls back to SERVER_PORT first, as the inspector does.
 */
export function inspectorPorts(env) {
  const read = (...names) => {
    const name = names.find((candidate) => /^\d+$/.test(env[candidate]?.trim() ?? ""))
    return name === undefined ? undefined : Number(env[name].trim())
  }
  return [
    { variable: "CLIENT_PORT", port: read("CLIENT_PORT"), fallback: 6274 },
    { variable: "MCP_SANDBOX_PORT", port: read("MCP_SANDBOX_PORT", "SERVER_PORT"), fallback: 6275 },
    { variable: "MCP_APP_ORIGIN_PORT", port: read("MCP_APP_ORIGIN_PORT"), fallback: 6278 },
  ].map(({ variable, port, fallback }) => ({
    variable,
    port: port ?? fallback,
    fromEnv: port !== undefined,
  }))
}

/** The inspector's web UI on `port`, signed in with `token` (its MCP_INSPECTOR_API_TOKEN). */
export const inspectorLink = (port, token) =>
  `http://127.0.0.1:${port}/?MCP_INSPECTOR_API_TOKEN=${encodeURIComponent(token)}`

/**
 * The ready message's line on Claude Code for a server on `port`, empty on 8400: `.mcp.json`
 * points every session at `${PORT:-8400}`, so another port is reached only from a session
 * started with the same PORT (a second worktree's server, say).
 */
export const claudeCodeHint = (port) =>
  port === DEFAULT_SERVER_PORT
    ? ""
    : `  Claude Code   a session reaches it when started as PORT=${port} claude\n`

/** The Compose profiles the options switch on. */
export const profilesFor = ({ multiEngine = false, auth = false } = {}) => [
  ...(multiEngine ? ["multi-engine"] : []),
  ...(auth ? ["auth"] : []),
]

/** The services a stack with these options runs. */
export const servicesFor = (options = {}) => {
  const profiles = profilesFor(options)
  return SERVICES.filter((service) => !service.profile || profiles.includes(service.profile))
}

/** `docker compose` arguments for the stack file under `repoRoot`. */
export const composeArgs = (composeFile, profiles, ...command) => [
  "compose",
  "-f",
  composeFile,
  ...profiles.flatMap((profile) => ["--profile", profile]),
  ...command,
]

const ENGINE_A = {
  id: "prod-a",
  baseUrl: "http://localhost:8410/engine-rest",
  cockpitUrl: "http://localhost:8410/webapp",
}
const ENGINE_B = {
  id: "prod-b",
  baseUrl: "http://localhost:8411/engine-rest",
  cockpitUrl: "http://localhost:8411/webapp",
}

/**
 * The MCP server's settings against the playground: the playground's public demo login, the
 * engine module alone (the playground runs no Prometheus), loopback only. `admin` widens the
 * toolset, `deploy` registers deployments, `auth` puts the server behind the playground's
 * Keycloak (.env.example, "Local playground"), with MCP_URL on localhost and the server's
 * `port`: OAuth needs it, and the realm stamps http://localhost:8400/mcp into every token's aud.
 */
export function serverPreset({
  multiEngine = false,
  admin = false,
  deploy = false,
  auth = false,
  port = DEFAULT_SERVER_PORT,
} = {}) {
  const engines = multiEngine
    ? {
        ENGINES_JSON: JSON.stringify(
          [ENGINE_A, ENGINE_B].map(({ id, baseUrl, cockpitUrl }) => ({
            id,
            baseUrl,
            flavor: "cibseven",
            cockpitUrl,
          })),
        ),
      }
    : {
        ENGINE_BASE_URL: ENGINE_A.baseUrl,
        ENGINE_ID: ENGINE_A.id,
        ENGINE_FLAVOR: "cibseven",
        ENGINE_COCKPIT_URL: ENGINE_A.cockpitUrl,
      }
  return {
    ...engines,
    ENGINE_AUTH_TYPE: "basic",
    ENGINE_USERNAME: "demo",
    ENGINE_PASSWORD: "demo",
    HOST: "127.0.0.1",
    MCP_ACTIVE_MODULES: admin ? "engine:admin" : "engine",
    ...(deploy ? { ENGINE_ALLOW_DEPLOYMENTS: "true" } : {}),
    ...(auth
      ? {
          MCP_URL: `http://localhost:${port}`,
          MCP_OAUTH_KEYCLOAK_SERVER_URL: "http://localhost:8480",
          MCP_OAUTH_KEYCLOAK_REALM: "miragon",
        }
      : {}),
  }
}

/**
 * The toolsets `pnpm play` names for `preset`: the suffix the preset sets (`--admin`), else the
 * default the engine module boots with.
 */
export const presetToolsets = (preset, { auth = false } = {}) =>
  preset.MCP_ACTIVE_MODULES?.includes(":")
    ? preset.MCP_ACTIVE_MODULES
    : `${preset.MCP_ACTIVE_MODULES}, ${auth ? "its default under OAuth" : "read-only"}`

/** Where the engine module reads its engines from, the first one set wins (its module.ts). */
export const ENGINE_SOURCES = ["ENGINES_FILE", "ENGINES_JSON", "ENGINE_BASE_URL"]

/** The CLI's settings against the playground engine. */
export const cliPreset = () => ({
  PULSE_CLI_URL: ENGINE_A.baseUrl,
  PULSE_CLI_FLAVOR: "cibseven",
  PULSE_CLI_AUTH: "basic",
  PULSE_CLI_USERNAME: "demo",
  PULSE_CLI_PASSWORD: "demo",
})

/**
 * `env` over `preset`: a variable the caller already set wins. `overridden` names the preset
 * variables the caller's environment replaced, `outranking` the engine sources it sets that the
 * engine module reads before the preset's own (ENGINE_SOURCES), so the playground engines are
 * not used (names only, a value may be a secret).
 */
export function withPreset(preset, env) {
  const overridden = Object.keys(preset).filter(
    (name) => env[name] !== undefined && env[name] !== preset[name],
  )
  const presetSource = ENGINE_SOURCES.findIndex((name) => name in preset)
  const outranking =
    presetSource < 0
      ? []
      : ENGINE_SOURCES.slice(0, presetSource).filter((name) => env[name]?.trim())
  return { env: { ...preset, ...env }, overridden, outranking }
}

/**
 * Host port → `{ container, project }` from `docker ps --format` lines of
 * `<name>\t<compose project>\t<ports>` (the project is empty for a plain container).
 */
export function portOwners(psText) {
  const owners = new Map()
  for (const line of psText.split("\n")) {
    const [container, project = "", ports = ""] = line.split("\t")
    if (!container) continue
    for (const match of ports.matchAll(/:(\d+)(?:-(\d+))?->/g)) {
      const first = Number(match[1])
      const last = Number(match[2] ?? match[1])
      for (let port = first; port <= last; port += 1) owners.set(port, { container, project })
    }
  }
  return owners
}

/**
 * Why `port` blocks the stack, or undefined when it does not: a port held by a container of
 * this stack's Compose project is the stack itself (Compose recreates it in place).
 */
export function portConflict(port, owner) {
  if (owner === undefined) {
    return `port ${port} is taken by a process outside Docker; stop it and try again`
  }
  if (owner.project === COMPOSE_PROJECT) return undefined
  const stop =
    owner.project === ""
      ? `docker stop ${owner.container}`
      : `docker compose -p ${owner.project} down`
  return `port ${port} is taken by the container ${owner.container}${
    owner.project === "" ? "" : ` (Compose project ${owner.project})`
  }; stop it with \`${stop}\` and try again`
}
