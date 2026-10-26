/** The CONFIG error (exit code 3) of every configuration problem. */

import { PulseCliError } from "../errors.js"

export function configError(message: string, hint?: string): PulseCliError {
  return new PulseCliError("CONFIG", message, hint === undefined ? {} : { hint })
}
