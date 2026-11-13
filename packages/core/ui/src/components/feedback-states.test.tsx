import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { CircleCheck } from "lucide-react"
import { describe, expect, it } from "vitest"
import { LocaleProvider } from "../locale/locale-provider.js"
import { UI_MESSAGES } from "../locale/ui-messages.js"
import { FOCUS_RING } from "../lib/focus-ring.js"
import { createToast } from "../lib/toast-model.js"
import { TONE_BORDER, TONE_ICON, TONE_SOFT } from "../lib/tone-utils.js"
import { attribute, openingTags } from "../render-scan.js"
import { EmptyState, type EmptyStateProps } from "./EmptyState.js"
import { ErrorState, type ErrorStateTone } from "./ErrorState.js"
import { ToastProvider, ToastViewport, useToast, type ToastApi } from "./Toast.js"

/**
 * Accessibility contract of the feedback primitives, pinned on their SSR
 * markup (the house render path, no jsdom): roles, live regions, accessible
 * names in the active locale, native focusable controls, nothing that steals
 * focus.
 */

const de = UI_MESSAGES.de
const inGerman = (node: ReactNode) =>
  renderToStaticMarkup(<LocaleProvider locale="de-DE">{node}</LocaleProvider>)
const noop = (): void => {}

/** No positive tabindex and no autofocus anywhere: feedback never steals focus. */
function expectNoFocusTheft(html: string) {
  expect(html).not.toMatch(/autofocus/i)
  for (const value of html.match(/tabindex="(-?\d+)"/gi) ?? []) {
    expect(Number(/"(-?\d+)"/.exec(value)?.[1])).toBeLessThanOrEqual(0)
  }
}

describe("Toast", () => {
  const toasts = [
    createToast(1, { tone: "success", title: "Job retried." }),
    createToast(2, { tone: "danger", title: "Retry failed.", description: "Engine down (503)" }),
  ]

  /** The stack's region, found by its slot (it has no role to query by). */
  const regionOf = (html: string) =>
    openingTags(html, "div").find((t) => attribute(t, "data-slot") === "toast-viewport") ?? ""

  it("renders ONE persistent live region: aria-live=polite, each toast on its own", () => {
    const html = inGerman(<ToastViewport toasts={toasts} onDismiss={noop} />)
    const [region, ...others] = openingTags(html, "div").filter((t) => /aria-live=/.test(t))
    expect(others).toHaveLength(0)
    expect(attribute(region ?? "", "data-slot")).toBe("toast-viewport")
    expect(attribute(region ?? "", "aria-live")).toBe("polite")
    // Each new toast is announced on its own, not the whole stack again.
    expect(attribute(region ?? "", "aria-atomic")).toBe("false")
    expect(html).not.toContain('role="status"')
  })

  it("keeps the region's attributes fixed from idle to the first toast", () => {
    // An empty stack keeps the live region, so the first toast is announced.
    // A role or name that switched on with that toast would make the browser
    // rebuild the region in the same commit, with the toast already inside:
    // not announced. So idle and busy carry exactly the same attributes…
    const idle = regionOf(inGerman(<ToastViewport toasts={[]} onDismiss={noop} />))
    const busy = regionOf(inGerman(<ToastViewport toasts={toasts} onDismiss={noop} />))
    expect(idle).not.toBe("")
    expect(busy).toBe(idle)
    // …and no role or name at all: an idle stack is no second "status" beside
    // a view's own loading status (a generic element takes no aria-label).
    expect(attribute(idle, "role")).toBeUndefined()
    expect(attribute(idle, "aria-label")).toBeUndefined()
    const loading = inGerman(
      <ToastProvider>
        <p role="status">Ansicht wird geladen…</p>
      </ToastProvider>,
    )
    expect(loading.match(/role="status"/g)).toHaveLength(1)
    expect(loading.match(/aria-live="polite"/g)).toHaveLength(1)
  })

  it("shows the status as edge + icon next to plain text, never as coloured text", () => {
    const html = inGerman(<ToastViewport toasts={toasts} onDismiss={noop} />)
    const cards = openingTags(html, "div").filter((t) => /data-slot="toast"/.test(t))
    expect(cards.map((t) => attribute(t, "data-tone"))).toEqual(["success", "danger"])
    expect(cards[0]).toMatch(/border-l-success/)
    expect(cards[1]).toMatch(/border-l-danger/)
    for (const card of cards) expect(card).not.toMatch(/\btext-(success|danger|warning|info)\b/)
    // The edge survives the dark 3:1 rim (a later dark: rule would paint over it).
    expect(cards[0]).toMatch(/dark:border-input/)
    expect(cards[0]).toMatch(/dark:border-l-success/)
    // Icons are decorative and drawn in the tone colour; the text carries the message.
    const svgs = openingTags(html, "svg")
    for (const svg of svgs) expect(attribute(svg, "aria-hidden")).toBe("true")
    expect(attribute(svgs[0] ?? "", "class")).toContain(TONE_ICON.success)
    expect(attribute(svgs[2] ?? "", "class")).toContain(TONE_ICON.danger)
    expect(html).toContain("Job retried.")
    expect(html).toContain("Engine down (503)")
  })

  it("sets its words as running text (16 px), not in the dense-table size", () => {
    const html = inGerman(<ToastViewport toasts={toasts} onDismiss={noop} />)
    for (const card of openingTags(html, "div").filter((t) => /data-slot="toast"/.test(t))) {
      expect(attribute(card, "class")).toMatch(/(^| )text-body( |$)/)
      expect(attribute(card, "class")).not.toMatch(/\btext-dense\b/)
    }
  })

  it("gives every toast a native close button named in the locale, and steals no focus", () => {
    const html = inGerman(<ToastViewport toasts={toasts} onDismiss={noop} />)
    const buttons = openingTags(html, "button")
    expect(buttons).toHaveLength(2)
    for (const b of buttons) {
      expect(attribute(b, "type")).toBe("button")
      expect(attribute(b, "aria-label")).toBe(de.common.dismiss)
      expect(attribute(b, "class")).toContain(FOCUS_RING)
    }
    expectNoFocusTheft(html)
  })

  it("nests idempotently: one provider, one viewport", () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <ToastProvider>
          <p>body</p>
        </ToastProvider>
      </ToastProvider>,
    )
    expect(html.match(/data-slot="toast-viewport"/g)).toHaveLength(1)
    expect(html).toContain("<p>body</p>")
  })

  it("useToast outside a provider is a safe no-op", () => {
    let api: ToastApi | undefined
    function Probe() {
      api = useToast()
      return null
    }
    renderToStaticMarkup(<Probe />)
    expect(api?.show({ title: "x" })).toBe(-1)
    expect(() => api?.dismiss(1)).not.toThrow()
  })
})

