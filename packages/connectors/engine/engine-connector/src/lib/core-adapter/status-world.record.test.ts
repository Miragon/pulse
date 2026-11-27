/**
 * The recording script of c7-core's recorded status engine (`C7_STATUS_ENGINE`, its
 * src/testing/status-engine.json) and of the status world's screens (`C7_STATUS_SCREENS`, its
 * src/testing/status-screens.json), the server's half: it records only with RECORD_STATUS_WORLD=1,
 * which `record:status-world` of this package sets (Docker), and `pnpm record:status-world` from
 * the repository's root runs it, then the CLI's half (apps/cli/src/cli/status-world.numbers.test.ts
 * with the same variable), which adds what `pulse status` prints over the answers this half keeps.
 * Every other run skips it, `pnpm test` among them, and loads none of its engine code.
 *
 * It starts operaton/operaton:2.1.5 twice, at history level FULL and at NONE, seeds c7-core's
 * status world into both (`seedC7StatusWorld`), puts a recording proxy in front of each and reads,
 * with the clock held at one instant (`asOf`, the second after the seeds), what `engine_status`,
 * the web app's verdict feed and the chat overview's health feed give of each, through the
 * module's own tools, by the default thresholds and at the two on the world's edge
 * (`ENGINE_HEALTH_CRITICAL_INCIDENTS` at the root incidents engine_status counts, and one more);
 * then it writes each engine's answers and what each surface gave. Through a proxy of their own in
 * front of the engine at FULL, at the same instant, it reads the screens the multi-instance body
 * changes (the process screen of pulse-status-approval, the instance screen of APR-139-2, a board
 * with a diagram of that process) and writes their answers and what the feeds gave. It fails where
 * the recorded engine could not replay an answer (recording-proxy.test-support.ts).
 */

import { writeFileSync } from "node:fs"
import { expect, test, vi } from "vitest"
import type { C7EdgeVerdict, C7StatusWorldIds } from "@miragon/pulse-c7-core/testing"
import type { RecordingProxy } from "./recording-proxy.test-support.js"
import type { StatusSurfaces } from "./status-surfaces.test-support.js"
import type { StatusEngine } from "./status-world.test-support.js"

const RECORDING_RUN = process.env.RECORD_STATUS_WORLD === "1"
if (RECORDING_RUN && process.env.CI) {
  throw new Error("RECORD_STATUS_WORLD is forbidden in CI: the recording changes only by a diff.")
}

const IMAGE = "operaton/operaton:2.1.5"
/** Two engines to start and seed, then the reads: well past a test's usual limit. */
const RECORDING_TAKES_MS = 600_000
const RECORDING = new URL(
  "../../../../../c7/c7-core/src/testing/status-engine.json",
  import.meta.url,
)
const SCREENS_RECORDING = new URL(
  "../../../../../c7/c7-core/src/testing/status-screens.json",
  import.meta.url,
)

const ABOUT =
  "The status world of @miragon/pulse-c7-core/testing (seedC7StatusWorld: a call chain whose " +
  "call activity holds a copy of the called instance's root incident, a multi-instance body's " +
  "root incident beside an instance whose three items wait at the same element, a suspended " +
  "batch's incident outside any process) seeded into operaton/operaton:2.1.5 twice, at history " +
  "level full and at none; each engine's answers to the reads of engine_status (and pulse status, " +
  "both c7-core's readStatus), the web app's verdict feed and the chat overview's health feed at " +
  "asOf, what each of them gives and what the server's three judge at the two thresholds on the " +
  "world's edge (ENGINE_HEALTH_CRITICAL_INCIDENTS at the root incidents engine_status counts and " +
  "at one more), recorded by pnpm record:status-world."

const SCREENS_ABOUT =
  "The status world of @miragon/pulse-c7-core/testing (seedC7StatusWorld) seeded into " +
  "operaton/operaton:2.1.5 at history level full: the engine's answers to the reads of the " +
  "process screen of pulse-status-approval, the instance screen of APR-139-2, whose " +
  "multi-instance body holds the root incident, and a board with a diagram of that process, at " +
  "asOf, and what the MCP server's feeds give of them, which the editors' C7 adapter builds " +
  "alike, recorded by pnpm record:status-world."

/** What the server's surfaces give of one engine, by default and at the world's edge. */
interface Judged {
  readonly surfaces: StatusSurfaces
  readonly atEdges: readonly C7EdgeVerdict[]
}

