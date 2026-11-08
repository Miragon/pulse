import { afterEach, beforeEach, describe, test, vi } from "vitest"
import { C7Adapter } from "../../../../src/adapters/c7/index.js"
import {
  InstanceId,
  RuntimeError,
  type EngineCredentials,
  type ProcessRuntime,
} from "../../../../src/contract/index.js"
import {
  echoesSecrets,
  missingInstance,
  outsideRestApp,
  redirectToLogin,
  unauthorized,
  withBigLong,
  type ErrorPathCase,
} from "./error-cases.js"
import { assertGolden, expectReadmeMatches } from "./golden.js"
import { inspectWorld } from "./inspect-world.js"
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

type Engine = Omit<LoopbackEngine, "origin"> & { readonly endpoint: string }

type Probe =
  "describeEngine" | "getInstanceDetail pi-1" | "getInstanceDetail ." | "getInstanceDetail .."

const ROUNDS: Readonly<Record<Probe, number>> = {
  describeEngine: 1,
  "getInstanceDetail pi-1": 4,
  "getInstanceDetail .": 0,
  "getInstanceDetail ..": 0,
}

interface PinnedCase {
  readonly name: ErrorPathCase
  readonly engine: () => Promise<Engine>
  readonly credentials?: EngineCredentials
  readonly send?: typeof fetch
  readonly probes?: readonly Probe[]
}

const DEADLINE_MS = 300
const MORE_THAN_THE_CAP = String(64 * 1024 * 1024 + 1)

const restRoot =
  (answer: EngineAnswer, suffix = "/engine-rest") =>
  async (): Promise<Engine> => {
    const engine = await startEngine(answer)
    return { ...engine, endpoint: `${engine.origin}${suffix}` }
  }

const nothingListens = (endpoint: string): Engine => ({
  endpoint,
  requests: [],
  begin: () => undefined,
  shortRound: () => undefined,
  close: () => Promise.resolve(),
})

const shortDeadline: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(DEADLINE_MS) })

const basic = (password: string): EngineCredentials => ({
  kind: "basic",
  username: "demo",
  password,
})

const BOTH_PATHS: readonly Probe[] = ["describeEngine", "getInstanceDetail pi-1"]

const PINNED: readonly PinnedCase[] = [
  { name: "redirect", engine: restRoot(redirectToLogin), probes: BOTH_PATHS },
  { name: "unauthorized-none", engine: restRoot(unauthorized), probes: BOTH_PATHS },
  { name: "unauthorized-basic", engine: restRoot(unauthorized), credentials: basic("demo-secret") },
  {
    name: "wrong-rest-root",
    engine: restRoot(outsideRestApp(inspectWorld), ""),
    probes: BOTH_PATHS,
  },
  {
    name: "missing-resource",
    engine: restRoot(missingInstance),
    probes: ["getInstanceDetail pi-1"],
  },
  {
    name: "engine-text-echoes-secret-basic",
    engine: restRoot(echoesSecrets),
    credentials: basic("demo-secret"),
  },
  {
    name: "deadline-exceeded",
    engine: async () => {
      const engine = await startSilentEngine()
      return { ...engine, endpoint: `${engine.origin}/engine-rest` }
    },
    send: shortDeadline,
    probes: BOTH_PATHS,
  },
  {
    name: "unreachable",
    engine: async () => nothingListens(`http://127.0.0.1:${await closedPort()}/engine-rest`),
  },
  {
    name: "tls-failure",
    engine: async () => {
      const engine = await startTlsEngine(inspectWorld)
      return { ...engine, endpoint: `${engine.origin}/engine-rest` }
    },
  },
  {
    name: "dns-failure",
    engine: () => Promise.resolve(nothingListens(`${UNRESOLVABLE_ORIGIN}/engine-rest`)),
  },
  {
    name: "too-large-response",
    engine: restRoot(() => ({
      raw: "{",
      contentType: "application/json",
      headers: { "Content-Length": MORE_THAN_THE_CAP },
      hold: true,
    })),
  },
  { name: "basic-password-euro", engine: restRoot(inspectWorld), credentials: basic("pässw€rd") },
  {
    name: "path-value-dot",
    engine: restRoot(inspectWorld),
    probes: ["getInstanceDetail .", "getInstanceDetail .."],
  },
  { name: "double-slash-root", engine: restRoot(inspectWorld, "/engine-rest//") },
  {
    name: "integer-beyond-2-53",
    engine: restRoot(withBigLong(inspectWorld)),
    probes: ["getInstanceDetail pi-1"],
  },
]

function call(runtime: ProcessRuntime, probe: Probe): Promise<unknown> {
  if (probe === "describeEngine") {
    return runtime.describeEngine()
  }
  return runtime.getInstanceDetail(InstanceId(probe.slice("getInstanceDetail ".length)))
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

async function probed<T>(engine: Engine, probe: Probe, attempt: () => Promise<T>): Promise<T> {
  engine.begin(ROUNDS[probe])
  const outcome = await attempt()
  const short = engine.shortRound()
  if (short !== undefined) {
    throw new Error(
      `${probe} started ${short} reads before the engine answered, not ${ROUNDS[probe]}: set its round to the reads it starts in parallel.`,
    )
  }
  return outcome
}

async function goldenOf(pinned: PinnedCase): Promise<Record<string, unknown>> {
  const engine = await pinned.engine()
  const connection = {
    endpoint: engine.endpoint,
    credentials: pinned.credentials ?? { kind: "none" },
  }
  try {
    const runtime = new C7Adapter(pinned.send ?? fetch).runtime(connection)
    const probes = []
    for (const probe of pinned.probes ?? ["describeEngine"]) {
      const outcome = await probed(engine, probe, () => outcomeOf(call(runtime, probe)))
      const sent = sentLines(engine.requests, probe === "describeEngine")
      probes.push({ call: probe, outcome, sent })
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

describe("what the C7 adapter reports when an engine call fails", () => {
  test.each(PINNED.map((pinned) => [pinned.name, pinned] as const))("%s", async (name, pinned) => {
    assertGolden(name, withoutPorts(await goldenOf(pinned)))
  })

  test("the README names every case, and exactly the pinned ones have a golden", () => {
    expectReadmeMatches(PINNED.map((entry) => entry.name))
  })
})
