/// <reference types="node" />
import { describe, expect, it } from "vitest"
import {
  colour,
  contrast,
  DARK,
  LIGHT,
  MODES,
  over,
  ratio,
  read,
  role,
  type Mode,
} from "./theme-css.test-support.js"

/**
 * Every role/tone pair the kit renders meets WCAG contrast (text 4.5:1, non-text 3:1) in
 * BOTH modes, computed from the vendored token values, and the dark ground follows the
 * Miragon CI's dark-ground rules.
 */

const TONES = ["success", "warning", "danger", "info"] as const

/** Text pairs (WCAG 1.4.3, 4.5:1): [foreground role, surface role, where it renders]. */
const TEXT_PAIRS: [string, string, string][] = [
  ["--foreground", "--background", "body text"],
  ["--foreground", "--muted", "text on quiet surfaces (table heads, chips)"],
  ["--card-foreground", "--card", "Card"],
  ["--popover-foreground", "--popover", "Dialog"],
  ["--secondary-foreground", "--secondary", "secondary Button/Badge"],
  ["--accent-foreground", "--accent", "hovered outline/ghost Button, active FilterBar chip"],
  ["--muted-foreground", "--background", "secondary text"],
  ["--muted-foreground", "--card", "CardDescription, AlertDescription"],
  ["--muted-foreground", "--popover", "dialog descriptions"],
  ["--muted-foreground", "--muted", "KpiGrid header, TabsList, TONE_SOFT.neutral"],
  ["--primary-foreground", "--primary", "primary Button, default Badge"],
  ["--primary-foreground", "--primary-hover", "hovered primary Button"],
  ["--destructive-foreground", "--destructive", "destructive Button"],
  ["--link", "--background", "link Button, links"],
  ["--link", "--card", "links in cards"],
  ["--link", "--popover", "links in dialogs"],
  ["--link", "--muted", "links on quiet surfaces"],
  ["--link", "--accent", "a link-coloured control while hovered"],
  ["--sidebar-foreground", "--sidebar", "sidebar"],
  ["--sidebar-primary-foreground", "--sidebar-primary", "sidebar primary"],
  ["--sidebar-accent-foreground", "--sidebar-accent", "sidebar accent"],
  ...TONES.flatMap((tone): [string, string, string][] => [
    [`--foreground`, `--${tone}-soft`, `TONE_SOFT.${tone} (Badge, Pills, banners, Alert)`],
    [`--${tone}-ink`, "--background", `TONE_INK.${tone}`],
    [`--${tone}-ink`, "--card", `TONE_INK.${tone} in a card`],
    [`--${tone}-ink`, "--popover", `TONE_INK.${tone} in a dialog`],
    [`--${tone}-ink`, "--muted", `TONE_INK.${tone} on a quiet surface`],
  ]),
]

/**
 * Text pairs that hold in LIGHT only, by design: dark lifts the hover/selected
 * (--accent) and secondary surfaces 10 % so they stay visible, and
 * --cd-kontur keeps 4.5:1 only up to a 3 % lift. On these surfaces quiet text
 * takes the surface's own foreground (`group-hover:text-accent-foreground`);
 * the design-system gate checks that a class string switching to one of these
 * surfaces switches the text too. Pinned below so the exemption is dropped
 * the day it is no longer needed.
 */
const LIGHT_ONLY_TEXT_PAIRS: [string, string, string][] = [
  ["--muted-foreground", "--accent", "quiet text on a hovered/selected item"],
  ["--muted-foreground", "--secondary", "quiet text on a secondary surface"],
]

/** Non-text pairs (WCAG 1.4.11, 3:1) that identify a control or its state. */
const NON_TEXT_PAIRS: [string, string, string][] = [
  ["--input", "--background", "Input/Select border, unchecked Switch track"],
  ["--input", "--card", "inputs in cards"],
  ["--input", "--popover", "inputs in dialogs"],
  ["--input", "--muted", "inputs on quiet surfaces"],
  ...["--background", "--card", "--popover", "--muted", "--accent"].flatMap(
    (bg): [string, string, string][] => [
      ["--focus", bg, "FOCUS_RING, :focus-visible outline"],
      ["--ring", bg, "legacy ring utilities"],
    ],
  ),
  ["--primary", "--background", "checked Switch track, active tab indicator"],
  ["--primary", "--card", "checked Switch in a card"],
  ["--primary", "--popover", "checked Switch in a dialog"],
]

/**
 * Status colours as fills/dots/borders that are NOT asserted on light, by CI
 * rule (§3.3): success and amber reach only 1.67:1 / 1.83:1 on white, so a
 * status is never colour alone: every toned dot, border or icon sits next to
 * text that carries it. The test pins that the exemption is still needed.
 */
const LIGHT_EXEMPT_STATUS = ["--success", "--warning"]

/**
 * Where a status colour renders as a dot, border or icon (non-text, 3:1), per
 * tone: the page (KpiGrid dot, EmptyState icon, Pills), an overlay card (the
 * Toast's left edge and icon) and the tone's own tint (the ErrorState's rim and
 * icon). Same CI exemption as above on light.
 */
