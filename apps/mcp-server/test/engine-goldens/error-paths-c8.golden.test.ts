import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { bootServer, type BootedServer } from "../boot-server.js"
import { assertGolden } from "../golden.js"
import { clusterWorld, INSTANCE_KEY } from "./c8-cluster-world.js"
import {
  acceptingOnly,
  belowTheFloor,
  CAMUNDA_8_CASES,
  echoesSecrets,
  ERROR_PATH_CASES,
  issuing,
  missingInstance,
  operateInsteadOfV2,
  outsideV2,
  rateLimitedOnce,
  redirectToLogin,
  refusingEveryToken,
  refusingTheClient,
  TOKEN_PATH,
  unauthorizedBasic,
  unauthorizedWithoutLogin,
  withoutSecondaryStorage,
  type Camunda8Case,
  type ErrorPathCase,
} from "./error-cases-c8.js"
import {
  c8SentLines,
  type EngineAnswer,
  type LoopbackServer,
  startC8Engine,
  startSilentC8Engine,
  startTlsC8Engine,
} from "./fake-c8-cluster.js"
import { closedPort, UNRESOLVABLE_ORIGIN, withoutPorts } from "./fake-engines.js"
import { ERROR_PATH_C8_DIR, expectReadmeMatches, modelResult, OUTPUT_DIR } from "./goldens.js"

/**
 * Error-path goldens of Camunda 8 (T0): what the server reports when a Camunda 8 cluster's call
 * fails, through the real app (`createApp`) against a loopback cluster whose token endpoint sits
 * at Keycloak's path on the same origin, under a clock the test holds (`Date`, which the token
 * source and the board's floor read). The chat's cockpit shows such an engine on boards only, so
 * each case opens a board over that one engine (`engine_open_cockpit` view `board`) unless it names
 * its own probes: the facts the model reads (its engine's state and failure code), the board the
 * view renders (the failure's message with its hint) and the requests the cluster and its token
 * endpoint saw. The case names and the
 * answers are error-cases-c8.ts's, a copy of the C8 adapter's; each probe names the adapter's
 * call whose failure it must equal (`matches`), which scripts/error-path-goldens.test.mjs holds
 * case by case. `__golden__/error-paths-c8/README.md` says per case what is pinned and why.
 * Intended change: `pnpm --fail-if-no-match --filter @miragon/pulse-mcp-server golden:update`.
 */

/** The C8 adapter's calls, as its goldens name them. */
type AdapterCall = "describeEngine" | `getInstanceDetail ${string}`

interface Probe {
  readonly tool: string
  readonly arguments: Readonly<Record<string, unknown>>
  /** Seconds after the first call, where a case moves the clock. */
  readonly atSecond?: number
  /** The adapter's call whose failure (or none) this probe's must equal. */
  readonly matches?: AdapterCall
}

interface Engine extends LoopbackServer {
  /** The profile's url: the REST root, or what a case gets wrong of it. */
  readonly url: string
}

/** A profile's sign-in and the secret variables it names, with their values. */
interface SignIn {
  readonly auth: Readonly<Record<string, unknown>>
  readonly secrets: Readonly<Record<string, string>>
}

interface PinnedCase {
  readonly name: ErrorPathCase | Camunda8Case
  readonly engine: () => Promise<Engine>
  readonly signIn?: (origin: string) => SignIn
  /** The profile's deadline in ms, the server's own (60000) when absent. */
  readonly timeout?: number
  readonly probes?: readonly Probe[]
}

const ENGINE = "c8"
const BOARD = "cluster"
const CLOCK_START = Date.parse("2026-11-15T09:00:00.000Z")

/** One engine, one tile: the instances of the world's process. */
const BOARD_FILE = {
  schemaVersion: 1,
  title: "Cluster",
  engines: [ENGINE],
  rows: [
    {
      row: [
        { widget: "instanceList", props: { title: "Orders", filter: { process: "pulse-order" } } },
      ],
    },
  ],
}

const board = (atSecond?: number, matches: AdapterCall = "describeEngine"): Probe => ({
  tool: "engine_open_cockpit",
  arguments: { view: "board", board: BOARD },
  matches,
  ...(atSecond === undefined ? {} : { atSecond }),
})

const BOARD_PROBE = board()
const DETAIL: AdapterCall = `getInstanceDetail ${INSTANCE_KEY}`

