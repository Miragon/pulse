import { spawn, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { readFileSync } from "node:fs"
import { createServer, type AddressInfo } from "node:net"
import path from "node:path"
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * What only a module installed from its tarball shows, on the BUILT starter as `pnpm start` runs
 * it: scripts/test-template.sh copies this file to `server/test/` of the starter copy that took
 * `@acme/mcp-board`, after its `pnpm build`. The boot passes the module's document through as
 * registered and keeps it out of everything that is the bundle's.
 */

const SERVER_DIR = path.join(import.meta.dirname, "..")
const SHOW_BOARD = "board_show_board"
const BOARD_FEED = "board_cards_data"
const BOARD_URI = "ui://board/board.html"
const BOARD_CSP = { connectDomains: ["https://api.example.com"] }
/** The first thing the boot writes into a document of the bundle, never into a module's own. */
const PRELUDE_MARKER = "__pulseViewConfig"
const READY_TIMEOUT_MS = 20_000

interface ViewContent {
  uri: string
  mimeType?: string
  text?: string
  _meta?: { ui?: { csp?: { resourceDomains?: string[] } } }
}

async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", resolve)
  })
  const { port } = probe.address() as AddressInfo
  await new Promise((resolve) => probe.close(resolve))
  return port
}

/** Waits for readiness; fails with the server's own output when it exits or never gets there. */
async function waitUntilReady(child: ChildProcess, origin: string, log: () => string) {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`the built server exited with ${String(child.exitCode)}:\n${log()}`)
    }
    const ready = await fetch(`${origin}/health/ready`).then(
      (response) => response.ok,
      () => false,
    )
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`the built server was not ready after ${READY_TIMEOUT_MS} ms:\n${log()}`)
}

describe("a prebuilt module with a finished HTML view, on the built starter", () => {
  let child: ChildProcess | undefined
  let client: Client | undefined

  const read = async (uri: string): Promise<ViewContent> => {
    const { contents } = await client!.readResource({ uri })
    expect(contents).toHaveLength(1)
    return contents[0] as ViewContent
  }

  beforeAll(async () => {
    const port = await freePort()
    const origin = `http://127.0.0.1:${port}`
    let output = ""
    // Only what `pnpm start` sets and what this server needs, nothing of the developer's shell. A
    // dead engine URL: the tools register fine, and no check here calls one.
    child = spawn(process.execPath, ["dist/index.js"], {
      cwd: SERVER_DIR,
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: String(port),
        MCP_ACTIVE_MODULES: "engine,notes,board",
        ENGINE_BASE_URL: "http://127.0.0.1:1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")))
    }
    await waitUntilReady(child, origin, () => output)
    client = new Client({ name: "prebuilt-module-test", version: "0.0.0" })
    await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)))
  })

  afterAll(async () => {
    await client?.close()
    if (!child || child.exitCode !== null) return
    const exited = once(child, "exit")
    child.kill("SIGTERM")
    const kill = setTimeout(() => child?.kill("SIGKILL"), 5_000)
    await exited
    clearTimeout(kill)
  })

  it("binds its tool to the module's resource in tools/list", async () => {
    const { tools } = await client!.listTools()
    const tool = tools.find(({ name }) => name === SHOW_BOARD)
    expect(tool?._meta).toMatchObject({
      ui: { resourceUri: BOARD_URI },
      "ui/resourceUri": BOARD_URI,
      "openai/outputTemplate": BOARD_URI,
      "openai/widgetCSP": { connect_domains: BOARD_CSP.connectDomains },
    })
  })

  it("lists the resource in resources/list", async () => {
    const { resources } = await client!.listResources()
    expect(resources.map(({ uri }) => uri)).toContain(BOARD_URI)
  })

  it("reads the document unchanged, under its own CSP, without the boot's prelude", async () => {
    const shipped = path.join(SERVER_DIR, "node_modules/@acme/mcp-board/dist/board.html")
    const board = await read(BOARD_URI)
    expect(board.text).toBe(readFileSync(shipped, "utf8"))
    expect(board.text).not.toContain(PRELUDE_MARKER)
    expect(board.mimeType).toBe("text/html;profile=mcp-app")
    expect(board._meta?.ui).toEqual({ csp: BOARD_CSP })
  })

  // What the module's read is held against: a view of the bundle gets both from the boot. The bundle
  // checks ask for a boolean or a list: a failed assertion on a megabyte of text takes minutes to
  // print.
  it("still serves a view of the bundle with the prelude and the fonts' origin", async () => {
    const cockpit = await read("ui://views/engine_open_cockpit.html")
    expect(cockpit.text?.includes(PRELUDE_MARKER)).toBe(true)
    expect(cockpit._meta?.ui?.csp?.resourceDomains?.length).toBeGreaterThan(0)
  })

  it("leaves nothing of the module in the Vite bundle", () => {
    const bundle = ["mcp-app.js", "mcp-app.css"]
      .map((file) => readFileSync(path.join(SERVER_DIR, "dist", file), "utf8"))
      .join("\n")
    expect(bundle.includes("engine_open_cockpit")).toBe(true)
    const markers = [SHOW_BOARD, BOARD_FEED, BOARD_URI, "Team board", "@acme/mcp-board"]
    expect(markers.filter((marker) => bundle.includes(marker))).toEqual([])
  })
})
