import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { attribute, openingTags, userFacingTexts } from "../render-scan.js"
import { TONE_BORDER, TONE_DOT, TONE_SOFT, TONE_VARIANTS } from "../lib/tone-utils.js"
import { CountPill, LivePill, StatusBadge } from "./Pills.js"

const classOf = (tag: string | undefined) => attribute(tag ?? "", "class") ?? ""

describe("StatusBadge: the state in words, marked in its tone", () => {
  it.each(TONE_VARIANTS)("%s: tint, edge and a decorative dot next to foreground text", (tone) => {
    const html = renderToStaticMarkup(<StatusBadge tone={tone}>Suspended</StatusBadge>)
    const [badge, dot] = openingTags(html, "span")
    expect(attribute(badge ?? "", "data-tone")).toBe(tone)
    expect(classOf(badge)).toContain(TONE_SOFT[tone])
    expect(classOf(badge)).toContain(TONE_BORDER[tone])
    expect(classOf(badge)).toContain("text-small")
    expect(attribute(dot ?? "", "aria-hidden")).toBe("true")
    expect(classOf(dot)).toContain(TONE_DOT[tone])
    // The words carry the state; no tone colour reaches them.
    expect(html).not.toMatch(/\btext-(?:success|warning|danger|info)(?:-ink)?\b/)
    expect(userFacingTexts(html).map((t) => t.value)).toEqual(["Suspended"])
  })

  it("maps a retired tone name onto the vocabulary (critical → danger)", () => {
    const html = renderToStaticMarkup(<StatusBadge tone="critical">Open</StatusBadge>)
    expect(attribute(openingTags(html, "span")[0] ?? "", "data-tone")).toBe("danger")
  })

  it("requires its text: colour is never the only signal", () => {
    // @ts-expect-error — children are mandatory
    const bare = <StatusBadge tone="danger" />
    // @ts-expect-error — null is no text either
    const nothing = <StatusBadge tone="danger">{null}</StatusBadge>
    expect(bare.props).not.toHaveProperty("children")
    expect(nothing.props).toHaveProperty("children", null)
    const mixed = renderToStaticMarkup(
      <StatusBadge tone="info">
        {3} open {"incidents"}
      </StatusBadge>,
    )
    expect(mixed.replace(/<!-- -->/g, "")).toContain("3 open incidents")
  })
})

describe("LivePill and CountPill", () => {
  it("LivePill pulses only without reduced motion and defaults to the locale's Live", () => {
    const html = renderToStaticMarkup(<LivePill />)
    const dot = openingTags(html, "span")[1] ?? ""
    expect(classOf(dot)).toContain("motion-safe:animate-pulse")
    expect(classOf(dot).split(/\s+/)).not.toContain("animate-pulse")
    expect(html).toContain(">Live</span>")
    expect(classOf(openingTags(html, "span")[0])).toContain(TONE_SOFT.info)
  })

  it("CountPill keeps a neutral count in the foreground on the muted tint", () => {
    const html = renderToStaticMarkup(<CountPill>7</CountPill>)
    expect(classOf(openingTags(html, "span")[0])).toContain("bg-muted text-foreground")
    expect(html).not.toContain("text-muted-foreground")
  })

  it("both take a className and resolve tone aliases", () => {
    const live = renderToStaticMarkup(
      <LivePill tone="ok" className="ml-2">
        On
      </LivePill>,
    )
    expect(classOf(openingTags(live, "span")[0])).toContain(TONE_SOFT.success)
    expect(classOf(openingTags(live, "span")[0])).toContain("ml-2")
    const count = renderToStaticMarkup(
      <CountPill tone="error" className="ml-auto">
        3
      </CountPill>,
    )
    expect(classOf(openingTags(count, "span")[0])).toContain(TONE_BORDER.danger)
    expect(classOf(openingTags(count, "span")[0])).toContain("ml-auto")
  })
})
