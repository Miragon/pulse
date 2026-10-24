/** Operation commands through `run()`: binary responses, `--out-file` and the request input. */

import { describe, expect, it } from "vitest"
import { bodyOf, errorOf, only, XML } from "../../test/support/cli-operation.js"
import {
  binary,
  fakeServer,
  type FakeServer,
  json,
  noContent,
  text,
} from "../../test/support/fake-fetch.js"
import {
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
  fileText,
} from "../../test/support/fake-runtime.js"
import { run } from "./run.js"

function cli(server: FakeServer, args: readonly string[], options: FakeRuntimeOptions = {}) {
  return execute(run, args, fakeRuntime({ fetch: server.fetch, ...options }))
}

describe("operation commands: binary responses and --out-file", () => {
  const data = new Uint8Array([0, 1, 2, 255])
  const route = () =>
    fakeServer().on("GET", "/process-instance/p1/variables/file/data", binary(data))

  it("writes binary responses raw to a pipe", async () => {
    const result = await cli(route(), ["process-instance", "get-variable-binary", "p1", "file"])
    expect(result.code).toBe(0)
    expect(result.runtime.stdout.bytes()).toEqual(data)
  })

  it("refuses binary responses on a terminal", async () => {
    const result = await cli(route(), ["process-instance", "get-variable-binary", "p1", "file"], {
      stdoutTTY: true,
    })
    expect(result.code).toBe(2)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe(
      [
        "Error: Binary response (application/octet-stream); use --out-file <path>",
        "  Hint: Binary data is only written to stdout when it is redirected to a file or pipe.",
        "",
      ].join("\n"),
    )
  })

  it("writes the body to --out-file and prints a summary", async () => {
    const args = [
      "process-instance",
      "get-variable-binary",
      "p1",
      "file",
      "--out-file",
      "/tmp/f.bin",
    ]
    const result = await cli(route(), args)
    expect(result.stdout).toBe(
      '{"outFile":"/tmp/f.bin","bytes":4,"contentType":"application/octet-stream"}\n',
    )
    expect(result.runtime.files.get("/tmp/f.bin")?.data).toEqual(data)
    const table = await cli(route(), args, { stdoutTTY: true })
    expect(table.stdout).toBe("Wrote 4 bytes to /tmp/f.bin\n")
  })

  it("writes JSON, unwrapped XML, text and empty bodies to --out-file", async () => {
    const server = fakeServer()
      .on("GET", "/task", json([{ id: "t1" }]))
      .on("GET", "/process-definition/key/order/xml", json({ id: "p1", bpmn20Xml: XML }))
      .on("GET", "/process-instance/count", text("näh", "text/plain"))
      .on("POST", "/task/t1/claim", noContent())
    const list = await cli(server, ["task", "list", "--out-file", "/o/list.json"])
    // the response body exactly as received
    expect(fileText(list.runtime, "/o/list.json")).toBe('[{"id":"t1"}]')
    expect(list.stdout).toBe(
      '{"outFile":"/o/list.json","bytes":13,"contentType":"application/json"}\n',
    )
    const xml = await cli(server, ["process-definition", "xml", "order", "--out-file", "/o/p.bpmn"])
    expect(fileText(xml.runtime, "/o/p.bpmn")).toBe(`${XML}\n`)
    expect(JSON.parse(xml.stdout)).toEqual({
      outFile: "/o/p.bpmn",
      bytes: XML.length + 1,
      contentType: "application/xml",
    })
    const plain = await cli(server, ["process-instance", "count", "--out-file", "/o/c.txt"])
    expect(fileText(plain.runtime, "/o/c.txt")).toBe("näh")
    expect(JSON.parse(plain.stdout)).toMatchObject({ bytes: 4, contentType: "text/plain" })
    const none = await cli(server, ["task", "claim", "t1", "--out-file", "/o/none"])
    expect(fileText(none.runtime, "/o/none")).toBe("")
    expect(none.stdout).toBe('{"outFile":"/o/none","bytes":0,"contentType":""}\n')
    expect(none.stderr).toBe("")
  })

  it("keeps the final newline of unwrapped XML in --out-file", async () => {
    const server = fakeServer().on(
      "GET",
      "/process-definition/key/order/xml",
      json({ id: "p1", bpmn20Xml: `${XML}\n` }),
    )
    const result = await cli(server, ["process-definition", "xml", "order", "--out-file", "/p"])
    expect(fileText(result.runtime, "/p")).toBe(`${XML}\n`)
    const empty = fakeServer().on(
      "GET",
      "/process-definition/key/order/xml",
      json({ id: "p1", bpmn20Xml: "" }),
    )
    const none = await cli(empty, ["process-definition", "xml", "order", "--out-file", "/e"])
    expect(fileText(none.runtime, "/e")).toBe("")
  })

  it("writes the JSON of unwrap operations to --out-file with --fields", async () => {
    const server = fakeServer().on(
      "GET",
      "/process-definition/key/order/xml",
      json({ id: "p1", bpmn20Xml: XML }),
    )
    const args = ["process-definition", "xml", "order", "--fields", "id", "--out-file", "/p"]
    const result = await cli(server, args, { stdoutTTY: true })
    expect(fileText(result.runtime, "/p")).toBe('{\n  "id": "p1"\n}\n')
    expect(result.stdout).toBe("Wrote 17 bytes to /p\n")
  })

  it("writes the combined pages of --all to --out-file", async () => {
    const pages = [[{ id: "a" }, { id: "b" }], [{ id: "c" }]]
    const server = fakeServer().on("GET", "/process-instance", (request) =>
      json(pages[Number(request.query.get("firstResult")) / 2] ?? []),
    )
    const args = ["process-instance", "list", "--all", "--max-results", "2", "--out-file", "/a"]
    const result = await cli(server, args)
    expect(fileText(result.runtime, "/a")).toBe('[{"id":"a"},{"id":"b"},{"id":"c"}]\n')
  })

  it("warns about --fields of JSON responses written to --out-file, only for JSON", async () => {
    const server = fakeServer()
      .on("GET", "/task", json([{ id: "t1" }]))
      .on("GET", "/process-instance/count", text("7", "text/plain"))
    const list = await cli(server, ["task", "list", "--fields", "id,nme", "--out-file", "/l"])
    expect(fileText(list.runtime, "/l")).toBe('[{"id":"t1"}]\n')
    expect(list.stderr).toBe('Warning: field "nme" not found in the response (fields: id)\n')
    const count = await cli(server, [
      "process-instance",
      "count",
      "--fields",
      "nme",
      "--out-file",
      "/c",
    ])
    expect(fileText(count.runtime, "/c")).toBe("7")
    expect(count.stderr).toBe("")
  })

  it("reports any write failure of --out-file", async () => {
    const runtime = fakeRuntime({ fetch: fakeServer().on("GET", "/task", json([])).fetch })
    runtime.fs.writeFile = () => Promise.reject(new Error("disk full"))
    const failed = await execute(run, ["task", "list", "--out-file", "/o"], runtime)
    expect(errorOf(failed.stderr).message).toBe("Cannot write /o: disk full")
    const odd = fakeRuntime({ fetch: fakeServer().on("GET", "/task", json([])).fetch })
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error rejection
    odd.fs.writeFile = () => Promise.reject("quota")
    const result = await execute(run, ["task", "list", "--out-file", "/o"], odd)
    expect(errorOf(result.stderr).message).toBe("Cannot write /o: quota")
  })

  it("prints the dry-run preview instead of writing --out-file", async () => {
    const result = await cli(fakeServer(), ["task", "list", "--dry-run", "--out-file", "/o/x"])
    expect(JSON.parse(result.stdout)).toMatchObject({ method: "GET" })
    expect(result.runtime.files.has("/o/x")).toBe(false)
  })

  it("reports a file that cannot be written as usage error", async () => {
    const runtime = fakeRuntime({ fetch: fakeServer().on("GET", "/task", json([])).fetch })
    runtime.dirs.add("/o")
    const result = await execute(run, ["task", "list", "--out-file", "/o"], runtime)
    expect(result.code).toBe(2)
    expect(errorOf(result.stderr)).toEqual({
      code: "USAGE",
      exitCode: 2,
      message: "Cannot write /o: EISDIR: no such file or directory, open '/o'",
      hint: "Check the --out-file path.",
    })
  })
})

