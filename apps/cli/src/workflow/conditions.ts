/** `--until` of the wait commands: @miragon/pulse-c7-core's conditions with usage errors. */

import * as core from "@miragon/pulse-c7-core"
import { rendered } from "./error-text.js"

/** The condition of an `--until` value; anything else is a usage error. */
export function parseCondition(raw: string): core.Condition {
  return rendered(() => core.parseCondition(raw))
}
