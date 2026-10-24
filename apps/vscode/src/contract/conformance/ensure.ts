import { RuntimeError } from "../model/runtime-error.js"
import type { WriteVisibility } from "./command-harness.js"
import { ConformanceViolation } from "./conformance-violation.js"

const RECHECK_INTERVAL_MS = 100

export class Ensure {
  static async eventually(
    check: () => Promise<void>,
    visibility: WriteVisibility | undefined,
  ): Promise<void> {
    const deadline = Date.now() + (visibility?.withinMs ?? 0)
    for (;;) {
      const violation = await check().then(
        () => undefined,
        (error: unknown) => Ensure.violationOnly(error),
      )
      if (violation === undefined) {
        return
      }
      if (visibility === undefined || Date.now() >= deadline) {
        throw violation
      }
      await visibility.wait(RECHECK_INTERVAL_MS)
    }
  }

  static that(condition: boolean, law: string, detail: string): asserts condition {
    if (!condition) {
      throw new ConformanceViolation(law, detail)
    }
  }

  static defined<Value>(value: Value | undefined, law: string, detail: string): Value {
    Ensure.that(value !== undefined, law, detail)
    return value
  }

  static sameSet(actual: readonly string[], expected: readonly string[], law: string): void {
    const sortedActual = [...actual].sort()
    const sortedExpected = [...expected].sort()
    Ensure.that(
      JSON.stringify(sortedActual) === JSON.stringify(sortedExpected),
      law,
      `expected ${JSON.stringify(sortedExpected)}, got ${JSON.stringify(sortedActual)}`,
    )
  }

  static async rejected(attempt: Promise<void>, law: string, what: string): Promise<void> {
    const outcome = await attempt.then(
      () => "succeeded",
      (error: unknown) => (RuntimeError.is(error) ? error.failure : Ensure.describe(error)),
    )
    Ensure.that(outcome === "rejected", law, `${what}: expected "rejected", got ${outcome}`)
  }

  static describe(value: unknown): string {
    return value === undefined ? "undefined" : JSON.stringify(value)
  }

  private static violationOnly(error: unknown): ConformanceViolation {
    if (error instanceof ConformanceViolation) {
      return error
    }
    throw error
  }
}
