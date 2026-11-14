import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { PACKAGE_ROOT, REPO_ROOT } from "./support/files.js"
import { WebviewHooks } from "./support/webview-hooks.js"

const WEBVIEW = join(PACKAGE_ROOT, "src", "webview")
const WEBVIEW_TESTS = join(PACKAGE_ROOT, "test", "webview")
const VSCODE_SCRIPTS = join(REPO_ROOT, "apps", "vscode", "scripts")
const SCRIPT_PARTS = join(VSCODE_SCRIPTS, "support", "webview-parts.mjs")
const HARNESS = join(WEBVIEW_TESTS, "harness.tsx")

const webviewClasses = WebviewHooks.classNames(
  WebviewHooks.sourcesUnder(WEBVIEW, [".css"]).values(),
  WebviewHooks.sourcesUnder(WEBVIEW, [".tsx"]).values(),
)

describe("the webview tests reach the webview through roles, labels and data-part hooks", () => {
  test("the class names of the webview are known, so the gate below has something to hold", () => {
    expect(webviewClasses).toContain("count-badge")
    expect(webviewClasses).toContain("move-entry")
    expect(webviewClasses).toContain("code-button")
    expect(webviewClasses).not.toContain("djs-element")
    expect(webviewClasses).not.toContain("css")
  })

  test("no webview test names a class of the webview, in a selector or as a class to expect", () => {
    const findings = [...WebviewHooks.sourcesUnder(WEBVIEW_TESTS, [".ts", ".tsx"])].flatMap(
      ([file, source]) => WebviewHooks.findings(file, source, webviewClasses),
    )

    expect(findings).toEqual([])
  })

  test("no script that drives the webview in VS Code names a class of the webview either", () => {
    const findings = [...WebviewHooks.sourcesUnder(VSCODE_SCRIPTS, [".mjs"])].flatMap(
      ([file, source]) => WebviewHooks.findings(file, source, webviewClasses),
    )

    expect(findings).toEqual([])
  })

  test("the scripts resolve a part a kit piece plays through the harness's map of kit slots", () => {
    expect(WebviewHooks.kitSlots(readFileSync(SCRIPT_PARTS, "utf8"))).toEqual(
      WebviewHooks.kitSlots(readFileSync(HARNESS, "utf8")),
    )
    expect(Object.keys(WebviewHooks.kitSlots(readFileSync(HARNESS, "utf8")))).toContain(
      "context-bar",
    )
  })

  test("reads the class strings of cn calls as the webview's classes", () => {
    const classes = WebviewHooks.classNames(
      [],
      ['<p className={cn("probe-row h-row", wide && "probe-wide", Probe.of(x))} />'],
    )

    expect([...classes].sort()).toEqual(["h-row", "probe-row", "probe-wide"])
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
