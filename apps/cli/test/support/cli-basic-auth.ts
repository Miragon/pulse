/**
 * Shared helpers of the Basic auth tests through `run()` (src/cli/auth*.test.ts): the fake engine,
 * runs against it, the parsed error line and a config file with profiles.
 */

import type { Runtime } from "../../src/runtime.js"
import { fakeServer, json } from "./fake-fetch.js"
import { execute, fakeRuntime, type FakeRuntimeOptions } from "./fake-runtime.js"

/** The CLI entry point (`run` of src/cli/run.ts; test support code does not import the CLI layer). */
type Run = (argv: readonly string[], runtime: Runtime) => Promise<number>

function server(status = 200) {
  const reply = () =>
    status === 200
      ? json([])
      : new Response('{"type":"AuthenticationException","message":"Unauthorized"}', {
          status,
          headers: { "content-type": "application/json" },
        })
  return fakeServer()
    .on("GET", "/task", reply)
    .on("POST", "/message", reply)
    .on("GET", "/version", json({ version: "7.24.0" }))
    .on("GET", "/engine", json([{ name: "default" }]))
}

/** Runs the CLI against the fake engine (answering `status`) and adds the requests it sent. */
export function cliOf(run: Run) {
  return async (args: readonly string[], options: FakeRuntimeOptions = {}, status = 200) => {
    const fake = server(status)
    const outcome = await execute(run, args, fakeRuntime({ fetch: fake.fetch, ...options }))
    return { ...outcome, requests: fake.requests }
  }
}

export function errorOf(stderr: string): Record<string, unknown> {
  return (JSON.parse(stderr) as { error: Record<string, unknown> }).error
}

export function profiles(value: Record<string, unknown>, defaultProfile = "p"): string {
  return JSON.stringify({ defaultProfile, profiles: value })
}
