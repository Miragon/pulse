import path from "node:path"
import { afterEach, beforeEach, describe, it, vi } from "vitest"
import { createApp } from "../../src/app.js"
import { bootServer, stubNeutralEnv } from "../boot-server.js"
import { assertGolden } from "../golden.js"
import { postToolCall, startRealm } from "../realm.js"
import {
  echoesSecrets,
  missingInstance,
  outsideRestApp,
  redirectToLogin,
  unauthorized,
  withBigLong,
  type ErrorPathCase,
} from "./error-cases.js"
import {
  closedPort,
  startEngine,
  startSilentEngine,
  startTlsEngine,
  UNRESOLVABLE_ORIGIN,
  withoutPorts,
  type EngineAnswer,
  type SentRequest,
} from "./fake-engines.js"
import { ERROR_PATH_DIR, expectReadmeMatches, modelResult, sentLines } from "./goldens.js"
import { worldAnswer } from "./world.js"

/**
 * Error-path goldens (T0): the tool error text the model reads for each way an engine call can
 * fail, through the real app (`createApp`) against a loopback engine, with the requests the
 * engine saw. The case names and the engine answers are error-cases.ts's, the same on every
 * surface; `__golden__/error-paths/README.md` says per case what is pinned, what is not and why,
 * and which later step changes a pinned bug. Intended change:
 * `pnpm --fail-if-no-match --filter @miragon/pulse-mcp-server golden:update`.
 */

interface Probe {
  tool: string
  arguments: Record<string, unknown>
  /** The reads the call starts before any answer: the engine answers none before they arrived. */
  round: number
}

/** The composite read every case asks first: one instance, its runtime and history in parallel. */
const INSPECT: Probe = {
  tool: "engine_inspect_process_instance",
  arguments: { processInstanceId: "pi-1" },
  round: 2,
}

/** A read of the registrar: a page of instances and their count in parallel. */
const LIST: Probe = { tool: "engine_list_process_instances", arguments: {}, round: 2 }

/** A registrar read of one instance's resource. */
const VARIABLES: Probe = {
  tool: "engine_get_process_instance_variables",
  arguments: { processInstanceId: "pi-1" },
  round: 1,
}

/** Reads the engine serves on a POST (the body carries the query); admin-only or a feed. */
const READING_POSTS: Probe[] = [
  {
    tool: "engine_create_migration_plan",
    arguments: {
      sourceProcessDefinitionId: "order:1:5e0d79",
      targetProcessDefinitionId: "order:2:6f1e8a",
    },
    round: 1,
  },
  { tool: "engine_process_instances_data", arguments: {}, round: 4 },
]

/** A real write on a POST, the counter-check of the reading ones. */
const START: Probe = {
  tool: "engine_start_process_instance",
  arguments: { processDefinitionKey: "order" },
  round: 1,
}

interface Engine {
  /** The engine URL as configured (ENGINE_BASE_URL). */
  baseUrl: string
  requests: SentRequest[]
  begin(round: number): void
  shortRound(): number | undefined
  close(): Promise<void>
}

interface PinnedCase {
  name: ErrorPathCase
  engine: () => Promise<Engine>
  env?: Record<string, string>
  probes?: Probe[]
}

const at = (suffix: string, answer: EngineAnswer) => async (): Promise<Engine> => {
  const engine = await startEngine(answer)
  return { ...engine, baseUrl: `${engine.origin}${suffix}` }
}

const restRoot = (answer: EngineAnswer) => at("/engine-rest", answer)

const nothingListens = (baseUrl: string): Engine => ({
  baseUrl,
  requests: [],
  begin: () => {},
  shortRound: () => undefined,
  close: () => Promise.resolve(),
})

const BASIC = { ENGINE_AUTH_TYPE: "basic", ENGINE_USERNAME: "demo" }
const BEARER = { ENGINE_AUTH_TYPE: "bearer" }

