/** The dependencies of every auth provider on a fake runtime, and the token directory. */

import type { AuthDeps } from "../../src/auth/index.js"
import type { TraceEvent } from "../../src/http/types.js"
import type { FakeRuntime } from "./fake-runtime.js"

/** The token directory of the fake runtime's home on Linux. */
export const TOKEN_DIR = "/home/tester/.config/pulse-cli/tokens"

/** The clock, the token cache, the fake shell and the scope of the token cache (the working directory). */
export function authDeps(
  runtime: FakeRuntime,
  overrides: Partial<AuthDeps> & { readonly events?: TraceEvent[] } = {},
): AuthDeps {
  const { events, ...rest } = overrides
  return {
    fs: runtime.fs,
    now: () => runtime.now(),
    tokenDir: TOKEN_DIR,
    tokenPath: (fileName) => `${TOKEN_DIR}/${fileName}`,
    timeoutMs: 30_000,
    runCommand: (command, options) => runtime.runCommand(command, options),
    scope: runtime.cwd,
    target: { url: "http://localhost:8080/engine-rest" },
    ...(events === undefined ? {} : { trace: (event: TraceEvent) => events.push(event) }),
    ...rest,
  }
}