const STATUS_SURFACES = (tone: (typeof TONES)[number]): [string, string][] => [
  ["--background", "dot, border or icon on the page"],
  ["--popover", "Toast edge and icon"],
  [`--${tone}-soft`, "ErrorState rim and icon on its own tint"],
]

describe.each(MODES)("contrast in %s mode (computed from the vendored tokens)", (mode) => {
  it.each(TEXT_PAIRS)("text %s on %s ≥ 4.5:1 — %s", (fg, bg) => {
    expect(ratio(fg, bg, mode)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(LIGHT_ONLY_TEXT_PAIRS)(
    "text %s on %s ≥ 4.5:1 in light only (dark exemption still needed) — %s",
    (fg, bg) => {
      if (mode === "light") expect(ratio(fg, bg, mode)).toBeGreaterThanOrEqual(4.5)
      else expect(ratio(fg, bg, mode)).toBeLessThan(4.5)
    },
  )

  it.each(NON_TEXT_PAIRS)("non-text %s on %s ≥ 3:1 — %s", (fg, bg) => {
    expect(ratio(fg, bg, mode)).toBeGreaterThanOrEqual(3)
  })

  it.each(
    TONES.flatMap((tone) =>
      STATUS_SURFACES(tone).map(([bg, where]): [string, string, string] => [
        `--${tone}`,
        bg,
        where,
      ]),
    ),
  )("status colour %s on %s ≥ 3:1 unless CI-exempt on light — %s", (name, bg) => {
    const r = ratio(name, bg, mode)
    if (mode === "light" && LIGHT_EXEMPT_STATUS.includes(name)) {
      // Still exempt? If the CI ever lifts it to 3:1, drop the exemption.
      expect(r).toBeLessThan(3)
    } else {
      expect(r).toBeGreaterThanOrEqual(3)
    }
  })
})

describe("dark mode follows the CI dark-ground rules", () => {
  it("grounds on --cd-schwarz with white text, green links, blue buttons, blau-hell focus", () => {
    expect(DARK["--background"]).toBe("var(--cd-schwarz)")
    expect(DARK["--foreground"]).toBe("var(--cd-weiss)")
    expect(DARK["--link"]).toBe("var(--cd-gruen)")
    expect(DARK["--primary"]).toBe("var(--cd-blau)")
    expect(DARK["--primary-foreground"]).toBe("var(--cd-weiss)")
    expect(DARK["--destructive-foreground"]).toBe("var(--cd-weiss)")
    expect(DARK["--focus"]).toBe("var(--cd-blau-hell)")
    expect(DARK["--muted-foreground"]).toBe("var(--cd-kontur)")
  })

  it("uses the -hell status values with no tinted fills", () => {
    for (const tone of TONES) {
      expect(DARK[`--${tone}`]).toBe(`var(--cd-${tone}-hell)`)
      expect(DARK[`--${tone}-ink`]).toBe(`var(--cd-${tone}-hell)`)
      expect(DARK[`--${tone}-soft`]).toBe("transparent")
    }
  })

  it("lifts surfaces only with white mixed into --cd-schwarz", () => {
    for (const name of ["--muted", "--secondary", "--accent"]) {
      expect(DARK[name]).toMatch(
        /^color-mix\(in srgb, var\(--cd-weiss\) \d+%, var\(--cd-schwarz\)\)$/,
      )
    }
  })

  it("keeps overlays on the ground (any lift drops a checked Switch below 3:1) and pushes the page back harder", () => {
    expect(DARK["--popover"]).toBe("var(--cd-schwarz)")
    const onLift = over(
      colour(role("--primary", "dark")),
      colour("color-mix(in srgb, var(--cd-weiss) 2%, var(--cd-schwarz))"),
    )
    // Why not lift: --cd-blau is 3.08:1 on the ground and under 3:1 from a 2 % lift.
    expect(
      contrast(onLift, colour("color-mix(in srgb, var(--cd-weiss) 2%, var(--cd-schwarz))")),
    ).toBeLessThan(3)
    const scrimAlpha = (mode: Mode) => colour(role("--scrim", mode)).a
    expect(role("--scrim", "dark")).toMatch(
      /^color-mix\(in srgb, var\(--cd-schwarz\) \d+%, transparent\)$/,
    )
    expect(scrimAlpha("dark")).toBeGreaterThan(scrimAlpha("light"))
  })

  it("draws the overlay edge in dark with the 3:1 input border (shadows vanish on the ground)", () => {
    const panel = read("../primitives/dialog.tsx")
      .split("\n")
      .find((line) => /\bbg-popover\b/.test(line))
    expect(panel).toMatch(/\sdark:border-input\s/)
    expect(ratio("--input", "--popover", "dark")).toBeGreaterThanOrEqual(3)
  })
})

describe("light mode text never uses a status colour that fails on white", () => {
  it("routes success/warning text to the foreground ink", () => {
    expect(LIGHT["--success-ink"]).toBe("var(--cd-schwarz)")
    expect(LIGHT["--warning-ink"]).toBe("var(--cd-schwarz)")
  })

  it("keeps the CI backdrop on light (modeler-tool-design §8)", () => {
    expect(LIGHT["--scrim"]).toBe("color-mix(in srgb, var(--cd-schwarz) 42%, transparent)")
  })
})