describe("EmptyState", () => {
  it("is static (no live region), titles with h3 by default, hides its icon from AT", () => {
    const html = inGerman(
      <EmptyState
        icon={<CircleCheck />}
        tone="success"
        title="Keine offenen Incidents"
        description="Alles erledigt."
      />,
    )
    expect(html).not.toMatch(/role="(status|alert)"|aria-live/)
    expect(html).toMatch(/<h3[^>]*>Keine offenen Incidents<\/h3>/)
    const iconSlot = openingTags(html, "div").find((t) => /aria-hidden="true"/.test(t))
    // The success tone on the icon (TONE_ICON), never on the words.
    expect(iconSlot).toContain(TONE_ICON.success)
    expect(html).not.toMatch(/text-success-ink/)
    expect(html).toContain("Alles erledigt.")
  })

  it("sizes an icon to 24 px but lets a mark keep its own size-* class (the Komet needs room)", () => {
    const html = renderToStaticMarkup(
      <EmptyState icon={<svg className="size-12" aria-label="mark" />} title="Willkommen" />,
    )
    const slot = openingTags(html, "div").find((t) => /aria-hidden="true"/.test(t)) ?? ""
    const slotClass = attribute(slot, "class") ?? ""
    // The default applies only to an SVG without its own size class…
    expect(slotClass).toContain("[&_svg:not([class*='size-'])]:size-6")
    // …and never as a clamp that outranks the mark's class (0,1,1 beats 0,1,0).
    expect(slotClass).not.toMatch(/\[&_svg\]:size-/)
    expect(html).toContain('<svg class="size-12"')
  })

  it("takes the heading level of its surface and at most two actions", () => {
    const html = renderToStaticMarkup(
      <EmptyState
        titleAs="h2"
        title="Nothing here"
        action={<button type="button">First</button>}
        secondaryAction={<button type="button">Second</button>}
      />,
    )
    expect(html).toMatch(/<h2[^>]*>Nothing here<\/h2>/)
    expect(openingTags(html, "button")).toHaveLength(2)
    expect(renderToStaticMarkup(<EmptyState title="Bare" />)).not.toContain("<button")
  })

  it("sets its help line as running text (16 px), not in the dense-table size", () => {
    const html = renderToStaticMarkup(<EmptyState title="Nothing" description="Add one." />)
    const line = openingTags(html, "p").find((t) => /max-w-prose/.test(t)) ?? ""
    expect(attribute(line, "class")).toMatch(/(^| )text-body( |$)/)
    expect(html).not.toMatch(/\btext-dense\b/)
  })

  it("resolves an untyped tone: a retired success name colours the icon, anything else stays quiet", () => {
    const iconClass = (tone: string) => {
      const html = renderToStaticMarkup(
        <EmptyState
          icon={<CircleCheck />}
          tone={tone as unknown as EmptyStateProps["tone"]}
          title="x"
        />,
      )
      return openingTags(html, "div").find((t) => /aria-hidden="true"/.test(t)) ?? ""
    }
    expect(iconClass("ok")).toContain(TONE_ICON.success)
    expect(iconClass("danger")).toContain(TONE_ICON.neutral)
    expect(iconClass("purple")).toContain(TONE_ICON.neutral)
  })
})