/**
 * The server's surfaces of each engine through its proxy, the clock held at `asOf`: all three of
 * one engine at once, by the default thresholds, then at the root incidents engine_status counted
 * and at one more, the engines one after the other.
 */
async function readAt(
  asOf: Date,
  engines: readonly StatusEngine[],
  proxies: readonly RecordingProxy[],
): Promise<Judged[]> {
  const { judgedAt, statusServer } = await import("./status-surfaces.test-support.js")
  vi.useFakeTimers({ toFake: ["Date"], now: asOf })
  try {
    const profiles = engines.map(({ engine }, index) => ({
      engine,
      url: `${proxies[index]?.origin ?? ""}/engine-rest`,
    }))
    const server = statusServer(profiles, "operaton")
    const judged: Judged[] = []
    for (const { engine } of engines) {
      const surfaces = await server.readAll(engine)
      const roots = (surfaces.engineStatus as { rootIncidentsTotal: number }).rootIncidentsTotal
      const atEdges = []
      for (const at of [roots, roots + 1]) {
        atEdges.push(await judgedAt(profiles, "operaton", engine, at))
      }
      judged.push({ surfaces, atEdges })
    }
    return judged
  } finally {
    vi.useRealTimers()
  }
}

/**
 * The status world's screens of `engine` (the one at FULL) through a proxy of their own, the clock
 * held at `asOf`, the instance screen of its failing approval (APR-139-2): the recording.
 */
async function recordScreens(asOf: Date, engine: StatusEngine, ids: C7StatusWorldIds) {
  const { readStatusScreens, statusBoardFile } = await import("./status-screens.test-support.js")
  const { startRecordingProxy } = await import("./recording-proxy.test-support.js")
  const proxy = await startRecordingProxy(new URL(engine.url).origin)
  vi.useFakeTimers({ toFake: ["Date"], now: asOf })
  try {
    const file = statusBoardFile(engine.engine)
    const url = `${proxy.origin}/engine-rest`
    const expected = await readStatusScreens(
      { engine: engine.engine, url, flavor: "operaton" },
      `${JSON.stringify(file, undefined, 2)}\n`,
      ids.instanceIds.failing,
    )
    expect(proxy.problems).toEqual([])
    const answers = proxy.answers()
    return {
      about: SCREENS_ABOUT,
      engine: engine.engine,
      asOf: asOf.toISOString(),
      file,
      answers,
      expected,
    }
  } finally {
    vi.useRealTimers()
    await proxy.close()
  }
}

test.skipIf(!RECORDING_RUN)(
  "records the status world on Operaton 2.1.5 at history levels full and none, and its screens",
  { timeout: RECORDING_TAKES_MS },
  async () => {
    const { seedStatusEngines, startStatusEngines, stopAll } =
      await import("./status-world.test-support.js")
    const { startRecordingProxy } = await import("./recording-proxy.test-support.js")
    const engines = await startStatusEngines(IMAGE)
    const proxies: RecordingProxy[] = []
    try {
      const ids = await seedStatusEngines(engines)
      for (const { url } of engines) proxies.push(await startRecordingProxy(new URL(url).origin))
      const asOf = new Date(Math.ceil(Date.now() / 1000) * 1000)
      const judged = await readAt(asOf, engines, proxies)
      expect(proxies.flatMap((proxy) => proxy.problems)).toEqual([])
      const recorded = engines.map(({ engine }, index) => ({
        engine,
        historyLevel: engine,
        answers: proxies[index]?.answers() ?? [],
        // The CLI's half writes what `pulse status` prints over these answers.
        expected: { cliStatus: null, ...judged[index]?.surfaces, atEdges: judged[index]?.atEdges },
      }))
      const recording = { about: ABOUT, asOf: asOf.toISOString(), engines: recorded }
      const [full] = engines
      const [fullIds] = ids
      if (full === undefined || fullIds === undefined)
        throw new Error("no engine at history level full")
      const screens = await recordScreens(asOf, full, fullIds)
      writeFileSync(RECORDING, `${JSON.stringify(recording, undefined, 2)}\n`)
      writeFileSync(SCREENS_RECORDING, `${JSON.stringify(screens, undefined, 2)}\n`)
    } finally {
      await Promise.all(proxies.map((proxy) => proxy.close()))
      await stopAll(engines)
    }
  },
)
