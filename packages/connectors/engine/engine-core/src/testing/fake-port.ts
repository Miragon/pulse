/** A recording engine port over canned answers, and a fake clock, for tests of the workflows. */

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