describe("ErrorState", () => {
  it("announces itself (role=alert) with a heading, the hint, details and a retry in the locale", () => {
    const html = inGerman(
      <ErrorState
        title="Die Ansicht konnte nicht geladen werden"
        description="Versuch es noch mal."
        details="[503 ProcessEngineException] Engine is shutting down"
        onRetry={noop}
      />,
    )
    const root = openingTags(html, "div")[0] ?? ""
    expect(attribute(root, "role")).toBe("alert")
    expect(attribute(root, "data-variant")).toBe("block")
    expect(html).toMatch(/<h2[^>]*>Die Ansicht konnte nicht geladen werden<\/h2>/)
    // The raw reason sits collapsed in a native disclosure (keyboard-ready).
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Details<\/summary>/)
    expect(html).not.toMatch(/<details[^>]*\sopen/)
    const [retry] = openingTags(html, "button")
    expect(attribute(retry ?? "", "type")).toBe("button")
    expect(html).toContain(`${de.common.retry}</button>`)
    expectNoFocusTheft(html)
  })

  it("supports a quieter status role, no role at all, and the inline alert form", () => {
    const status = renderToStaticMarkup(<ErrorState title="Notice" role="status" tone="info" />)
    expect(attribute(openingTags(status, "div")[0] ?? "", "role")).toBe("status")
    const none = renderToStaticMarkup(<ErrorState title="Static" role="none" />)
    expect(attribute(openingTags(none, "div")[0] ?? "", "role")).toBeUndefined()
    const inline = renderToStaticMarkup(
      <ErrorState variant="inline" title="Partial" tone="warning" />,
    )
    expect(inline).toMatch(/<p[^>]*>Partial<\/p>/)
    expect(attribute(openingTags(inline, "div")[0] ?? "", "data-tone")).toBe("warning")
  })

  it.each(["danger", "warning", "info"] as const)(
    "shows the %s tone as rim, tint and icon; every word on the tint is the foreground (CI §3.3)",
    (tone) => {
      const html = renderToStaticMarkup(
        <ErrorState title="x" description="what to do" details="raw" tone={tone} onRetry={noop} />,
      )
      const rootClass = attribute(openingTags(html, "div")[0] ?? "", "class") ?? ""
      expect(rootClass).toContain(TONE_SOFT[tone])
      expect(rootClass).toContain(TONE_BORDER[tone])
      expect(attribute(openingTags(html, "svg")[0] ?? "", "class")).toContain(TONE_ICON[tone])
      // No quiet text, no ink and no status colour as text anywhere on the tint
      // (the icons, which carry the tone colour, set aside; a disabled button
      // draws its quiet text on its own opaque fill, CI §8).
      const words = html.replace(/<svg[\s\S]*?<\/svg>/g, "")
      expect(words).not.toMatch(
        /(?<!disabled:)text-muted-foreground|text-\w+-ink|text-(danger|warning|info)\b/,
      )
      // The disclosure is a kit control: the kit's opaque focus ring.
      expect(attribute(openingTags(html, "summary")[0] ?? "", "class")).toContain(FOCUS_RING)
    },
  )

  it("has no retry without onRetry, and takes custom labels", () => {
    expect(renderToStaticMarkup(<ErrorState title="x" />)).not.toContain("<button")
    const html = renderToStaticMarkup(
      <ErrorState
        title="x"
        details="raw"
        detailsLabel="Technical"
        onRetry={noop}
        retryLabel="Reload"
        actions={<a href="#help">Help</a>}
      />,
    )
    expect(html).toContain("Technical</summary>")
    expect(html).toContain("Reload</button>")
    expect(html).toContain('<a href="#help">Help</a>')
  })

  it("sets the block's description as running text (16 px); the inline alert box stays dense", () => {
    const descriptionClass = (html: string) =>
      /<div class="([^"]*)">what to do<\/div>/.exec(html)?.[1] ?? ""
    const block = renderToStaticMarkup(<ErrorState title="x" description="what to do" />)
    expect(descriptionClass(block)).toMatch(/(^| )text-body( |$)/)
    const inline = renderToStaticMarkup(
      <ErrorState variant="inline" title="x" description="what to do" />,
    )
    expect(descriptionClass(inline)).toMatch(/(^| )text-dense( |$)/)
  })

  it.each([
    ["error", "danger"],
    ["critical", "danger"],
    ["warn", "warning"],
    ["notice", "info"],
    ["success", "danger"],
    ["purple", "danger"],
  ])(
    "resolves an untyped tone %j to its %s state instead of crashing on a missing icon",
    (name, tone) => {
      const html = renderToStaticMarkup(
        <ErrorState title="x" tone={name as unknown as ErrorStateTone} />,
      )
      const root = openingTags(html, "div")[0] ?? ""
      expect(attribute(root, "data-tone")).toBe(tone)
      expect(attribute(root, "class")).toContain(TONE_BORDER[tone as ErrorStateTone])
      expect(attribute(openingTags(html, "svg")[0] ?? "", "class")).toContain(
        TONE_ICON[tone as ErrorStateTone],
      )
    },
  )
})