/** The world's instance by its key, as the model reads it: its instance screen as JSON. */
const INSTANCE_PROBE: Probe = {
  tool: "engine_get_screen",
  arguments: { engine: ENGINE, screen: "instance", processInstanceId: INSTANCE_KEY },
  matches: DETAIL,
}

/** The diagram's XML feed, the one read of a key the server takes: no key, no request. */
const xmlOf = (id: string, matches: AdapterCall = `getInstanceDetail ${id}`): Probe => ({
  tool: "engine_bpmn_xml_data",
  arguments: { engine: ENGINE, processDefinitionId: id },
  matches,
})

/**
 * The XML of the world's process version, whose first read is the cluster's version as
 * describeEngine's: its tool error states the failure and the hint, as the board's engine does.
 */
const XML_PROBE = xmlOf("2251799813685326", "describeEngine")

const restRoot =
  (answer: () => EngineAnswer, suffix = "/v2") =>
  async (): Promise<Engine> => {
    const engine = await startC8Engine(answer())
    return { ...engine, url: `${engine.origin}${suffix}` }
  }

const always = (answer: EngineAnswer) => () => answer

const nothingListens = (origin: string): Engine => ({
  origin,
  url: `${origin}/v2`,
  requests: [],
  close: () => Promise.resolve(),
})

const basic = (password: string) => (): SignIn => ({
  auth: { type: "basic", username: "demo", passwordEnv: "ENGINE_SECRET_C8_PASSWORD" },
  secrets: { ENGINE_SECRET_C8_PASSWORD: password },
})

const clientCredentials = (origin: string): SignIn => ({
  auth: {
    type: "clientCredentials",
    tokenEndpoint: `${origin}${TOKEN_PATH}`,
    clientId: "pulse-reader",
    clientSecretEnv: "ENGINE_SECRET_C8_CLIENT",
    audience: "camunda",
  },
  secrets: { ENGINE_SECRET_C8_CLIENT: "reader-secret" },
})

/**
 * The world, and its one instance in every instance search: the board reads instances by search,
 * never by key, so the instance beyond 2^53 reaches it here.
 */
const listingTheInstance: EngineAnswer = (request) => {
  if (request.target !== "/v2/process-instances/search") return clusterWorld(request)
  const instance = clusterWorld({ method: "GET", target: `/v2/process-instances/${INSTANCE_KEY}` })
  const page = { totalItems: 1, hasMoreTotalItems: false, startCursor: null, endCursor: null }
  return { body: { items: [instance.body], page } }
}

const MORE_THAN_THE_CAP = String(64 * 1024 * 1024 + 1)

const SHARED: readonly PinnedCase[] = [
  { name: "redirect", engine: restRoot(always(redirectToLogin)) },
  { name: "unauthorized-none", engine: restRoot(always(unauthorizedWithoutLogin)) },
  {
    name: "unauthorized-basic",
    engine: restRoot(always(unauthorizedBasic)),
    signIn: basic("demo-secret"),
  },
  {
    name: "unauthorized-bearer",
    engine: restRoot(() => issuing(["tok-demo-123"], refusingEveryToken)),
    signIn: clientCredentials,
  },
  {
    name: "wrong-rest-root",
    engine: restRoot(always(outsideV2), ""),
    probes: [BOARD_PROBE, XML_PROBE],
  },
  { name: "missing-resource", engine: restRoot(always(missingInstance)), probes: [INSTANCE_PROBE] },
  {
    name: "engine-text-echoes-secret-basic",
    engine: restRoot(always(echoesSecrets)),
    signIn: basic("demo-secret"),
  },
  {
    name: "engine-text-echoes-secret-bearer",
    engine: restRoot(always(echoesSecrets)),
    signIn: clientCredentials,
  },
  {
    name: "deadline-exceeded",
    engine: async () => {
      const engine = await startSilentC8Engine()
      return { ...engine, url: `${engine.origin}/v2` }
    },
    timeout: 300,
  },
  {
    name: "unreachable",
    engine: async () => nothingListens(`http://127.0.0.1:${String(await closedPort())}`),
  },
  {
    name: "tls-failure",
    engine: async () => {
      const engine = await startTlsC8Engine(clusterWorld)
      return { ...engine, url: `${engine.origin}/v2` }
    },
  },
  { name: "dns-failure", engine: () => Promise.resolve(nothingListens(UNRESOLVABLE_ORIGIN)) },
  {
    name: "too-large-response",
    engine: restRoot(
      always(() => ({
        raw: "{",
        contentType: "application/json",
        headers: { "Content-Length": MORE_THAN_THE_CAP },
        hold: true,
      })),
    ),
  },
  {
    name: "basic-password-euro",
    engine: restRoot(always(clusterWorld)),
    signIn: basic("pässw€rd"),
  },
  {
    name: "path-value-dot",
    engine: restRoot(always(clusterWorld)),
    probes: [xmlOf("."), xmlOf("..")],
  },
  { name: "double-slash-root", engine: restRoot(always(clusterWorld), "/v2//") },
  {
    name: "token-line-break-inside",
    engine: restRoot(() => issuing(["tok-demo\n123"])),
    signIn: clientCredentials,
  },
  {
    name: "token-line-break-trailing",
    engine: restRoot(() => issuing(["tok-demo-123\n"])),
    signIn: clientCredentials,
  },
  {
    name: "integer-beyond-2-53",
    engine: restRoot(always(listingTheInstance)),
    probes: [board(undefined, DETAIL)],
  },
]