const PINNED: PinnedCase[] = [
  { name: "redirect", engine: restRoot(redirectToLogin), probes: [INSPECT, LIST] },
  { name: "unauthorized-none", engine: restRoot(unauthorized), probes: [INSPECT, LIST] },
  {
    name: "unauthorized-basic",
    engine: restRoot(unauthorized),
    env: { ...BASIC, ENGINE_PASSWORD: "demo-secret" },
  },
  {
    name: "unauthorized-bearer",
    engine: restRoot(unauthorized),
    env: { ...BEARER, ENGINE_TOKEN: "tok-demo-123" },
  },
  { name: "wrong-rest-root", engine: at("", outsideRestApp(worldAnswer)), probes: [INSPECT, LIST] },
  { name: "missing-resource", engine: restRoot(missingInstance), probes: [INSPECT, VARIABLES] },
  {
    name: "engine-text-echoes-secret-basic",
    engine: restRoot(echoesSecrets),
    env: { ...BASIC, ENGINE_PASSWORD: "demo-secret" },
  },
  {
    name: "engine-text-echoes-secret-bearer",
    engine: restRoot(echoesSecrets),
    env: { ...BEARER, ENGINE_TOKEN: "tok-demo-123" },
  },
  {
    name: "deadline-exceeded",
    engine: async () => {
      const engine = await startSilentEngine()
      return { ...engine, baseUrl: `${engine.origin}/engine-rest` }
    },
    // admin: the migration plan is admin-only; the writes show the caveat a reading POST lacks
    env: { ENGINE_REQUEST_TIMEOUT_MS: "300", MCP_ACTIVE_MODULES: "engine:admin" },
    probes: [INSPECT, LIST, ...READING_POSTS, START],
  },
  {
    name: "unreachable",
    engine: async () => nothingListens(`http://127.0.0.1:${await closedPort()}/engine-rest`),
  },
  {
    name: "tls-failure",
    engine: async () => {
      const engine = await startTlsEngine(worldAnswer)
      return { ...engine, baseUrl: `${engine.origin}/engine-rest` }
    },
    // A write too: the handshake fails before anything is sent, yet the text warns it may apply.
    env: { MCP_ACTIVE_MODULES: "engine:operations" },
    probes: [
      INSPECT,
      { tool: "engine_set_job_retries", arguments: { jobId: "job-1", retries: 1 }, round: 1 },
    ],
  },
  {
    name: "dns-failure",
    engine: () => Promise.resolve(nothingListens(`${UNRESOLVABLE_ORIGIN}/engine-rest`)),
  },
  {
    name: "basic-password-euro",
    engine: restRoot(worldAnswer),
    env: { ...BASIC, ENGINE_PASSWORD: "pässw€rd" },
  },
  {
    name: "path-value-dot",
    engine: restRoot(worldAnswer),
    probes: [".", ".."].map((id) => ({ ...INSPECT, arguments: { processInstanceId: id } })),
  },
  { name: "double-slash-root", engine: at("/engine-rest//", worldAnswer) },
  {
    name: "token-line-break-inside",
    engine: restRoot(worldAnswer),
    env: { ...BEARER, ENGINE_TOKEN: "tok-demo-123\nsecond-line" },
  },
  {
    name: "token-line-break-trailing",
    engine: restRoot(worldAnswer),
    env: { ...BEARER, ENGINE_TOKEN: "tok-demo-123\n" },
  },
  {
    name: "integer-beyond-2-53",
    engine: restRoot(withBigLong(worldAnswer)),
    probes: [{ ...INSPECT, arguments: { processInstanceId: "pi-1", includeVariables: true } }],
  },
]

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Runs one probe behind the engine's barrier; a round the call never filled fails the case. */
async function probed<T>(
  engine: Pick<Engine, "begin" | "shortRound">,
  probe: Probe,
  call: () => Promise<T>,
): Promise<T> {
  engine.begin(probe.round)
  const result = await call()
  const short = engine.shortRound()
  if (short !== undefined) {
    throw new Error(
      `${probe.tool} started ${short} reads before the engine answered, not ${probe.round}: ` +
        "set the probe's round to the reads it starts in parallel.",
    )
  }
  return result
}

