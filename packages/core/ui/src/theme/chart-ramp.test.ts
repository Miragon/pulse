import { describe, expect, it } from "vitest"
import {
  contrastFindings,
  contrastRatio,
  parseThemeVariables,
  resolveColor,
  ROLE_CONTRAST_PAIRS,
  themeStylesheets,
  type ThemeMode,
} from "../testing/index.js"
import { DARK, DARK_KONTRAST, KONTRAST, LIGHT } from "./theme-css.test-support.js"

/**
 * The data-viz ramp of theme.css (owner decision 2026-11-24): `--chart-1` to `--chart-5` are one
 * hue from `--cd-blau` to `--cd-info-soft` in the order a chart's series take it, the two series
 * steps 3:1 on every surface a chart sits on and told apart by lightness, for normal vision and
 * under the three colour-vision deficiencies, in light, dark and high contrast. Red is the
 * incidents' alone and must stay apart from both.
 */

const theme = parseThemeVariables(...themeStylesheets())
const MODES: readonly ThemeMode[] = ["light", "dark"]
const STEPS = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"] as const
const SERIES = ["--chart-1", "--chart-2"] as const

type Rgb = ReturnType<typeof resolveColor>
const colour = (name: string, mode: ThemeMode): Rgb => resolveColor(`var(${name})`, theme[mode])

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const gamma = (c: number) => {
  const x = Math.min(1, Math.max(0, c))
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
}

/** OKLab (Björn Ottosson, 2020) of an sRGB colour. */
function oklab({ r, g, b }: Rgb): [number, number, number] {
  const [lr, lg, lb] = [r, g, b].map(linear) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** Colour-vision deficiency at full severity (Machado, Oliveira and Fernandes 2009), linear RGB. */
const CVD = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
} as const

type Vision = "normal" | keyof typeof CVD
const VISIONS: readonly Vision[] = ["normal", "protan", "deutan", "tritan"]

function seen(c: Rgb, vision: Vision): Rgb {
  if (vision === "normal") return c
  const lin = [c.r, c.g, c.b].map(linear)
  const [r, g, b] = CVD[vision].map((row) => row.reduce((sum, k, i) => sum + k * lin[i], 0))
  return { r: gamma(r), g: gamma(g), b: gamma(b), a: 1 }
}

/** OKLab distance ×100, the unit colour-vision checks are stated in. */
function distance(a: Rgb, b: Rgb, vision: Vision): number {
  const [x, y] = [oklab(seen(a, vision)), oklab(seen(b, vision))]
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) * 100
}

const lightness = (name: string, mode: ThemeMode) => oklab(colour(name, mode))[0]

describe("the ramp's steps (theme.css)", () => {
  const ON_RAMP =
    /^(?:var\(--cd-(?:blau|info-soft)\)|color-mix\(in srgb, var\(--cd-blau\) \d+%, var\(--cd-info-soft\)\))$/
  /** On dark, past --cd-blau toward the ground: the dark BPMN paper's ramp. */
  const TO_GROUND = /^color-mix\(in srgb, var\(--cd-blau\) \d+%, var\(--cd-schwarz\)\)$/

  it("are one hue from --cd-blau to --cd-info-soft, the dark fills on toward the ground", () => {
    for (const step of STEPS) expect(LIGHT[step], `light ${step}`).toMatch(ON_RAMP)
    for (const step of STEPS.slice(0, 3)) expect(DARK[step], `dark ${step}`).toMatch(ON_RAMP)
    for (const step of STEPS.slice(3)) expect(DARK[step], `dark ${step}`).toMatch(TO_GROUND)
  })

  it("start with the step that stands off the surface most, each next one nearer to it", () => {
    const light = STEPS.map((s) => lightness(s, "light"))
    const dark = STEPS.map((s) => lightness(s, "dark"))
    expect(
      [...light].sort((a, b) => a - b),
      "light: lighter toward the white card",
    ).toEqual(light)
    expect(
      [...dark].sort((a, b) => b - a),
      "dark: darker toward the ground",
    ).toEqual(dark)
  })

  it("leave --chart-3 to --chart-5 below 3:1 on a card: fills, never a series", () => {
    for (const mode of MODES) {
      const card = colour("--card", mode)
      for (const step of STEPS.slice(2)) {
        expect(contrastRatio(colour(step, mode), card), `${mode} ${step}`).toBeLessThan(3)
      }
    }
  })
})

describe("a chart's two series", () => {
  it.each(MODES)("are 0.1 or more apart in lightness (%s)", (mode) => {
    const [first, second] = SERIES.map((s) => lightness(s, mode))
    expect(Math.abs(first - second)).toBeGreaterThanOrEqual(0.1)
  })

  it.each(MODES.flatMap((mode) => VISIONS.map((vision) => [mode, vision] as const)))(
    "stay 8 or more apart in OKLab, and from the incidents' red (%s, %s vision)",
    (mode, vision) => {
      const [first, second] = SERIES.map((s) => colour(s, mode))
      const red = colour("--danger", mode)
      expect(distance(first, second, vision), "first and second").toBeGreaterThanOrEqual(8)
      expect(distance(first, red, vision), "first and red").toBeGreaterThanOrEqual(8)
      expect(distance(second, red, vision), "second and red").toBeGreaterThanOrEqual(8)
    },
  )

  it("and the incidents' red are 3:1 on the card, the ground, a meter's track and the tooltip", () => {
    const pairs = ROLE_CONTRAST_PAIRS.filter((p) => p.label.startsWith("chart mark"))
    expect(pairs).toHaveLength(3 * 4)
    expect(contrastFindings(theme, pairs)).toEqual([])
  })

  it("keep 3:1 in high contrast (data-cd-kontrast), whose roles they stand on too", () => {
    const declare = (decls: Record<string, string>) =>
      Object.entries(decls)
        .map(([name, value]) => `${name}: ${value};`)
        .join(" ")
    const hoch = parseThemeVariables(
      ...themeStylesheets(),
      `:root { ${declare(KONTRAST)} }`,
      `.dark { ${declare(DARK_KONTRAST)} }`,
    )
    expect(hoch.light.get("--border")).toBe("var(--cd-kontur)")
    expect(contrastFindings(hoch, ROLE_CONTRAST_PAIRS)).toEqual([])
  })
})
