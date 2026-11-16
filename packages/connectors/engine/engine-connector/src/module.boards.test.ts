import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { engineConfigSchema, engineModule } from "./module.js"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function boardsDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-module-boards-"))
  dirs.push(dir)
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text)
  return dir
}

const ORDERS = JSON.stringify({
  title: "Orders",
  engines: ["default", "elsewhere"],
  rows: [{ row: [{ widget: "incidentSummary" }] }],
})

describe("ENGINE_BOARDS_DIR: the board files the module reads at configuration", () => {
  it("is a variable the module knows, so the typo warner keeps quiet about it", () => {
    expect(engineModule.knownEnvVars).toContain("ENGINE_BOARDS_DIR")
  })

  it("hands on the boards and the refused files, and nothing without the variable", () => {
    expect(engineModule.configFromEnv({})).not.toHaveProperty("boards")
    const dir = boardsDir({ "orders.board.json": ORDERS, "broken.board.json": "{" })
    const config = engineModule.configFromEnv({ ENGINE_BOARDS_DIR: dir })
    expect(config.boards).toEqual({
      boards: [
        {
          id: "orders",
          file: "orders.board.json",
          board: expect.objectContaining({ title: "Orders" }) as unknown,
          notes: [],
        },
      ],
      refused: [
        {
          id: "broken",
          file: "broken.board.json",
          problems: [{ path: "(file)", code: "notJson" }],
        },
      ],
    })
    expect(engineConfigSchema.parse(config).boards).toBe(config.boards)
  })

  it("fails the boot on a directory it cannot read, in one line naming the variable", () => {
    const missing = path.join(boardsDir({}), "boards")
    expect(() => engineModule.configFromEnv({ ENGINE_BOARDS_DIR: missing })).toThrow(
      `ENGINE_BOARDS_DIR=${missing} does not exist: it names the directory of the board files.`,
    )
    // The boot fails on the error itself, so the warnings add nothing about it.
    const warnings = engineModule.bootWarnings({ ENGINE_BOARDS_DIR: missing })
    expect(warnings.filter((warning) => warning.includes("ENGINE_BOARDS_DIR"))).toEqual([])
  })

  it("warns at boot of a refused file and of an engine no profile names", () => {
    const dir = boardsDir({ "orders.board.json": ORDERS, "broken.board.json": "{" })
    const warnings = engineModule.bootWarnings({
      ENGINE_BASE_URL: "http://engine.example/engine-rest",
      ENGINE_BOARDS_DIR: dir,
    })
    expect(warnings).toEqual([
      "The board file broken.board.json (ENGINE_BOARDS_DIR) gives no board: (file) is not valid JSON. The other boards show.",
      "The board file orders.board.json (ENGINE_BOARDS_DIR) names an engine no profile of this server names: elsewhere. The board shows it as not configured.",
    ])
  })

  it("holds the shape of the board files it hands on", () => {
    const engines = [{ id: "a", baseUrl: "http://a.example/engine-rest" }]
    expect(() => engineConfigSchema.parse({ engines, boards: { boards: [] } })).toThrow(
      /the boards and the refused files/,
    )
    expect(() =>
      engineConfigSchema.parse({ engines, boards: { boards: [], refused: [] } }),
    ).not.toThrow()
  })
})
