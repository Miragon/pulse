/** The OperateError an action throws, for the config tests (src/config/resolve*, edit*). */

import { OperateError } from "../../src/errors.js"

export function failure(action: () => unknown): OperateError {
  try {
    action()
  } catch (error) {
    if (error instanceof OperateError) return error
    throw error
  }
  throw new Error("expected an OperateError")
}
