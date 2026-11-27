/**
 * A recording engine port over canned answers, the answer of a list whose one sort key ties and
 * whose ties the engine orders anew on every request, and a fake clock, for tests of the workflows.
 */

import {
  createEnginePort,
  type EngineFailure,
  type EnginePort,
  type EngineTransport,
  type OperationInput,
} from "../port.js"

/** The answer of one operation: a JSON value (a text for text operations), or a thrown `fakeFailure`. */
export type Route = (input: OperationInput) => unknown

export interface FakeCall {
  readonly operationId: string
  readonly input: OperationInput
}

/** An engine error answer, as the fake transport reads it back. */
export class FakeFailure extends Error {
  constructor(readonly failure: EngineFailure) {
    super(
      `HTTP ${failure.status}${failure.engineType === undefined ? "" : ` ${failure.engineType}`}`,
    )
    this.name = "FakeFailure"
  }
}

/** The error of an engine answer with `status` and the engine exception type. */
export function fakeFailure(status: number, engineType?: string): FakeFailure {
  return new FakeFailure(engineType === undefined ? { status } : { status, engineType })
}

export interface FakePort extends EnginePort {
  /** Every operation sent, in order. */
  readonly calls: readonly FakeCall[]
}

/**
 * A port whose transport answers each operation from `routes`; an operation without a route is
 * refused with an error, so a test pins the operations a workflow may send.
 */
export function fakePort(routes: Readonly<Partial<Record<string, Route>>>): FakePort {
  const calls: FakeCall[] = []
  const transport: EngineTransport = {
    async send(operationId, input) {
      calls.push({ operationId, input })
      const route = routes[operationId]
      if (route === undefined) throw new Error(`fakePort: no route for ${operationId}`)
      return await route(input)
    },
    json: (answer) => answer,
    text: (answer) => (typeof answer === "string" ? answer : undefined),
    failure: (error) => (error instanceof FakeFailure ? error.failure : undefined),
  }
  return { ...createEnginePort(transport), calls }
}

/** The runs of `rows` with the same key, in their order. */
function tiedRunsOf<Row>(rows: readonly Row[], keyOf: (row: Row) => string): Row[][] {
  const runs: { readonly key: string; readonly rows: Row[] }[] = []
  for (const row of rows) {
    const last = runs.at(-1)
    if (last?.key === keyOf(row)) last.rows.push(row)
    else runs.push({ key: keyOf(row), rows: [row] })
  }
  return runs.map((run) => run.rows)
}

/**
 * `rows` in the engine's order with each run of rows of the same key (`keyOf`) turned `turn`
 * places: an order a database may give rows its one sort key cannot tell apart.
 */
export function turnTies<Row>(
  rows: readonly Row[],
  keyOf: (row: Row) => string,
  turn: number,
): Row[] {
  return tiedRunsOf(rows, keyOf).flatMap((run) => {
    const by = turn % run.length
    return [...run.slice(by), ...run.slice(0, by)]
  })
}

/**
 * The answer of a list the engine orders by one key that ties (`keyOf`), such as the incidents
 * by `incidentTimestamp`: `rows` in the engine's order, every run of the same key turned one place
 * further on each request than on the last (`turnTies`, the first request as given), and of them
 * the rows from `firstResult` on, at most `maxResults` (all without them).
 */
export function turningTies<Row>(rows: readonly Row[], keyOf: (row: Row) => string): Route {
  let requests = 0
  return (input) => {
    const answer = turnTies(rows, keyOf, requests)
    requests += 1
    const first = Number(input.query.firstResult ?? 0)
    return answer.slice(first, first + Number(input.query.maxResults ?? answer.length))
  }
}

/** A fake clock: `sleep` advances it at once and records the sleeps. */
export function fakeClock(start = 1_700_000_000_000) {
  let now = start
  const sleeps: number[] = []
  return {
    sleeps,
    now: () => now,
    sleep: (ms: number) => {
      sleeps.push(ms)
      now += ms
      return Promise.resolve()
    },
  }
}