const CAMUNDA_8: readonly PinnedCase[] = [
  {
    name: "token-endpoint-refusal",
    engine: restRoot(always(refusingTheClient)),
    signIn: clientCredentials,
    probes: [BOARD_PROBE, board(59), board(61)],
  },
  {
    name: "token-endpoint-rate-limit",
    engine: restRoot(rateLimitedOnce),
    signIn: clientCredentials,
    probes: [BOARD_PROBE, board(29), board(31)],
  },
  {
    name: "unauthorized-renewed",
    engine: restRoot(() => issuing(["tok-old-1", "tok-new-2"], acceptingOnly("tok-new-2"))),
    signIn: clientCredentials,
    probes: [BOARD_PROBE, board(31)],
  },
  {
    name: "unauthorized-after-the-one-retry",
    engine: restRoot(() => issuing(["tok-one-1", "tok-two-2", "tok-three-3"], refusingEveryToken)),
    signIn: clientCredentials,
    probes: [BOARD_PROBE, board(31)],
  },
  { name: "version-below-the-floor", engine: restRoot(always(belowTheFloor)) },
  { name: "url-of-operate", engine: restRoot(always(operateInsteadOfV2), "/operate") },
  {
    name: "no-secondary-storage",
    engine: restRoot(always(withoutSecondaryStorage)),
    // The version read passes, the board's engine fails at its definitions, as an instance read
    // of the adapter's does.
    probes: [board(undefined, DETAIL)],
  },
]

const PINNED: readonly PinnedCase[] = [...SHARED, ...CAMUNDA_8]

/** The board as the view renders it: its engine's state, a failure's message with its hint. */
interface BoardView {
  readonly engines: ReadonlyArray<{ state: string; failure?: { code: string } }>
}

const textOf = (result: unknown): string =>
  ((result as { content?: Array<{ text?: string }> }).content ?? [])
    .map((part) => part.text ?? "")
    .join("")

/** What a probe gives: a board's facts and view, any other tool's result as the model reads it. */
function outcomeOf(probe: Probe, result: Awaited<ReturnType<BootedServer["client"]["callTool"]>>) {
  if (probe.tool !== "engine_open_cockpit") {
    // A tool error leads with its failure's kind (`[misconfigured]`); a code of the server's own
    // (`[UNKNOWN_INSTANCE]`, its words for an instance the engine answers none of) is no failure.
    const failure =
      result.isError === true ? (/^\[([a-z]\w*)\]/.exec(textOf(result))?.[1] ?? null) : null
    return { failure, result: modelResult(result) }
  }
  const view = (result.structuredContent as { start: { data: BoardView } }).start.data
  const engine = view.engines[0]
  return {
    failure: engine.state === "failed" ? (engine.failure?.code ?? null) : null,
    facts: textOf(result).split("\n"),
    board: view,
  }
}

let boardsDir: string

beforeAll(() => {
  boardsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-c8-goldens-"))
  fs.writeFileSync(path.join(boardsDir, `${BOARD}.board.json`), JSON.stringify(BOARD_FILE))
})

afterAll(() => {
  fs.rmSync(boardsDir, { recursive: true, force: true })
})