/** Boots the app on `engine` with `env`, runs the probes; a refused boot is the golden instead. */
async function goldenOf({ name, engine: start, env = {}, probes = [INSPECT] }: PinnedCase) {
  const engine = await start()
  const config = { ENGINE_BASE_URL: engine.baseUrl, ...env }
  try {
    const server = await bootServer({ env: config }).catch((error: unknown) => error)
    if (!("client" in (server as object))) {
      return { case: name, config, boot: messageOf(server), sent: sentLines(engine.requests) }
    }
    const booted = server as Awaited<ReturnType<typeof bootServer>>
    try {
      const results = []
      for (const probe of probes) {
        const call = () => booted.client.callTool({ name: probe.tool, arguments: probe.arguments })
        const result = await probed(engine, probe, call)
        const { tool, arguments: args } = probe
        results.push({
          tool,
          arguments: args,
          result: modelResult(result),
          sent: sentLines(engine.requests),
        })
      }
      return { case: name, config, probes: results }
    } finally {
      await booted.close()
    }
  } finally {
    await engine.close()
  }
}

beforeEach(() => {
  for (const level of ["info", "warn", "log"] as const) {
    vi.spyOn(console, level).mockImplementation(() => {})
  }
  // No golden reads the local time today; one that starts to stays the same on every machine.
  vi.stubEnv("TZ", "UTC")
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

/** A tools/call result as the app's handler answers it: plain JSON or one SSE event. */
async function resultOf(res: Response): Promise<unknown> {
  const text = await res.text()
  return (JSON.parse(text.slice(text.indexOf("{"))) as { result: unknown }).result
}

describe("what the model reads when an engine call fails", () => {
  it.each(PINNED.map((c) => [c.name, c] as const))("%s", async (name, pinned) => {
    assertGolden(name, withoutPorts(await goldenOf(pinned)), ERROR_PATH_DIR)
  })

  it("unauthorized-passthrough", async () => {
    const realm = await startRealm()
    const engine = await startEngine(unauthorized)
    const config = {
      MCP_URL: "http://localhost",
      MCP_OAUTH_KEYCLOAK_SERVER_URL: realm.url,
      MCP_OAUTH_KEYCLOAK_REALM: "platform",
      MCP_ACTIVE_MODULES: "engine",
      ENGINE_BASE_URL: `${engine.origin}/engine-rest`,
      ENGINE_AUTH_TYPE: "passthrough",
    }
    try {
      stubNeutralEnv(config)
      const composed = await createApp(process.env, {
        bundle: { jsPath: path.join(import.meta.dirname, "..", "fixtures", "mcp-app.js") },
      })
      const token = realm.sign({ aud: "http://localhost/mcp", sub: "demo" })
      const { tool, arguments: args } = INSPECT
      const call = () => postToolCall(composed, `Bearer ${token}`, tool, args).then(resultOf)
      const result = await probed(engine, INSPECT, call)
      const sent = sentLines(engine.requests).map((line) => line.replace(token, "<token>"))
      const probe = { tool, arguments: args, result: modelResult(result), sent }
      const golden = { case: "unauthorized-passthrough", config, probes: [probe] }
      assertGolden("unauthorized-passthrough", withoutPorts(golden), ERROR_PATH_DIR)
    } finally {
      await Promise.all([realm.close(), engine.close()])
    }
  })

  it("the README names every case, and exactly the pinned ones have a golden", () => {
    expectReadmeMatches(ERROR_PATH_DIR, [...PINNED.map((c) => c.name), "unauthorized-passthrough"])
  })
})
