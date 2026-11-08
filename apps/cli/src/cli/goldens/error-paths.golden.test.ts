/**
 * Error-path goldens (T0) of the CLI: the stderr line, the exit code and stdout of each way an
 * engine call can fail, byte for byte, with the requests the engine saw, through `run` and the
 * real `fetch` against loopback engines. The case names and the engine answers are
 * test/support/error-cases.ts's, the same on every surface; test/__golden__/error-paths/README.md
 * says per case what is pinned, what is not and why, and which later step changes a pinned bug.
 * Intended change: `pnpm --fail-if-no-match --filter @miragon/pulse-cli golden:update` (refused
 * in CI).
 */

import { afterEach, beforeEach, describe, it, vi } from "vitest"
import {
  echoesSecrets,
  missingInstance,
  outsideRestApp,
  redirectToLogin,
  unauthorized,
  withBigLong,
  type ErrorPathCase,
} from "../../../test/support/error-cases.js"
import { assertGolden, expectReadmeMatches, linesOf } from "../../../test/support/golden.js"
import { worldAnswer } from "../../../test/support/golden-world.js"
import { execute, fakeRuntime } from "../../../test/support/fake-runtime.js"
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
} from "../../../test/support/loopback-engine.js"
import { run } from "../run.js"

type Engine = Omit<LoopbackEngine, "origin"> & {
  /** The engine URL as configured (PULSE_CLI_URL). */
  readonly url: string
}

interface Probe {
  readonly argv: readonly string[]
  /** The reads the command starts before any answer: the engine answers none before they came. */
  readonly round: number
}

interface PinnedCase {
  readonly name: ErrorPathCase
  readonly engine: () => Promise<Engine>
  readonly env?: Readonly<Record<string, string>>
  /** The command lines to run; default: one process instance, a single GET. */
  readonly probes?: readonly Probe[]
}

/** A generated command: one process instance, a single GET. */
const GET_INSTANCE: Probe = { argv: ["process-instance", "get", "pi-1"], round: 1 }

/** A workflow command: its own operation lookup, the runtime and the history read in parallel. */
const INSPECT: Probe = { argv: ["inspect", "pi-1"], round: 2 }

/** The same command line for a person: the error as text instead of JSON. */
const asTable = (probe: Probe): Probe => ({ ...probe, argv: [...probe.argv, "-o", "table"] })

const at = (suffix: string, answer: EngineAnswer) => async (): Promise<Engine> => {
  const engine = await startEngine(answer)
  return { ...engine, url: `${engine.origin}${suffix}` }
}

const restRoot = (answer: EngineAnswer) => at("/engine-rest", answer)

const nothingListens = (url: string): Engine => ({
  url,
  requests: [],
  begin: () => undefined,
  shortRound: () => undefined,
  close: () => Promise.resolve(),
})

const BASIC = { PULSE_CLI_AUTH: "basic", PULSE_CLI_USERNAME: "demo" }
const BEARER = { PULSE_CLI_AUTH: "bearer" }

