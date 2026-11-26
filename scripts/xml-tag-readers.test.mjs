// @ts-check
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { REPO_ROOT } from "./source-scan.mjs"

/**
 * The XML tag reader, one linear pass over a diagram's tags (comments, CDATA sections and
 * processing instructions skipped to their own ends, a quoted `>` part of its tag, nothing read
 * after markup that never ends or of a text over 4 Mi characters, which `readable` says), has two
 * copies: the board
 * builder's (@miragon/pulse-board/builder), under the roll-up of collapsed sub-processes, and
 * c8-core's (@miragon/pulse-c8-core), under its BPMN text. Both packages are leaves that may share
 * it through no third package, so each keeps its own, and a fix of one has to reach the other in
 * the same change. This guard holds every declaration and method of the board's copy to the same
 * text in c8-core's, and c8-core's copy to the board's plus the element reader only it has.
 */

const COPIES = {
  board: "packages/core/board/src/builder/xml-tags.ts",
  c8Core: "packages/connectors/c8/c8-core/src/mapping/xml-tags.ts",
}

/** What only c8-core's copy holds: the elements of some names, each with the tags inside it. */
const C8_CORE_ONLY = ["XmlElement", "OpenElement", "elements", "opened", "continued"]

/** The start of a unit: a declaration at the top of the file, or a method of the class. */
const UNIT =
  /^(?:export )?(?:interface|const|class|type|function) (\w+)|^ {2}(?:private )?static (\w+)\(/

/**
 * The units of a copy by name, each its lines up to the next unit's start, without the blank lines
 * and the class's closing brace after it.
 * @param {string} text
 * @returns {Map<string, string>}
 */
function unitsOf(text) {
  const units = new Map()
  let name
  for (const line of text.split("\n")) {
    const start = UNIT.exec(line)
    if (start !== null) {
      name = start[1] ?? start[2]
      units.set(name, [])
    }
    if (name !== undefined) units.get(name).push(line)
  }
  return new Map(
    [...units].map(([unit, lines]) => {
      while (lines.length > 0 && ["", "}"].includes(lines.at(-1))) lines.pop()
      return [unit, lines.join("\n")]
    }),
  )
}

/**
 * Where c8-core's copy is not the board's plus `only`, one line per unit.
 * @param {string} board
 * @param {string} c8Core
 * @param {readonly string[]} only
 */
function differences(board, c8Core, only = C8_CORE_ONLY) {
  const shared = unitsOf(board)
  const own = unitsOf(c8Core)
  const found = []
  for (const [name, text] of shared) {
    if (!own.has(name)) found.push(`${name}: only in the board's copy`)
    else if (own.get(name) !== text) found.push(`${name}: differs between the copies`)
  }
  for (const name of own.keys()) {
    if (!shared.has(name) && !only.includes(name)) found.push(`${name}: only in c8-core's copy`)
  }
  for (const name of only) {
    if (!own.has(name)) found.push(`${name}: named as c8-core's own, but not in its copy`)
  }
  return found
}

const read = (file) => readFileSync(join(REPO_ROOT, file), "utf8")

describe("the two copies of the XML tag reader", () => {
  const board = read(COPIES.board)
  const c8Core = read(COPIES.c8Core)

  it("reads the board's copy as its declarations and methods", () => {
    assert.deepEqual(
      [...unitsOf(board).keys()],
      [
        "XmlTag",
        "SKIPPED_MARKUP",
        "NAME_END",
        "LONGEST_TEXT",
        "XmlTags",
        "readable",
        "of",
        "skippedTo",
        "tagEnd",
        "tagOf",
      ],
    )
  })

  it("holds c8-core's copy to the board's plus its element reader", () => {
    assert.deepEqual(differences(board, c8Core), [])
  })

  it("fails on a shared method changed in one copy", () => {
    const changed = c8Core.replace("return stop.index + 1", "return stop.index")
    assert.notEqual(changed, c8Core)
    assert.deepEqual(differences(board, changed), ["tagEnd: differs between the copies"])
  })

  it("fails on a declaration changed in the board's copy", () => {
    const changed = board.replace("4 * 1024 * 1024", "8 * 1024 * 1024")
    assert.notEqual(changed, board)
    assert.deepEqual(differences(changed, c8Core), ["LONGEST_TEXT: differs between the copies"])
  })

  it("fails on a method only one copy has, and on an own part c8-core's copy lost", () => {
    const method = "\n  private static extra(): void {\n    return\n  }\n}\n"
    const added = (text) => text.replace(/\n}\n$/, method)
    assert.deepEqual(differences(added(board), c8Core), ["extra: only in the board's copy"])
    assert.deepEqual(differences(board, added(c8Core)), ["extra: only in c8-core's copy"])
    assert.deepEqual(differences(board, c8Core, [...C8_CORE_ONLY, "lost"]), [
      "lost: named as c8-core's own, but not in its copy",
    ])
  })
})
