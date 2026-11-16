import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { BoardProblems } from "@miragon/pulse-board"
import { BOARD_FIXTURES } from "@miragon/pulse-board/testing"
import { BOARD_ID, boardProblemSentence } from "./board-files.js"
import { loadEngineBoards } from "./engine-boards.js"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** A directory holding `files` (name to text). */
function boardsDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-boards-"))
  dirs.push(dir)
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text)
  return dir
}

const board = (engines: readonly string[], title = "Orders") =>
  JSON.stringify({ title, engines, rows: [{ row: [{ widget: "incidentSummary" }] }] })

const thrownBy = (env: NodeJS.ProcessEnv): Error => {
  try {
    loadEngineBoards(env, [])
  } catch (error) {
    return error as Error
  }
  throw new Error("the boards loaded")
}

describe("loadEngineBoards reads the board files of ENGINE_BOARDS_DIR with the board format", () => {
  it("reads none without the variable, or with a blank one", () => {
    expect(loadEngineBoards({}, ["a"])).toBeUndefined()
    expect(loadEngineBoards({ ENGINE_BOARDS_DIR: "  " }, ["a"])).toBeUndefined()
  })

  it("gives every shared fixture the parser's verdict, under its file name as the id", () => {
    const files = Object.fromEntries(
      BOARD_FIXTURES.map((fixture) => [`${fixture.name}.board.json`, fixture.text]),
    )
    const read = loadEngineBoards({ ENGINE_BOARDS_DIR: boardsDir(files) }, ["shop"])!
    const sorted = [...BOARD_FIXTURES].sort((a, b) =>
      `${a.name}.board.json` < `${b.name}.board.json` ? -1 : 1,
    )
    expect(read.boards).toEqual(
      sorted.flatMap(({ name, verdict }) =>
        "board" in verdict
          ? [{ id: name, file: `${name}.board.json`, board: verdict.board, notes: verdict.notes }]
          : [],
      ),
    )
    expect(read.refused).toEqual(
      sorted.flatMap(({ name, verdict }) =>
        "problems" in verdict
          ? [{ id: name, file: `${name}.board.json`, problems: verdict.problems }]
          : [],
      ),
    )
    expect(read.boards.length).toBeGreaterThan(0)
    expect(read.refused.length).toBeGreaterThan(0)
  })

  it("warns of a refused file and of each note in the format's words, after the JSON path", () => {
    const dir = boardsDir({
      "broken.board.json": "{",
      "noted.board.json": JSON.stringify({ ...JSON.parse(board(["shop"])), theme: "dark" }),
      "missing.board.json": JSON.stringify({ title: "Orders" }),
    })
    const read = loadEngineBoards({ ENGINE_BOARDS_DIR: dir }, ["shop"])!
    const notJson = BoardProblems.describe({ path: "(file)", code: "notJson" })
    const ignored = BoardProblems.describe({ path: "theme", code: "ignoredKey" })
    expect(read.warnings).toEqual([
      `The board file broken.board.json (ENGINE_BOARDS_DIR) gives no board: (file) ${notJson}. The other boards show.`,
      "The board file missing.board.json (ENGINE_BOARDS_DIR) gives no board: engines is missing; rows is missing. The other boards show.",
      `The board file noted.board.json (ENGINE_BOARDS_DIR): theme ${ignored}.`,
    ])
    expect(read.boards.map(({ id }) => id)).toEqual(["noted"])
    expect(read.refused.map(({ id }) => id)).toEqual(["broken", "missing"])
  })

  it("says the other boards show only when another file gives one", () => {
    const dir = boardsDir({ "broken.board.json": "{", "missing.board.json": "{}" })
    const read = loadEngineBoards({ ENGINE_BOARDS_DIR: dir }, ["shop"])!
    expect(read.boards).toEqual([])
    expect(read.warnings).toEqual([
      `The board file broken.board.json (ENGINE_BOARDS_DIR) gives no board: (file) ${BoardProblems.describe({ path: "(file)", code: "notJson" })}.`,
      "The board file missing.board.json (ENGINE_BOARDS_DIR) gives no board: title is missing; engines is missing; rows is missing.",
    ])
  })

  it("words a problem with its values as the format does", () => {
    const problem = {
      path: "rows[0].row[0].props.engines",
      code: "engineOutsideBoard",
      values: { engines: ["prod-eu", "prod-us"] },
    } as const
    expect(boardProblemSentence(problem)).toBe(
      "rows[0].row[0].props.engines may only name engines of the board; prod-eu, prod-us are not in its engines",
    )
  })

  it("warns of the engines a board names that no profile of the server names", () => {
    const dir = boardsDir({
      "one.board.json": board(["shop", "lost"]),
      "two.board.json": board(["gone", "shop", "away"]),
      "own.board.json": board(["shop", "refused-one"]),
    })
    const read = loadEngineBoards({ ENGINE_BOARDS_DIR: dir }, ["shop", "refused-one"])!
    expect(read.warnings).toEqual([
      "The board file one.board.json (ENGINE_BOARDS_DIR) names an engine no profile of this server names: lost. The board shows it as not configured.",
      "The board file two.board.json (ENGINE_BOARDS_DIR) names engines no profile of this server names: gone, away. The board shows them as not configured.",
    ])
  })

  it("reads the board files in the order of their names, and nothing else of the directory", () => {
    const dir = boardsDir({
      "b.board.json": board(["shop"], "B"),
      "a.board.json": board(["shop"], "A"),
      "notes.json": "{",
      "c.board.json.bak": "{",
      "README.md": "# Boards",
    })
    fs.mkdirSync(path.join(dir, "nested"))
    fs.writeFileSync(path.join(dir, "nested", "d.board.json"), board(["shop"], "D"))
    const read = loadEngineBoards({ ENGINE_BOARDS_DIR: dir }, ["shop"])!
    expect(read.boards.map(({ id, file, board }) => [id, file, board.title])).toEqual([
      ["a", "a.board.json", "A"],
      ["b", "b.board.json", "B"],
    ])
    expect(read.warnings).toEqual([])
  })

  it("skips a folder named like a board file and says so, and reads a link to a board file", () => {
    const dir = boardsDir({ "orders.json": board(["shop"], "Linked") })
    fs.mkdirSync(path.join(dir, "folder.board.json"))
    fs.writeFileSync(path.join(dir, "folder.board.json", "inner.board.json"), board(["shop"]))
    fs.symlinkSync(path.join(dir, "orders.json"), path.join(dir, "orders.board.json"))
    const read = loadEngineBoards({ ENGINE_BOARDS_DIR: dir }, ["shop"])!
    expect(read.boards.map(({ id, board }) => [id, board.title])).toEqual([["orders", "Linked"]])
    expect(read.refused).toEqual([])
    expect(read.warnings).toEqual([
      "The entry folder.board.json (ENGINE_BOARDS_DIR) is not read: it is no file, and a subfolder is not read. Put each board file in the directory itself.",
    ])
  })

  it("skips a file whose name the id rule refuses, and says how to name it", () => {
    const dir = boardsDir({
      "Order ops.board.json": board(["shop"]),
      ".hidden.board.json": board(["shop"]),
      "order-ops_2.1.board.json": board(["shop"]),
    })
    const read = loadEngineBoards({ ENGINE_BOARDS_DIR: dir }, ["shop"])!
    expect(read.boards.map(({ id }) => id)).toEqual(["order-ops_2.1"])
    expect(read.warnings).toEqual([
      'The board file .hidden.board.json (ENGINE_BOARDS_DIR) is not read: a board\'s id is its file name without .board.json, a letter or digit first, then letters, digits, ".", "_" and "-", 64 at most. Rename the file to show its board.',
      expect.stringMatching(
        /^The board file Order ops\.board\.json \(ENGINE_BOARDS_DIR\) is not read: /,
      ),
    ])
  })

  it("takes an id of 64 characters at most, a letter or digit first", () => {
    expect(BOARD_ID.test("a".repeat(64))).toBe(true)
    expect(BOARD_ID.test("a".repeat(65))).toBe(false)
    for (const id of ["9-lives", "A.b_c-d"]) expect(BOARD_ID.test(id), id).toBe(true)
    for (const id of ["", "-a", ".a", "_a", "a b", "a/b", "ä"])
      expect(BOARD_ID.test(id), id).toBe(false)
  })

  it("says when the directory holds no board file", () => {
    const dir = boardsDir({ "README.md": "# Boards" })
    expect(loadEngineBoards({ ENGINE_BOARDS_DIR: dir }, [])).toEqual({
      boards: [],
      refused: [],
      warnings: [
        `ENGINE_BOARDS_DIR=${dir} holds no board file (*.board.json): the server shows no board.`,
      ],
    })
  })

  it("names a relative directory with the path it resolved to", () => {
    const dir = boardsDir({})
    const relative = path.relative(process.cwd(), dir)
    expect(loadEngineBoards({ ENGINE_BOARDS_DIR: relative }, [])?.warnings).toEqual([
      `ENGINE_BOARDS_DIR=${relative} (resolved ${dir}) holds no board file (*.board.json): the server shows no board.`,
    ])
  })
})

describe("loadEngineBoards fails the boot when it cannot read what the variable names", () => {
  it("a directory that does not exist", () => {
    const dir = path.join(boardsDir({}), "missing")
    expect(thrownBy({ ENGINE_BOARDS_DIR: dir }).message).toBe(
      `ENGINE_BOARDS_DIR=${dir} does not exist: it names the directory of the board files.`,
    )
  })

  it("a file instead of a directory", () => {
    const file = path.join(boardsDir({ "a.board.json": board(["shop"]) }), "a.board.json")
    expect(thrownBy({ ENGINE_BOARDS_DIR: file }).message).toBe(
      `ENGINE_BOARDS_DIR=${file} is no directory: it names the directory of the board files.`,
    )
  })

  it("a board file that cannot be read, naming it", () => {
    const dir = boardsDir({})
    fs.symlinkSync(path.join(dir, "gone.json"), path.join(dir, "lost.board.json"))
    const error = thrownBy({ ENGINE_BOARDS_DIR: dir })
    expect(error.message).toBe(
      `ENGINE_BOARDS_DIR=${dir}: the board file lost.board.json cannot be read (ENOENT).`,
    )
    expect(error.cause).toBeInstanceOf(Error)
  })
})
