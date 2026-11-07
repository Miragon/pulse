import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"
import { REPO_ROOT } from "./source-scan.mjs"

/**
 * The module list a copied `.env` of the starter runs. The starter's own
 * `server/test/env-example.test.ts` stays flexible, since an owner with a Prometheus may turn
 * analytics on, so the shipped value is held here, in a guard the mirror does not carry.
 * `compose.yaml` runs no Prometheus: with analytics in this list every boot warns about
 * `PROMETHEUS_URL` and every analytics tool fails.
 */
const liveModuleList = (content) => /^MCP_ACTIVE_MODULES=(.*)$/m.exec(content)?.[1]

describe("the starter's .env.example", () => {
  const file = path.join(REPO_ROOT, "templates/composed-server/.env.example")

  for (const [line, value] of [
    ["MCP_ACTIVE_MODULES=engine,notes", "engine,notes"],
    ["# MCP_ACTIVE_MODULES=engine,analytics,notes", undefined],
    ["MY_MCP_ACTIVE_MODULES=engine", undefined],
  ]) {
    it(`reads ${line} as ${value}`, () => {
      assert.equal(liveModuleList(`# a comment\n${line}\n`), value)
    })
  }

  it("runs what compose.yaml can serve: the engine and the example, no analytics", () => {
    assert.equal(liveModuleList(fs.readFileSync(file, "utf8")), "engine,notes")
  })
})
