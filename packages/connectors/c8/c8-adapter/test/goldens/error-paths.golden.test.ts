import { afterEach, beforeEach, describe, test, vi } from "vitest"
import { InstanceId, RuntimeError, type ProcessRuntime } from "@miragon/pulse-engine-core"
import type { EngineCredentials } from "@miragon/pulse-runtime-view/ports"
import { C8Adapter } from "../../src/index.js"
import { clusterWorld, INSTANCE_KEY } from "./cluster-world.js"
import {
  acceptingOnly,
  belowTheFloor,
  echoesSecrets,
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
} from "./error-cases.js"
import { assertGolden, expectReadmeMatches } from "./golden.js"
import {
  closedPort,
  sentLines,
  startEngine,
  startSilentEngine,
  startTlsEngine,
  UNRESOLVABLE_ORIGIN,
  withoutPorts,
  type EngineAnswer,
  type LoopbackEngine,
} from "./loopback-engine.js"

type Engine = LoopbackEngine & { readonly endpoint: string }

type Call = "describeEngine" | `getInstanceDetail ${string}`

interface Probe {
  readonly call: Call
  readonly atSecond?: number
}

interface PinnedCase {
  readonly name: ErrorPathCase | Camunda8Case
  readonly engine: () => Promise<Engine>
  readonly credentials?: (origin: string) => EngineCredentials
  readonly shortDeadline?: true
  readonly probes?: readonly Probe[]
}

const ADAPTER_DEADLINE_MS = 60_000
const DEADLINE_MS = 300
const MORE_THAN_THE_CAP = String(64 * 1024 * 1024 + 1)
const CLOCK_START = Date.parse("2026-11-15T09:00:00.000Z")

const DESCRIBE: Probe = { call: "describeEngine" }
const DETAIL: Probe = { call: `getInstanceDetail ${INSTANCE_KEY}` }
const BOTH_PATHS: readonly Probe[] = [DESCRIBE, DETAIL]

const at = (atSecond: number): Probe => ({ call: "describeEngine", atSecond })

const restRoot =
  (answer: () => EngineAnswer, suffix = "/v2") =>
  async (): Promise<Engine> => {
    const engine = await startEngine(answer())
    return { ...engine, endpoint: `${engine.origin}${suffix}` }
  }

const always = (answer: EngineAnswer) => () => answer

const nothingListens = (origin: string): Engine => ({
  origin,
  endpoint: `${origin}/v2`,
  requests: [],
  close: () => Promise.resolve(),
})

const basic = (password: string) => (): EngineCredentials => ({
  kind: "basic",
  username: "demo",
  password,
})

const clientCredentials = (origin: string): EngineCredentials => ({
  kind: "clientCredentials",
  tokenEndpoint: `${origin}${TOKEN_PATH}`,
  clientId: "pulse-reader",
  clientSecret: "reader-secret",
  audience: "camunda",
})

