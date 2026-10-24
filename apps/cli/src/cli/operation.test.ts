import { describe, expect, it } from "vitest"
import { bodyOf, errorOf, only, TASKS, XML } from "../../test/support/cli-operation.js"
import {
  BASE_URL,
  fakeServer,
  type FakeServer,
  json,
  noContent,
  text,
} from "../../test/support/fake-fetch.js"
import {
  CONFIG_PATH,
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
  fileText,
} from "../../test/support/fake-runtime.js"
import { run } from "./run.js"

function cli(server: FakeServer, args: readonly string[], options: FakeRuntimeOptions = {}) {
  return execute(run, args, fakeRuntime({ fetch: server.fetch, ...options }))
}

describe("operation commands: output", () => {
  it("prints compact JSON with the --fields projection when stdout is a pipe", async () => {
    const server = fakeServer().on("GET", "/task", json(TASKS))
    const result = await cli(server, ["task", "list", "--assignee", "demo", "--fields", "id,name"])
    expect(result).toMatchObject({
      code: 0,
      stdout: '[{"id":"t1","name":"Approve"},{"id":"t2","name":"Review"}]\n',
      stderr: "",
    })
    expect(only(server).url).toBe(`${BASE_URL}/task?assignee=demo`)
    expect(only(server).headers.accept).toBe("application/json")
  })

  it("prints a table on a terminal, limited to the terminal width", async () => {
    const server = fakeServer().on("GET", "/task", json(TASKS))
    const result = await cli(server, ["task", "list"], { stdoutTTY: true, columns: 80 })
    expect(result.stdout).toBe("id  name     assignee\nt1  Approve\nt2  Review   demo\n")
  })

  it("prints pretty JSON on a terminal with -o json", async () => {
    const server = fakeServer().on("GET", "/task", json([{ id: "t1" }]))
    const result = await cli(server, ["task", "list", "-o", "json"], { stdoutTTY: true })
    expect(result.stdout).toBe('[\n  {\n    "id": "t1"\n  }\n]\n')
  })

  it("prints only the number of a count in a table", async () => {
    const server = fakeServer().on("GET", "/process-instance/count", json({ count: 7 }))
    const table = await cli(server, ["process-instance", "count", "-o", "table"])
    expect(table.stdout).toBe("7\n")
    const asJson = await cli(server, ["process-instance", "count"])
    expect(asJson.stdout).toBe('{"count":7}\n')
  })

  it("prints a Done line on stderr for 204 responses", async () => {
    const server = fakeServer().on("POST", "/task/t1/claim", noContent())
    const result = await cli(server, ["task", "claim", "t1", "--user-id", "demo"])
    expect(result).toMatchObject({
      code: 0,
      stdout: "",
      stderr: "Done: POST /task/t1/claim → 204 No Content\n",
    })
    expect(bodyOf(only(server))).toEqual({ userId: "demo" })
    expect(only(server).headers["content-type"]).toBe("application/json")
  })

  it("keeps the engine prefix and the query in the Done line", async () => {
    const server = fakeServer().on("DELETE", "/engine/e1/process-instance/p1", noContent())
    const result = await cli(server, [
      "process-instance",
      "delete",
      "p1",
      "--skip-custom-listeners",
      "--yes",
      "--engine",
      "e1",
    ])
    expect(result.stderr).toBe(
      "Done: DELETE /engine/e1/process-instance/p1?skipCustomListeners=true → 204 No Content\n",
    )
  })

  it("prints text responses raw", async () => {
    const server = fakeServer().on("GET", "/task", text("plain", "text/plain"))
    const result = await cli(server, ["task", "list"])
    expect(result.stdout).toBe("plain\n")
  })
})