describe("operation commands: input", () => {
  it("names the example of deployment create when no file is given", async () => {
    const result = await cli(fakeServer(), ["deployment", "create", "--deployment-name", "x"])
    expect(errorOf(result.stderr)).toEqual({
      code: "USAGE",
      exitCode: 2,
      message: "At least one resource file is required",
      hint: "Example: operate deployment create order.bpmn approval.dmn --deployment-name orders",
    })
  })

  it("deploys resource files from the file system", async () => {
    const server = fakeServer().on("POST", "/deployment/create", json({ id: "d1" }))
    const result = await cli(
      server,
      ["deployment", "create", "bpmn/order.bpmn", "approval.dmn", "--deployment-name", "it"],
      { files: { "bpmn/order.bpmn": "<bpmn/>", "approval.dmn": "<dmn/>" } },
    )
    expect(result).toMatchObject({ code: 0, stdout: '{"id":"d1"}\n' })
    const form = only(server).body as FormData
    expect([...form.keys()]).toEqual(["deployment-name", "order.bpmn", "approval.dmn"])
    expect(await (form.get("order.bpmn") as File).text()).toBe("<bpmn/>")
  })

  it("reports a missing resource file as usage error", async () => {
    const result = await cli(fakeServer(), ["deployment", "create", "missing.bpmn"])
    expect(result.code).toBe(2)
    expect(errorOf(result.stderr)).toMatchObject({ message: "File not found: missing.bpmn" })
  })

  it("reads --body from a file and from stdin", async () => {
    const body = { workerId: "w1", maxTasks: 1, topics: [{ topicName: "t", lockDuration: 1000 }] }
    const server = fakeServer().on("POST", "/external-task/fetchAndLock", json([]))
    const fromFile = await cli(
      server,
      ["external-task", "fetch-and-lock", "--body", "@body.json"],
      {
        files: { "body.json": JSON.stringify(body) },
      },
    )
    expect(fromFile.code).toBe(0)
    const fromStdin = await cli(
      server,
      ["external-task", "fetch-and-lock", "--body", "-", "--max-tasks", "5"],
      {
        stdin: JSON.stringify(body),
      },
    )
    expect(fromStdin.code).toBe(0)
    expect(server.requests.map(bodyOf)).toEqual([body, { ...body, maxTasks: 5 }])
  })
})
