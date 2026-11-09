/**
 * `$schema` in a project file through `run()`: commands read the file as before, every edit
 * keeps the key in its place and the output never shows it.
 */

import { describe, expect, it } from "vitest"
import { BASE_URL, fakeServer, json } from "../../test/support/fake-fetch.js"
import {
  execute,
  fakeRuntime,
  type FakeRuntime,
  fileText,
} from "../../test/support/fake-runtime.js"
import { run } from "./run.js"

const REPO = "/home/tester/repo"
const PROJECT = `${REPO}/.pulse-cli.json`
const SCHEMA = "https://unpkg.com/@miragon/pulse-profile/schema/pulse.schema.json"

function runtimeOf(): FakeRuntime {
  const server = fakeServer()
    .on("GET", "/version", json({ version: "7.24.0" }))
    .on("GET", "/engine", json([{ name: "default" }]))
  const project = { $schema: SCHEMA, defaultProfile: "svc", profiles: { svc: { url: BASE_URL } } }
  return fakeRuntime({
    fetch: server.fetch,
    cwd: `${REPO}/src`,
    dirs: [`${REPO}/.git`],
    files: { [PROJECT]: JSON.stringify(project) },
  })
}

async function cli(runtime: FakeRuntime, args: readonly string[]) {
  runtime.stdout.chunks.length = 0
  runtime.stderr.chunks.length = 0
  return execute(run, args, runtime)
}

describe("$schema in the project file", () => {
  it("is read past and kept first by every edit", async () => {
    const runtime = runtimeOf()
    expect(await cli(runtime, ["ping", "-o", "json"])).toMatchObject({ code: 0 })
    for (const args of [
      ["config", "set", "b", "--project", "--url", "http://b/engine-rest"],
      ["config", "use", "b", "--project"],
      ["config", "unset", "b", "url", "--project"],
      ["config", "delete", "svc", "--project"],
    ]) {
      expect(await cli(runtime, args), args.join(" ")).toMatchObject({ code: 0 })
      expect(fileText(runtime, PROJECT), args.join(" ")).toMatch(/^\{\n {2}"\$schema": "https:/)
    }
    expect(JSON.parse(fileText(runtime, PROJECT) ?? "")).toEqual({
      $schema: SCHEMA,
      defaultProfile: "b",
      profiles: { b: {} },
    })
  })

  it("never shows up in config list or config show", async () => {
    const runtime = runtimeOf()
    const list = await cli(runtime, ["config", "list", "-o", "json"])
    const show = await cli(runtime, ["config", "show", "-o", "json"])
    expect(list.stdout + show.stdout).not.toContain("$schema")
    expect(show.code).toBe(0)
  })
})
