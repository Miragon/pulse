import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { REPO_ROOT } from "./source-scan.mjs"

/**
 * The BPMN name reader (`readBpmnNames`, `parseBpmnNames`, `bpmnProcessNameOf`) has two copies:
 * pulse-ui's, which its `./bpmn` entry exports for the diagram and every page, and widget-shell's
 * protocol, which its `/server` exports (its server half imports no pulse-ui, and the protocol
 * imports nothing). Both packages are leaves that share it through no third package, so each keeps
 * its file, and this guard holds the two to the same bytes: one reader, whichever copy a surface
 * reads (CLAUDE.md invariant 6, "named by ONE reader").
 */

const COPIES = [
  "packages/core/ui/src/bpmn/bpmn-names.ts",
  "packages/core/widget-shell/src/protocol/bpmn-names.ts",
]

describe("the BPMN name reader's two copies", () => {
  it("are the same text", () => {
    const [ui, shell] = COPIES.map((file) => readFileSync(join(REPO_ROOT, file), "utf8"))
    assert.ok(ui.includes("export function readBpmnNames("), "pulse-ui's copy holds the reader")
    assert.equal(shell, ui, `${COPIES[1]} differs from ${COPIES[0]}`)
  })
})
