/** The PulseCliError an action throws, for the config tests (src/config/resolve*, edit*). */

import { PulseCliError } from "../../src/errors.js"

export function failure(action: () => unknown): PulseCliError {
  try {
    action()
  } catch (error) {
    if (error instanceof PulseCliError) return error
    throw error
  }
  throw new Error("expected an PulseCliError")
}
