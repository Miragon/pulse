/**
 * Shared fixtures and helpers of the operation command tests through `run()`
 * (src/cli/operation*.test.ts): engine replies, the error line and the one recorded request.
 */

import { expect } from "vitest"
import type { FakeServer, RecordedRequest } from "./fake-fetch.js"

export const TASKS = [
  { id: "t1", name: "Approve", assignee: null, links: [] },
  { id: "t2", name: "Review", assignee: "demo", links: [] },
]
export const XML = '<definitions id="d"/>'

export function errorOf(stderr: string): Record<string, unknown> {
  return (JSON.parse(stderr) as { error: Record<string, unknown> }).error
}

export function only(server: FakeServer): RecordedRequest {
  expect(server.requests).toHaveLength(1)
  return server.requests[0]!
}

export function bodyOf(request: RecordedRequest): unknown {
  return JSON.parse(request.body as string)
}