const PINNED: readonly PinnedCase[] = [
  { name: "redirect", engine: restRoot(redirectToLogin), probes: [GET_INSTANCE, INSPECT] },
  {
    name: "unauthorized-none",
    engine: restRoot(unauthorized),
    probes: [GET_INSTANCE, asTable(GET_INSTANCE), INSPECT],
  },
  {
    name: "unauthorized-basic",
    engine: restRoot(unauthorized),
    env: { ...BASIC, PULSE_CLI_PASSWORD: "demo-secret" },
  },
  {
    name: "unauthorized-bearer",
    engine: restRoot(unauthorized),
    env: { ...BEARER, PULSE_CLI_TOKEN: "tok-demo-123" },
  },
  {
    name: "wrong-rest-root",
    engine: at("", outsideRestApp(worldAnswer)),
    probes: [GET_INSTANCE, asTable(GET_INSTANCE), INSPECT],
  },
  { name: "missing-resource", engine: restRoot(missingInstance), probes: [GET_INSTANCE, INSPECT] },
  {
    name: "engine-text-echoes-secret-basic",
    engine: restRoot(echoesSecrets),
    env: { ...BASIC, PULSE_CLI_PASSWORD: "demo-secret" },
  },
  {
    name: "engine-text-echoes-secret-bearer",
    engine: restRoot(echoesSecrets),
    env: { ...BEARER, PULSE_CLI_TOKEN: "tok-demo-123" },
  },
  {
    name: "deadline-exceeded",
    engine: async () => {
      const engine = await startSilentEngine()
      return { ...engine, url: `${engine.origin}/engine-rest` }
    },
    env: { PULSE_CLI_TIMEOUT: "300" },
    probes: [GET_INSTANCE, INSPECT],
  },
  {
    name: "unreachable",
    engine: async () =>
      nothingListens(`http://127.0.0.1:${String(await closedPort())}/engine-rest`),
    probes: [GET_INSTANCE, asTable(GET_INSTANCE)],
  },
  {
    name: "tls-failure",
    engine: async () => {
      const engine = await startTlsEngine(worldAnswer)
      return { ...engine, url: `${engine.origin}/engine-rest` }
    },
  },
  {
    name: "dns-failure",
    engine: () => Promise.resolve(nothingListens(`${UNRESOLVABLE_ORIGIN}/engine-rest`)),
  },
  {
    name: "basic-password-euro",
    engine: restRoot(worldAnswer),
    env: { ...BASIC, PULSE_CLI_PASSWORD: "pässw€rd" },
  },
  {
    name: "path-value-dot",
    engine: restRoot(worldAnswer),
    probes: [".", ".."].map((id) => ({ argv: ["process-instance", "get", id], round: 0 })),
  },
  { name: "double-slash-root", engine: at("/engine-rest//", worldAnswer) },
  {
    name: "token-line-break-inside",
    engine: restRoot(worldAnswer),
    env: { ...BEARER, PULSE_CLI_TOKEN: "tok-demo-123\nsecond-line" },
  },
  {
    name: "token-line-break-trailing",
    engine: restRoot(worldAnswer),
    env: { ...BEARER, PULSE_CLI_TOKEN: "tok-demo-123\n" },
  },
  {
    name: "integer-beyond-2-53",
    engine: restRoot(withBigLong(worldAnswer)),
    probes: [{ argv: ["process-instance", "get-variables", "pi-1"], round: 1 }, INSPECT],
  },
]

/** Runs one command line behind the engine's barrier; a round it never filled fails the case. */
async function probed(engine: Engine, probe: Probe, env: Readonly<Record<string, string>>) {
  engine.begin(probe.round)
  const runtime = fakeRuntime({ env, fetch: globalThis.fetch })
  const outcome = await execute(run, probe.argv, runtime)
  const short = engine.shortRound()
  if (short !== undefined) {
    throw new Error(
      `pulse ${probe.argv.join(" ")} started ${String(short)} reads before the engine answered, ` +
        `not ${String(probe.round)}: set the probe's round to the reads it starts in parallel.`,
    )
  }
  return outcome
}

/** Runs each probe on a fresh runtime with the case's environment against its engine. */
async function goldenOf({ name, engine: start, env = {}, probes = [GET_INSTANCE] }: PinnedCase) {
  const engine = await start()
  const config = { PULSE_CLI_URL: engine.url, ...env }
  try {
    const results = []
    for (const probe of probes) {
      const outcome = await probed(engine, probe, config)
      results.push({
        argv: probe.argv,
        exitCode: outcome.code,
        stdoutLines: linesOf(outcome.stdout),
        stderrLines: linesOf(outcome.stderr),
        sent: sentLines(engine.requests),
      })
    }
    return { case: name, config, probes: results }
  } finally {
    await engine.close()
  }
}

beforeEach(() => {
  // No golden reads the local time today; one that starts to stays the same on every machine.
  vi.stubEnv("TZ", "UTC")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("what the CLI reports when an engine call fails", () => {
  it.each(PINNED.map((pinned) => [pinned.name, pinned] as const))("%s", async (name, pinned) => {
    assertGolden("error-paths", name, withoutPorts(await goldenOf(pinned)))
  })

  it("the README names every case, and exactly the pinned ones have a golden", () => {
    expectReadmeMatches(
      "error-paths",
      PINNED.map((pinned) => pinned.name),
    )
  })
})
