import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"
import { REPO_ROOT } from "./source-scan.mjs"

/**
 * test:web's chain engine (apps/mcp-server/test-host/chain-engine.ts) replays c7-core's recorded
 * screen engine (C7_SCREEN_ENGINE, one Operaton run of the conformance world), whose screens the
 * engine connector's instance-screen-data.numbers.test.ts and the editors' adapters build exactly.
 * The MCP server's app may not import a family core (family-core-consumers), so its test host keeps
 * a copy of the recording's answers, fixtures/chain-engine.json, under a header of its own. This
 * guard holds the copy's answers to the recording's, so a recording made anew reaches the journey
 * test:web follows, and that journey never replays a world the numbers tests no longer hold.
 */

/** The recording and its copy, each a JSON file with the engine's answers under `answers`. */
const RECORDING = "packages/connectors/c7/c7-core/src/testing/screen-engine.json"
const COPY = "apps/mcp-server/test-host/fixtures/chain-engine.json"

/** The answers of a recorded engine: what each request was answered with, in the recorded order. */
function answersOf(rel) {
  const recorded = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"))
  assert.ok(Array.isArray(recorded.answers), `${rel} holds no answers`)
  return recorded.answers
}

/** The requests in `answers` that `other` answers differently or not at all, as their keys. */
function driftOf(answers, other) {
  const keyOf = (answer) =>
    [
      answer.method,
      answer.path,
      JSON.stringify(answer.query ?? {}),
      JSON.stringify(answer.body ?? null),
    ].join(" ")
  const theirs = new Map(other.map((answer) => [keyOf(answer), JSON.stringify(answer)]))
  const ours = new Map(answers.map((answer) => [keyOf(answer), JSON.stringify(answer)]))
  return [
    ...[...ours].filter(([key, text]) => theirs.get(key) !== text).map(([key]) => key),
    ...[...theirs.keys()].filter((key) => !ours.has(key)),
  ].sort()
}

describe("the chain engine's copy of c7-core's recorded screen engine", () => {
  it("answers every request as the recording does, in its order", () => {
    const recording = answersOf(RECORDING)
    const copy = answersOf(COPY)
    assert.deepEqual(
      driftOf(copy, recording),
      [],
      `${COPY} drifted from ${RECORDING}: copy the recording's answers again`,
    )
    assert.deepEqual(copy, recording)
  })

  it("names a request the copy answers otherwise, misses or adds", () => {
    const one = { method: "GET", path: "/engine-rest/incident", answer: [] }
    const two = { method: "GET", path: "/engine-rest/job", query: { a: "1" }, answer: [] }
    assert.deepEqual(driftOf([one, two], [one, two]), [])
    assert.deepEqual(driftOf([{ ...one, answer: [1] }, two], [one, two]), [
      "GET /engine-rest/incident {} null",
    ])
    assert.deepEqual(driftOf([one], [one, two]), ['GET /engine-rest/job {"a":"1"} null'])
    assert.deepEqual(driftOf([one, two], [one]), ['GET /engine-rest/job {"a":"1"} null'])
  })
})
