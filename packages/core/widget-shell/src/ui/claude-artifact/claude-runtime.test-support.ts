import type { ClaudeMcp, ClaudeMcpAnswer, ClaudeRuntime } from "./claude-tool-caller.js"

/** The suites' stand-in for the artifact runtime, as the probe of 2026-11-25 saw it. */

export type CallArgs = Parameters<ClaudeMcp["callTool"]>

/**
 * Rejects as the runtime does: with `reason` as it is, a plain object (`{ code, message, server }`)
 * and never an `Error`, which is the contract the caller reads.
 */
export function rejectWith(reason: unknown): Promise<never> {
  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the runtime's own shape
  return Promise.reject(reason)
}

/** A refusal of the runtime: its code (none where undefined), its message, the connector's name. */
export function refusal(code: string | undefined, message: string, server = "Pulse") {
  return rejectWith({ ...(code === undefined ? {} : { code }), message, server })
}

/**
 * A runtime whose `mcp` capability answers `answer`, recording each call and each capability
 * asked for (none but `mcp` gives one).
 */
export function runtimeOf(answer: (...args: CallArgs) => Promise<ClaudeMcpAnswer>) {
  const calls: CallArgs[] = []
  const asked: string[] = []
  const runtime: ClaudeRuntime = {
    use: (capability) => {
      asked.push(capability)
      if (capability !== "mcp") return Promise.resolve(null)
      return Promise.resolve({
        callTool: (...args: CallArgs) => {
          calls.push(args)
          return answer(...args)
        },
      })
    },
  }
  return { runtime, calls, asked, uses: () => asked.length }
}