beforeEach(() => {
  for (const level of ["info", "warn", "log"] as const) {
    vi.spyOn(console, level).mockImplementation(() => {})
  }
  vi.useFakeTimers({ toFake: ["Date"], now: CLOCK_START })
  vi.stubEnv("TZ", "UTC")
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

/** The server over one Camunda 8 profile and the board that names it. */
function bootOver(
  profile: Record<string, unknown>,
  secrets: Readonly<Record<string, string>> = {},
) {
  return bootServer({
    env: {
      ENGINE_BASE_URL: undefined,
      ENGINES_JSON: JSON.stringify({ profiles: { [ENGINE]: profile } }),
      ENGINE_BOARDS_DIR: boardsDir,
      ...secrets,
    },
  })
}

async function goldenOf({ name, engine: start, signIn, timeout, probes }: PinnedCase) {
  const engine = await start()
  const { auth, secrets } = signIn?.(engine.origin) ?? { auth: undefined, secrets: {} }
  const profile = {
    url: engine.url,
    flavor: "camunda8",
    ...(auth === undefined ? {} : { auth }),
    ...(timeout === undefined ? {} : { timeout }),
  }
  try {
    const server = await bootOver(profile, secrets)
    try {
      const results = []
      for (const probe of probes ?? [BOARD_PROBE]) {
        vi.setSystemTime(CLOCK_START + (probe.atSecond ?? 0) * 1000)
        engine.requests.length = 0
        const result = await server.client.callTool({
          name: probe.tool,
          arguments: { ...probe.arguments },
        })
        results.push({ ...probe, ...outcomeOf(probe, result), sent: c8SentLines(engine.requests) })
      }
      return { case: name, profile, secrets, probes: results }
    } finally {
      await server.close()
    }
  } finally {
    await engine.close()
  }
}

describe("what the server reports when a Camunda 8 cluster's call fails", () => {
  it.each(PINNED.map((pinned) => [pinned.name, pinned] as const))("%s", async (name, pinned) => {
    assertGolden(name, withoutPorts(await goldenOf(pinned)), ERROR_PATH_C8_DIR)
  })

  it("the README names every case, and exactly the pinned ones have a golden", () => {
    expectReadmeMatches(
      ERROR_PATH_C8_DIR,
      PINNED.map((pinned) => pinned.name),
      [...ERROR_PATH_CASES, ...CAMUNDA_8_CASES],
    )
  })

  it("refuses a fixed bearer token on a Camunda 8 profile at boot, and sends nothing", async () => {
    const engine = await startC8Engine(clusterWorld)
    try {
      const profile = {
        url: `${engine.origin}/v2`,
        flavor: "camunda8",
        auth: { type: "bearer", tokenEnv: "ENGINE_SECRET_C8_TOKEN" },
      }
      const refusal = await bootOver(profile, { ENGINE_SECRET_C8_TOKEN: "tok-demo-123" }).then(
        () => "booted",
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      )
      expect(refusal).toBe(
        'ENGINES_JSON: no profile is usable. Profile "c8" (ENGINES_JSON) is refused: This ' +
          "server cannot sign in to a Camunda 8 engine with this auth.type: it signs in with " +
          "none, basic or clientCredentials, whose tokens it gets itself.",
      )
      expect(engine.requests).toEqual([])
    } finally {
      await engine.close()
    }
  })
})

describe("the engine list over a Camunda 8 engine beside a Camunda 7 one", () => {
  it("engine_list_engines", async () => {
    const engine = await startC8Engine(clusterWorld)
    const profiles = {
      "prod-eu": { url: "http://localhost:1/engine-rest", flavor: "cibseven", environment: "prod" },
      [ENGINE]: {
        auth: clientCredentials(engine.origin).auth,
        url: `${engine.origin}/v2`,
        flavor: "camunda8",
        environment: "prod",
        cockpitUrl: "https://operate.example.com/operate",
      },
    }
    try {
      const server = await bootServer({
        env: {
          ENGINE_BASE_URL: undefined,
          ENGINES_JSON: JSON.stringify({ profiles }),
          ENGINE_BOARDS_DIR: boardsDir,
          ...clientCredentials(engine.origin).secrets,
        },
      })
      try {
        const args = {}
        const result = await server.client.callTool({
          name: "engine_list_engines",
          arguments: args,
        })
        const golden = {
          tool: "engine_list_engines",
          arguments: args,
          profiles,
          result: modelResult(result),
          sent: c8SentLines(engine.requests),
        }
        assertGolden("engine_list_engines-c8", withoutPorts(golden), OUTPUT_DIR)
      } finally {
        await server.close()
      }
    } finally {
      await engine.close()
    }
  })
})
