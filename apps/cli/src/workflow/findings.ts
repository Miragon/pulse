/** `--fail-on` of `pulse status`: CHECK_FAILED when the status reaches the level. */

import type { EngineStatus, Severity } from "@miragon/pulse-engine-core"
import { PulseCliError } from "../errors.js"

/** A finding as `pulse status` prints it: the next step as a command line. */
interface PrintedFinding {
  readonly severity: Severity
  readonly code: string
  readonly message: string
  readonly next?: string
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

/** CHECK_FAILED when the status reaches the `--fail-on` level. */
export function checkFailure(
  status: EngineStatus,
  list: readonly PrintedFinding[],
  failOn: Severity | undefined,
): PulseCliError | undefined {
  const reached = failOn === "warning" ? status !== "ok" : status === "critical"
  if (failOn === undefined || !reached) return undefined
  const next = list[0]?.next
  return new PulseCliError(
    "CHECK_FAILED",
    `Engine status is ${status} (${plural(list.length, "finding")})`,
    {
      hint: next === undefined ? "The findings say what is wrong." : `Start with: ${next}`,
      data: { status, findings: list },
    },
  )
}
