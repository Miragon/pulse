/** The help text of a command through `run()`, for the help text tests (src/cli/**). */

import { expect } from "vitest"
import { execute, fakeRuntime } from "./fake-runtime.js"

type Run = Parameters<typeof execute>[0]

/**
 * Runs `<args> --help` with `run`. The test passes its `run`: test/support never imports the
 * command layer.
 */
export async function helpOf(run: Run, args: readonly string[]): Promise<string> {
  const result = await execute(run, [...args, "--help"], fakeRuntime())
  expect(result.code).toBe(0)
  return result.stdout
}