const SHARED: readonly PinnedCase[] = [
  { name: "redirect", engine: restRoot(always(redirectToLogin)), probes: BOTH_PATHS },
  {
    name: "unauthorized-none",
    engine: restRoot(always(unauthorizedWithoutLogin)),
    probes: BOTH_PATHS,
  },
  {
    name: "unauthorized-basic",
    engine: restRoot(always(unauthorizedBasic)),
    credentials: basic("demo-secret"),
  },
  {
    name: "unauthorized-bearer",
    engine: restRoot(() => issuing(["tok-demo-123"], refusingEveryToken)),
    credentials: clientCredentials,
  },
  { name: "wrong-rest-root", engine: restRoot(always(outsideV2), ""), probes: BOTH_PATHS },
  { name: "missing-resource", engine: restRoot(always(missingInstance)), probes: [DETAIL] },
  {
    name: "engine-text-echoes-secret-basic",
    engine: restRoot(always(echoesSecrets)),
    credentials: basic("demo-secret"),
  },
  {
    name: "engine-text-echoes-secret-bearer",
    engine: restRoot(always(echoesSecrets)),
    credentials: clientCredentials,
  },
  {
    name: "deadline-exceeded",
    engine: async () => {
      const engine = await startSilentEngine()
      return { ...engine, endpoint: `${engine.origin}/v2` }
    },
    shortDeadline: true,
    probes: BOTH_PATHS,
  },
  {
    name: "unreachable",
    engine: async () => nothingListens(`http://127.0.0.1:${String(await closedPort())}`),
  },
  {
    name: "tls-failure",
    engine: async () => {
      const engine = await startTlsEngine(clusterWorld)
      return { ...engine, endpoint: `${engine.origin}/v2` }
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
    credentials: basic("pässw€rd"),
  },
  {
    name: "path-value-dot",
    engine: restRoot(always(clusterWorld)),
    probes: [{ call: "getInstanceDetail ." }, { call: "getInstanceDetail .." }],
  },
  { name: "double-slash-root", engine: restRoot(always(clusterWorld), "/v2//") },
  {
    name: "token-line-break-inside",
    engine: restRoot(() => issuing(["tok-demo\n123"])),
    credentials: clientCredentials,
  },
  {
    name: "token-line-break-trailing",
    engine: restRoot(() => issuing(["tok-demo-123\n"])),
    credentials: clientCredentials,
  },
  { name: "integer-beyond-2-53", engine: restRoot(always(clusterWorld)), probes: [DETAIL] },
]

const CAMUNDA_8: readonly PinnedCase[] = [
  {
    name: "token-endpoint-refusal",
    engine: restRoot(always(refusingTheClient)),
    credentials: clientCredentials,
    probes: [DESCRIBE, at(59), at(61)],
  },
  {
    name: "token-endpoint-rate-limit",
    engine: restRoot(rateLimitedOnce),
    credentials: clientCredentials,
    probes: [DESCRIBE, at(29), at(31)],
  },
  {
    name: "unauthorized-renewed",
    engine: restRoot(() => issuing(["tok-old-1", "tok-new-2"], acceptingOnly("tok-new-2"))),
    credentials: clientCredentials,
    probes: [DESCRIBE, at(31)],
  },
  {
    name: "unauthorized-after-the-one-retry",
    engine: restRoot(() => issuing(["tok-one-1", "tok-two-2", "tok-three-3"], refusingEveryToken)),
    credentials: clientCredentials,
    probes: [DESCRIBE, at(31)],
  },
  { name: "version-below-the-floor", engine: restRoot(always(belowTheFloor)), probes: BOTH_PATHS },
  { name: "url-of-operate", engine: restRoot(always(operateInsteadOfV2), "/operate") },
  {
    name: "no-secondary-storage",
    engine: restRoot(always(withoutSecondaryStorage)),
    probes: BOTH_PATHS,
  },
]

const PINNED: readonly PinnedCase[] = [...SHARED, ...CAMUNDA_8]

function call(runtime: ProcessRuntime, probe: Probe): Promise<unknown> {
  if (probe.call === "describeEngine") {
    return runtime.describeEngine()
  }
  return runtime.getInstanceDetail(InstanceId(probe.call.slice("getInstanceDetail ".length)))
}

async function outcomeOf(attempt: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    const value = await attempt
    return value === undefined ? { returned: "undefined" } : { returned: value }
  } catch (error: unknown) {
    if (error instanceof RuntimeError) {
      return { failure: error.failure, message: error.message, hint: error.hint ?? null }
    }
    return { thrown: String(error) }
  }
}

async function withShortDeadline<T>(attempt: () => Promise<T>): Promise<T> {
  const setTimer = globalThis.setTimeout
  const timers = vi.spyOn(globalThis, "setTimeout")
  timers.mockImplementation((handler, delay, ...args) =>
    setTimer(handler, delay === ADAPTER_DEADLINE_MS ? DEADLINE_MS : delay, ...args),
  )
  try {
    return await attempt()
  } finally {
    timers.mockRestore()
  }
}

async function goldenOf(pinned: PinnedCase): Promise<Record<string, unknown>> {
  const engine = await pinned.engine()
  const connection = {
    endpoint: engine.endpoint,
    credentials: pinned.credentials?.(engine.origin) ?? { kind: "none" },
  }
  const clock = { now: CLOCK_START }
  const adapter = new C8Adapter(fetch, () => clock.now)
  try {
    const probes = []
    for (const probe of pinned.probes ?? [DESCRIBE]) {
      clock.now = CLOCK_START + (probe.atSecond ?? 0) * 1000
      engine.requests.length = 0
      const attempt = () => outcomeOf(call(adapter.runtime(connection), probe))
      const outcome = await (pinned.shortDeadline ? withShortDeadline(attempt) : attempt())
      const sent = sentLines(engine.requests, probe.call === "describeEngine")
      probes.push({ ...probe, outcome, sent })
    }
    return { case: pinned.name, connection, probes }
  } finally {
    await engine.close()
  }
}

beforeEach(() => {
  vi.stubEnv("TZ", "UTC")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("what the C8 adapter reports when a cluster call fails", () => {
  test.each(PINNED.map((pinned) => [pinned.name, pinned] as const))("%s", async (name, pinned) => {
    assertGolden(name, withoutPorts(await goldenOf(pinned)))
  })

  test("the README names every case, and exactly the pinned ones have a golden", () => {
    expectReadmeMatches(PINNED.map((entry) => entry.name))
  })
})
