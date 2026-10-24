/**
 * Shared helpers of the bearer token tests through `run()` (src/cli/bearer*.test.ts): the fake
 * engine, the parsed error line and a config file with profiles.
 */

import { fakeServer, json } from "./fake-fetch.js"

export function server(status = 200) {
  const reply = () =>
    status === 200
      ? json([])
      : new Response("Jwt is expired", { status, headers: { "content-type": "text/plain" } })
  return fakeServer()
    .on("GET", "/task", reply)
    .on("POST", "/message", reply)
    .on("GET", "/version", json({ version: "7.24.0" }))
    .on("GET", "/engine", json([{ name: "default" }]))
}

export function errorOf(stderr: string): Record<string, unknown> {
  return (JSON.parse(stderr) as { error: Record<string, unknown> }).error
}

export function profiles(value: Record<string, unknown>, defaultProfile = "p"): string {
  return JSON.stringify({ defaultProfile, profiles: value })
}
