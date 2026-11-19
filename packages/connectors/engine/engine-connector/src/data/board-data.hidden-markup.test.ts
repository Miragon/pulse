/**
 * A board whose process diagram hides unended markup where XML allows it, over the server's wire
 * of each dialect: the recorded board engine of c7-core and of c8-core (recorded-board.test-support.ts),
 * its diagram's XML answered with a comment of tag openers and an unpaired quote, a processing
 * instruction of comment openers and a sub-process whose name runs to 100,000 characters behind it.
 * Whoever may deploy a version of a process a board shows can serve such a diagram; the board
 * builder's collapsed shapes (@miragon/pulse-board/builder) and c8-core's BPMN text reader (the
 * containers of an element with an incident) read it in one pass over the tags and their
 * attributes, so the feed gives the recording's board at once instead of holding the event loop,
 * and with it every other call of the server, for seconds.
 */

import { afterEach, describe, expect, it } from "vitest"
import type { RecordedAnswer } from "@miragon/pulse-http/testing/loopback"
import {
  bootRecordedBoard,
  closeRecordedBoards,
  RECORDED_C7,
  RECORDED_C8,
} from "./recorded-board.test-support.js"

afterEach(closeRecordedBoards)

const HIDDEN = [
  `<!--${" <a".repeat(60_000)} " -->`,
  `<?pulse ${"<!--".repeat(100_000)} ?>`,
  `<${"p".repeat(100_000)}:subProcess id="Hidden" />`,
]
  .map((markup) => `\n${markup}`)
  .join("")

/**
 * The read takes 0.13 s alone over the C7 board (0.05 s over the C8 one), about 4 s at the CI
 * runner's 30 times while `pnpm test` runs every package's suite at once. The readers it guards
 * against, as they were before the one linear pass, take 67 s on this markup (the board builder's
 * tag pattern) and 41 s (c8-core's comment strip and container pattern), so 15 s still tells the
 * two apart, and the case's limit leaves the boot and the read under load room above it.
 */
const LINEAR_BOUND_MS = 15_000
const HIDDEN_MARKUP_LIMIT = { timeout: 30_000 }

/** Each diagram's XML with the hidden markup behind it: Camunda 7's in its JSON, Camunda 8's as text. */
function hiding(answers: readonly RecordedAnswer[]): RecordedAnswer[] {
  return answers.map((recorded) => {
    if ("text" in recorded) return { ...recorded, text: `${recorded.text}${HIDDEN}` }
    const answer = recorded.answer as { bpmn20Xml?: unknown }
    return typeof answer.bpmn20Xml === "string"
      ? { ...recorded, answer: { ...answer, bpmn20Xml: `${answer.bpmn20Xml}${HIDDEN}` } }
      : recorded
  })
}

describe.each([
  ["c7-core's recorded board engine, over the SDK wire", RECORDED_C7],
  ["c8-core's recorded board engine, over the server's Camunda 8 wire", RECORDED_C8],
])("the board feed over %s", HIDDEN_MARKUP_LIMIT, (_name, recorded) => {
  it("reads a diagram that hides unended markup at once and gives the recording's board", async () => {
    const answers = hiding(recorded.board.answers)
    expect(
      answers.filter((answer, index) => answer !== recorded.board.answers[index]),
    ).toHaveLength(1)
    const { engine, read } = await bootRecordedBoard(recorded, answers)
    const started = Date.now()
    const { asOf, ...board } = await read()
    expect(Date.now() - started).toBeLessThan(LINEAR_BOUND_MS)
    expect(engine.unanswered).toEqual([])
    expect(Date.parse(asOf)).not.toBeNaN()
    expect(board).toEqual(recorded.board.expected)
  })
})
