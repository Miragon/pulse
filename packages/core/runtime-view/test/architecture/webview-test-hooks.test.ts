import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { PACKAGE_ROOT } from "./support/files.js"
import { WebviewHooks } from "./support/webview-hooks.js"

const WEBVIEW = join(PACKAGE_ROOT, "src", "webview")
const WEBVIEW_TESTS = join(PACKAGE_ROOT, "test", "webview")

const webviewClasses = WebviewHooks.classNames(
  WebviewHooks.sourcesUnder(WEBVIEW, [".css"]).values(),
  WebviewHooks.sourcesUnder(WEBVIEW, [".tsx"]).values(),
)

describe("the webview tests reach the webview through roles, labels and data-part hooks", () => {
  test("the class names of the webview are known, so the gate below has something to hold", () => {
    expect(webviewClasses).toContain("data-table__row")
    expect(webviewClasses).toContain("status-strip--danger")
    expect(webviewClasses).toContain("incident-card")
    expect(webviewClasses).not.toContain("djs-element")
    expect(webviewClasses).not.toContain("css")
  })

  test("no webview test names a class of the webview, in a selector or as a class to expect", () => {
    const findings = [...WebviewHooks.sourcesUnder(WEBVIEW_TESTS, [".ts", ".tsx"])].flatMap(
      ([file, source]) => WebviewHooks.findings(file, source, webviewClasses),
    )

    expect(findings).toEqual([])
  })

  test("flags a planted class query and leaves roles, hooks, the diagram's classes and markers alone", () => {
    const planted = [
      'root.querySelector(".data-table__row")',
      "waitForElement(root, `.board-card--counter tbody tr`)",
      'expect(entry.classList).toContain("move-entry--refused")',
      "root.querySelector('[data-part=\"incident-card\"]')",
      'root.querySelector(`g.djs-element[data-element-id="${id}"] .djs-hit`)',
      'expect(shape.classList).toContain("pulse-move-from")',
      'expect(text).toContain("billing-prod is not in .pulse.json.")',
      'frame.locator("select.version-picker__select")',
      'openFile(window, "shop-operations.board.json")',
    ].join("\n")
    const classes = new Set([
      "data-table__row",
      "board-card--counter",
      "move-entry--refused",
      "version-picker__select",
      "board",
    ])

    expect(WebviewHooks.findings("planted.test.tsx", planted, classes)).toEqual([
      { file: "planted.test.tsx", line: 1, className: "data-table__row" },
      { file: "planted.test.tsx", line: 2, className: "board-card--counter" },
      { file: "planted.test.tsx", line: 3, className: "move-entry--refused" },
      { file: "planted.test.tsx", line: 8, className: "version-picker__select" },
    ])
  })
})