describe("operation commands: lossless numbers, field warnings, terminals", () => {
  const LONG = '{"type":"Long","value":9223372036854775807,"valueInfo":{}}'

  it("prints and writes Long values beyond 2^53 exactly", async () => {
    const server = fakeServer().on(
      "GET",
      "/process-instance/p1/variables/big",
      text(LONG, "application/json"),
    )
    const args = ["process-instance", "get-variable", "p1", "big"]
    expect((await cli(server, args)).stdout).toBe(`${LONG}\n`)
    const table = await cli(server, [...args, "-o", "table"])
    expect(table.stdout).toContain("9223372036854775807")
    const file = await cli(server, [...args, "--out-file", "/v.json"])
    expect(fileText(file.runtime, "/v.json")).toBe(LONG)
  })

  it("sends Long values of --body and --var exactly", async () => {
    const server = fakeServer().on("POST", "/process-definition/key/order/start", json({ id: "x" }))
    await cli(server, [
      "process-definition",
      "start",
      "order",
      "--body",
      '{"variables":{"a":{"type":"Long","value":9007199254740993}}}',
      "--var",
      "b=9223372036854775807",
    ])
    expect(only(server).body).toBe(
      '{"variables":{"a":{"type":"Long","value":9007199254740993},"b":{"value":9223372036854775807,"type":"Long"}}}',
    )
  })

  it("warns on stderr about --fields that match nothing, and still succeeds", async () => {
    const server = fakeServer().on("GET", "/task", json(TASKS))
    const result = await cli(server, ["task", "list", "--fields", "id,nme"])
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('[{"id":"t1"},{"id":"t2"}]\n')
    expect(result.stderr).toBe(
      'Warning: field "nme" not found in the response (fields: id, name, assignee, links)\n',
    )
    const empty = fakeServer().on("GET", "/task", json([]))
    expect((await cli(empty, ["task", "list", "--fields", "nme"])).stderr).toBe("")
  })

  it("replaces control characters of text responses on a terminal only", async () => {
    const hostile = "hello \u001b]0;PWNED\u0007 \u001b[2J"
    const server = fakeServer().on(
      "GET",
      "/deployment/d1/resources/r1/data",
      text(hostile, "text/plain"),
    )
    const args = ["deployment", "get-resource-data", "d1", "r1"]
    const tty = await cli(server, args, { stdoutTTY: true })
    expect(tty.stdout).toBe("hello \ufffd]0;PWNED\ufffd \ufffd[2J\n")
    const pipe = await cli(server, args)
    expect(pipe.stdout).toBe(`${hostile}\n`)
  })

  it("uses 120 columns on a terminal that reports 0 columns", async () => {
    const server = fakeServer().on("GET", "/version", json({ version: "7.24.0" }))
    const result = await cli(server, ["version", "get"], { stdoutTTY: true, columns: 0 })
    expect(result.stdout).toBe("FIELD    VALUE\nversion  7.24.0\n")
  })
})

describe("operation commands: unwrap", () => {
  const server = () =>
    fakeServer().on("GET", "/process-definition/key/order/xml", json({ id: "p1", bpmn20Xml: XML }))

  it("prints the XML raw by default", async () => {
    const result = await cli(server(), ["process-definition", "xml", "order"])
    expect(result.stdout).toBe(`${XML}\n`)
  })

  it("prints the JSON with an explicit -o json, OPERATE_OUTPUT=json or --fields", async () => {
    const explicit = await cli(server(), ["process-definition", "xml", "order", "-o", "json"])
    expect(explicit.stdout).toBe(`{"id":"p1","bpmn20Xml":${JSON.stringify(XML)}}\n`)
    const env = await cli(server(), ["process-definition", "xml", "order"], {
      env: { OPERATE_OUTPUT: "json" },
    })
    expect(env.stdout).toBe(explicit.stdout)
    const fields = await cli(server(), ["process-definition", "xml", "order", "--fields", "id"])
    expect(fields.stdout).toBe('{"id":"p1"}\n')
  })

  it("still unwraps with an explicit -o table", async () => {
    const result = await cli(server(), ["process-definition", "xml", "order", "-o", "table"])
    expect(result.stdout).toBe(`${XML}\n`)
  })
})

