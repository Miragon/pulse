import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createFocusReturn, useFocusReturn, type AutoFocusEventLike } from "./focus-return.js"

/**
 * Focus return of the kit's dialogs (CI §12 and §8 "Fokus im
 * Dialog halten und danach zurückgeben"): the hand-back itself, and the
 * gates that keep every overlay on it.
 */

declare global {
  interface ImportMeta {
    glob(
      pattern: string | string[],
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>
  }
}

const element = (isConnected = true) => ({ isConnected, focus: vi.fn<() => void>() })
const BODY = { body: true }

function closeEvent(defaultPrevented = false): AutoFocusEventLike & {
  preventDefault: ReturnType<typeof vi.fn<() => void>>
} {
  return { defaultPrevented, preventDefault: vi.fn<() => void>() }
}

describe("createFocusReturn", () => {
  it("hands the focus back to the element that had it as the overlay opened", () => {
    const fr = createFocusReturn()
    const opener = element()
    fr.capture(opener, BODY)
    const event = closeEvent()
    fr.restore(event, true)
    expect(opener.focus).toHaveBeenCalledOnce()
    // Radix's own close handler (it focuses only a Trigger) must not run after it.
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it("leaves Radix's default alone when the body had the focus (nothing to return to)", () => {
    const fr = createFocusReturn()
    fr.capture(null, BODY)
    const nothing = closeEvent()
    fr.restore(nothing, true)
    expect(nothing.preventDefault).not.toHaveBeenCalled()

    const body = { ...element(), ...BODY }
    fr.capture(body, body)
    const event = closeEvent()
    fr.restore(event, true)
    expect(body.focus).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it("does not focus an opener that left the document (an action unmounted it)", () => {
    const fr = createFocusReturn()
    const opener = element(false)
    fr.capture(opener, BODY)
    const event = closeEvent()
    fr.restore(event, true)
    expect(opener.focus).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it("leaves the focus where it went when it did not get lost with the overlay", () => {
    // A click outside a non-modal overlay, or a hand-off (Apply) that already moved it.
    const fr = createFocusReturn()
    const opener = element()
    fr.capture(opener, BODY)
    const event = closeEvent()
    fr.restore(event, false)
    expect(opener.focus).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it("yields to a consumer's close handler that prevented the default", () => {
    const fr = createFocusReturn()
    const opener = element()
    fr.capture(opener, BODY)
    fr.restore(closeEvent(true), true)
    expect(opener.focus).not.toHaveBeenCalled()
  })

  it("returns the focus once per opening, to the latest opener", () => {
    const fr = createFocusReturn()
    const first = element()
    const second = element()
    fr.capture(first, BODY)
    fr.capture(second, BODY)
    fr.restore(closeEvent(), true)
    fr.restore(closeEvent(), true)
    expect(first.focus).not.toHaveBeenCalled()
    expect(second.focus).toHaveBeenCalledOnce()
  })
})

// -------------------------------------------------------------------------- //
// useFocusReturn: the order around the consumer's own handlers
// -------------------------------------------------------------------------- //

/** A Radix-like auto-focus event: `preventDefault()` sets `defaultPrevented`. */
function autoFocusEvent(): AutoFocusEventLike {
  const event = {
    defaultPrevented: false,
    preventDefault: () => {
      event.defaultPrevented = true
    },
  }
  return event
}

type Handlers = ReturnType<typeof useFocusReturn<AutoFocusEventLike>>

/** The handler pair the hook hands a Radix content, from one SSR render. */
function handlersOf(consumer: Partial<Handlers>): Handlers {
  let handlers: Handlers | undefined
  function Probe() {
    handlers = useFocusReturn(consumer)
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  if (!handlers) throw new Error("the probe did not render")
  return handlers
}

describe("useFocusReturn", () => {
  const body = { tag: "body" }
  const doc = { activeElement: null as unknown, body }
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("notes the opener BEFORE the consumer's open handler can move the focus", () => {
    vi.stubGlobal("document", doc)
    const opener = element()
    const elsewhere = element()
    const handlers = handlersOf({
      onOpenAutoFocus: () => {
        doc.activeElement = elsewhere
      },
    })
    doc.activeElement = opener
    handlers.onOpenAutoFocus(autoFocusEvent())
    doc.activeElement = body // the overlay closed with the focus inside it
    const close = autoFocusEvent()
    handlers.onCloseAutoFocus(close)
    expect(opener.focus).toHaveBeenCalledOnce()
    expect(elsewhere.focus).not.toHaveBeenCalled()
    expect(close.defaultPrevented).toBe(true)
  })

  it("runs the consumer's close handler first: its preventDefault keeps the focus with it", () => {
    vi.stubGlobal("document", doc)
    const opener = element()
    const onCloseAutoFocus = vi.fn((event: AutoFocusEventLike) => event.preventDefault())
    const handlers = handlersOf({ onCloseAutoFocus })
    doc.activeElement = opener
    handlers.onOpenAutoFocus(autoFocusEvent())
    doc.activeElement = body
    handlers.onCloseAutoFocus(autoFocusEvent())
    expect(onCloseAutoFocus).toHaveBeenCalledOnce()
    expect(opener.focus).not.toHaveBeenCalled()
  })

  it("hands back on a lost focus only: the body, or none at all", () => {
    vi.stubGlobal("document", doc)
    const opener = element()
    const handlers = handlersOf({})
    for (const atClose of [body, null]) {
      doc.activeElement = opener
      handlers.onOpenAutoFocus(autoFocusEvent())
      doc.activeElement = atClose
      handlers.onCloseAutoFocus(autoFocusEvent())
    }
    expect(opener.focus).toHaveBeenCalledTimes(2)

    // The focus already sits on another element: it stays there.
    const moved = element()
    doc.activeElement = opener
    handlers.onOpenAutoFocus(autoFocusEvent())
    doc.activeElement = moved
    const close = autoFocusEvent()
    handlers.onCloseAutoFocus(close)
    expect(opener.focus).toHaveBeenCalledTimes(2)
    expect(close.defaultPrevented).toBe(false)
  })

  it("notes no opener that cannot take the focus", () => {
    vi.stubGlobal("document", doc)
    const handlers = handlersOf({})
    doc.activeElement = { isConnected: true } // no focus()
    handlers.onOpenAutoFocus(autoFocusEvent())
    doc.activeElement = body
    const close = autoFocusEvent()
    expect(() => handlers.onCloseAutoFocus(close)).not.toThrow()
    expect(close.defaultPrevented).toBe(false)
  })
})

// -------------------------------------------------------------------------- //
// Gates: every overlay of the kit goes through the hand-back
// -------------------------------------------------------------------------- //

const SOURCES = import.meta.glob(["../**/*.tsx", "!../**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
})

/** Names of the JSX attributes on every `<tag …>` in a source (spreads as `...expr`). */
function attributesOf(file: string, source: string, tag: string): string[][] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: string[][] = []
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(sf) === tag
    ) {
      found.push(
        node.attributes.properties.map((p) =>
          ts.isJsxAttribute(p) ? p.name.getText(sf) : `...${p.expression.getText(sf)}`,
        ),
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

/** Whether a source puts `autoFocus` on any JSX element. */
function hasAutoFocus(file: string, source: string): boolean {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found = false
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(sf) === "autoFocus") found = true
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

describe("overlay focus gates", () => {
  it("scans the kit's components", () => {
    expect(Object.keys(SOURCES)).toContain("../primitives/dialog.tsx")
    expect(Object.keys(SOURCES)).toContain("../kit/settings.tsx")
  })

  it("imports Radix's Dialog only in the primitive that adds the hand-back", () => {
    const importers = Object.entries(SOURCES)
      .filter(([, src]) =>
        /import\s*\{[^}]*\b(?:Alert)?Dialog\b[^}]*\}\s*from\s*"radix-ui"/.test(src),
      )
      .map(([file]) => file)
      .sort()
    expect(importers).toEqual(["../primitives/dialog.tsx"])
  })

  it("spreads the hand-back into the Radix content AFTER the consumer's props", () => {
    for (const [file, primitive] of [
      ["../primitives/dialog.tsx", "DialogPrimitive.Content"],
    ] as const) {
      const contents = attributesOf(file, SOURCES[file] ?? "", primitive)
      expect(contents, file).toHaveLength(1)
      const attrs = contents[0] ?? []
      expect(attrs.indexOf("...focusReturn"), file).toBeGreaterThan(attrs.indexOf("...props"))
      expect(SOURCES[file], file).toMatch(
        /useFocusReturn\(\{ onOpenAutoFocus, onCloseAutoFocus \}\)/,
      )
    }
  })

  it("lets no overlay content take the focus itself (Radix would skip noting the opener)", () => {
    const overlays = Object.entries(SOURCES).filter(([, src]) => /<DialogContent\b/.test(src))
    // The kit's own overlay renders sit in its render cases; its consumers' dialogs
    // (widget-shell's ConfirmDialog) are pinned in their own packages.
    expect(overlays.map(([file]) => file)).toEqual(["../render-cases-primitives.tsx"])
    expect(overlays.filter(([file, src]) => hasAutoFocus(file, src)).map(([file]) => file)).toEqual(
      [],
    )
    expect(hasAutoFocus("self.tsx", "const A = () => <input autoFocus />")).toBe(true)
    expect(hasAutoFocus("self.tsx", "const autoFocus = 1")).toBe(false)
  })
})
