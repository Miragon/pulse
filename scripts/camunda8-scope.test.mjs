// @ts-check
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  envExampleTexts,
  goldenScope,
  goldenTexts,
  markdownTexts,
  scopeFindings,
  sourceTexts,
  trackedTexts,
} from "./camunda8-scope.mjs"

/**
 * The hand-written sentences that state the Camunda 8 scope say what a server of Camunda 8 engines
 * alone lists (#694, F76): one that says a cluster is read on boards only fails unless it speaks of
 * the chat's cockpit, whose views of a cluster are the board and the landing, and one that says the
 * chat reads it as JSON fails once no tool the model sees does. The scope is the tools/list
 * goldens', which the boot writes from every mark (golden:update), so a mark that widens fails
 * the goldens first and then every sentence here it makes untrue.
 */

const SCOPE = goldenScope()

/** A cockpit that shows a cluster in an engine's overview too. */
const WIDER = { ...SCOPE, views: [...SCOPE.views, "overview"] }

/** A server whose model reads a cluster through no tool besides the cockpit. */
const NARROWER = { ...SCOPE, tools: ["engine_list_engines", "engine_open_cockpit"] }

/** @param {string} text @param {boolean} [ui] */
const texts = (text, ui = false) => [{ at: "x", text, ...(ui ? { ui } : {}) }]

describe("the Camunda 8 scope of the hand-written texts", () => {
  it("reads the scope from the goldens: the cockpit's board and landing, the JSON tools", () => {
    assert.deepEqual([...SCOPE.views].sort(), ["board", "landing"])
    assert.ok(SCOPE.tools.includes("engine_get_screen") && SCOPE.tools.includes("engine_get_board"))
  })

  it("finds no sentence of the docs, the env examples, the module or the goldens that the marks no longer bear out", () => {
    const all = [...trackedTexts(), ...goldenTexts()]
    assert.ok(all.length > 10000, `${all.length} texts`)
    // The scanner is not blind: the sentences a wider cockpit and a narrower chat make untrue.
    assert.ok(scopeFindings(all, WIDER).length >= 8, "the cockpit's boards-only sentences")
    assert.ok(scopeFindings(all, NARROWER).length >= 8, "the chat's JSON sentences")
    assert.deepEqual(scopeFindings(all, SCOPE), [])
  })

  it("fails on a sentence that reads a cluster on boards only beyond the chat's cockpit", () => {
    const docs = markdownTexts("d.md", "The server reads a Camunda 8\ncluster on boards only.\n")
    assert.deepEqual(scopeFindings(docs, SCOPE), [
      'd.md:1: "The server reads a Camunda 8 cluster on boards only." (engine_get_board and ' +
        "engine_get_screen read it too: name the chat's cockpit, or say so)",
    ])
    const cell = markdownTexts("t.md", "| Camunda 8 | A cluster's REST API, read for boards. |\n")
    assert.equal(scopeFindings(cell, SCOPE).length, 1)
    const env = envExampleTexts(
      ".env.example",
      "# A Camunda 8 cluster is a profile,\n# read on boards only.\nX=1\n",
    )
    assert.equal(scopeFindings(env, SCOPE).length, 1)
    // The cockpit's model context said so of the server, though it named the cockpit too.
    const context = texts(
      "The operator opened an engine in the engine cockpit that the server reads on boards only " +
        "(it speaks another engine API than the cockpit's views read).",
    )
    assert.equal(scopeFindings(context, SCOPE).length, 1)
  })

  // The reviewer's plants: a sentence appended to engine_open_cockpit's description and to the
  // instructions' board rule, each a `+` chain of literals.
  it("reads a TypeScript text whole, over its `+` chain", () => {
    const source = [
      'const ROUTES = "Opens the cockpit. " + "A Camunda 8 engine shows on boards only."',
      'const BOARD_RULE = `- Boards: ${list} lists them. ` + "A Camunda 8 engine shows on " +',
      '  "boards only, no other tool reads it."',
    ].join("\n")
    assert.deepEqual(
      scopeFindings(sourceTexts("s.ts", source), SCOPE).map((finding) => finding.split(":")[1]),
      ["1", "2"],
    )
  })

  it("holds a sentence of the chat's cockpit, and a view's own word, to the cockpit's views", () => {
    const cockpit = texts("The chat's cockpit shows a Camunda 8 engine on boards only.")
    const word = sourceTexts(
      "de.ts",
      '"Pulse zeigt sie hier nur auf Boards, und kein Board nennt sie."',
      true,
    )
    for (const held of [cockpit, word]) {
      assert.deepEqual(scopeFindings(held, SCOPE), [])
      assert.match(
        scopeFindings(held, WIDER)[0] ?? "",
        /the cockpit shows it in board, landing, overview/,
      )
    }
  })

  it("holds a sentence that the chat reads a cluster as JSON to the tools the model sees", () => {
    const paragraph = texts("A Camunda 8 cluster shows on boards. The model reads it as JSON too.")
    assert.deepEqual(scopeFindings(paragraph, SCOPE), [])
    assert.deepEqual(scopeFindings(paragraph, NARROWER), [
      'x: "The model reads it as JSON too." (no tool the model sees reads it as JSON)',
    ])
  })

  it("leaves a sentence of another dialect, and the only of read-only, alone", () => {
    for (const text of [
      "a dialect the page knows no screen of says it shows on boards only",
      "A Camunda 8 cluster is a profile too, read-only on boards and screens.",
      "The cockpit's facts arrive as JSON.",
    ]) {
      assert.deepEqual(scopeFindings(texts(text), NARROWER), [])
    }
  })
})