describe("operation commands: dry-run and guards", () => {
  it("prints the request preview with curl and sends nothing", async () => {
    const server = fakeServer()
    const result = await cli(server, [
      "process-definition",
      "start",
      "order",
      "--business-key",
      "B-1",
      "--var",
      "amount=250",
      "--dry-run",
      "-H",
      "Authorization: Bearer secret",
    ])
    expect(result.code).toBe(0)
    expect(server.requests).toEqual([])
    const body = { businessKey: "B-1", variables: { amount: { value: 250, type: "Integer" } } }
    expect(JSON.parse(result.stdout)).toEqual({
      method: "POST",
      url: `${BASE_URL}/process-definition/key/order/start`,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer ***",
      },
      body,
      curl: `curl -X POST '${BASE_URL}/process-definition/key/order/start' -H 'Accept: application/json' -H 'Content-Type: application/json' -H 'Authorization: Bearer ***' --data-raw '${JSON.stringify(body)}'`,
    })
  })

  it("prints only the curl command in table format and secrets with --show-secrets", async () => {
    const result = await cli(fakeServer(), [
      "task",
      "list",
      "--dry-run",
      "-o",
      "table",
      "-H",
      "X-Api-Key: k1",
      "--show-secrets",
    ])
    expect(result.stdout).toBe(
      `curl '${BASE_URL}/task' -H 'Accept: application/json' -H 'X-Api-Key: k1'\n`,
    )
  })

  it("refuses delete operations without --yes and sends them with --yes", async () => {
    const server = fakeServer().on("DELETE", "/process-instance/p1", noContent())
    const refused = await cli(server, ["process-instance", "delete", "p1"])
    expect(refused.code).toBe(2)
    expect(refused.stdout).toBe("")
    expect(errorOf(refused.stderr)).toEqual({
      code: "CONFIRMATION_REQUIRED",
      exitCode: 2,
      message: "`operate process-instance delete` is a delete operation and needs confirmation",
      hint: "Re-run with --yes to confirm, or --dry-run to preview.",
    })
    expect(server.requests).toEqual([])
    const confirmed = await cli(server, ["process-instance", "delete", "p1", "-y"])
    expect(confirmed.code).toBe(0)
    expect(only(server).method).toBe("DELETE")
    const preview = await cli(server, ["process-instance", "delete", "p1", "--dry-run"])
    expect(preview.code).toBe(0)
    expect(server.requests).toHaveLength(1)
  })

  it("refuses writes in read-only mode and names the source", async () => {
    const server = fakeServer().on("GET", "/task", json([]))
    const flag = await cli(server, ["task", "claim", "t1", "--read-only"])
    expect(flag.code).toBe(2)
    expect(errorOf(flag.stderr)).toEqual({
      code: "READ_ONLY",
      exitCode: 2,
      message: "`operate task claim` is a write operation and read-only mode is enabled",
      hint: "Read-only mode is enabled by --read-only. Use --dry-run to preview the request.",
    })
    const env = await cli(server, ["task", "claim", "t1"], { env: { OPERATE_READ_ONLY: "yes" } })
    expect(errorOf(env.stderr).hint).toBe(
      "Read-only mode is enabled by OPERATE_READ_ONLY. Use --dry-run to preview the request.",
    )
    const config = JSON.stringify({ profiles: { prod: { readOnly: true } } })
    const profile = await cli(server, ["task", "claim", "t1", "--profile", "prod"], {
      files: { [CONFIG_PATH]: config },
    })
    expect(errorOf(profile.stderr).hint).toBe(
      'Read-only mode is enabled by profile "prod". Use --dry-run to preview the request.',
    )
    const read = await cli(server, ["task", "list", "--read-only"])
    expect(read).toMatchObject({ code: 0, stdout: "[]\n" })
    expect(server.requests.map((request) => request.method)).toEqual(["GET"])
  })

  it("validates the body before sending", async () => {
    const server = fakeServer()
    const result = await cli(server, ["task", "claim", "t1", "--body", '{"userid":"x"}'])
    expect(result.code).toBe(2)
    expect(errorOf(result.stderr)).toMatchObject({ code: "VALIDATION" })
    expect(server.requests).toEqual([])
    const skipped = await cli(server.on("POST", "/task/t1/claim", noContent()), [
      "task",
      "claim",
      "t1",
      "--body",
      '{"userid":"x"}',
      "--no-validate",
    ])
    expect(skipped.code).toBe(0)
    expect(bodyOf(only(server))).toEqual({ userid: "x" })
  })
})

describe("operation commands: paging, engine and headers", () => {
  it("fetches every page with --all", async () => {
    const pages = [[{ id: "a" }, { id: "b" }], [{ id: "c" }, { id: "d" }], [{ id: "e" }]]
    const server = fakeServer().on("GET", "/process-instance", (request) =>
      json(pages[Number(request.query.get("firstResult")) / 2] ?? []),
    )
    const result = await cli(server, ["process-instance", "list", "--all", "--max-results", "2"])
    expect(result.stdout).toBe('[{"id":"a"},{"id":"b"},{"id":"c"},{"id":"d"},{"id":"e"}]\n')
    expect(server.requests.map((request) => request.query.toString())).toEqual([
      "firstResult=0&maxResults=2",
      "firstResult=2&maxResults=2",
      "firstResult=4&maxResults=2",
    ])
  })

  it("adds the engine prefix and the configured headers", async () => {
    const server = fakeServer().on("GET", "/engine/second/task", json([]))
    const result = await cli(server, ["task", "list", "--engine", "second", "-H", "X-Tenant: a"], {
      env: { OPERATE_URL: `${BASE_URL}/` },
    })
    expect(result.code).toBe(0)
    expect(only(server).url).toBe(`${BASE_URL}/engine/second/task`)
    expect(only(server).headers["x-tenant"]).toBe("a")
  })

  it("sends presence flags that start with no- as true", async () => {
    const server = fakeServer().on("GET", "/job", json([]))
    await cli(server, ["job", "list", "--no-retries-left", "--no-timers"])
    expect(only(server).query.toString()).toBe("timers=false&noRetriesLeft=true")
  })
})
