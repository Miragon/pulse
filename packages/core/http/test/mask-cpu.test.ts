/**
 * The CPU time of masking a large JSON answer in one pass (#691, F34): CPU time, which a loaded
 * runner stretches far less than the clock. It is the whole process's, and vitest's forks pool
 * runs this file in a process of its own, apart from mask-linear.test.ts: a spy on
 * `RegExp.prototype` leaves V8's fast paths for regular expressions off for the rest of the
 * process it ran in, which slows every pattern, the reference's too.
 */
import { describe, expect, it } from "vitest"
import { basicCredential, MASK, maskJsonText, secretForms } from "../src/index.js"
import { referenceMaskJsonText } from "./mask-reference.js"

/** What `mask` returns and the CPU time it took, in ms. */
function timed(mask: () => string): { masked: string; ms: number } {
  const before = process.cpuUsage()
  const masked = mask()
  const { user, system } = process.cpuUsage(before)
  return { masked, ms: (user + system) / 1000 }
}

describe("maskJsonText masks a large answer in one pass", { timeout: 60_000 }, () => {
  const password = "p@ss  wo/rd!+é"
  /** The ten forms of a Basic credential with that password. */
  const tenForms = async () =>
    secretForms((await basicCredential("demo", password).authorization())?.secrets ?? [])

  it("of 400,000 literals and numbers", async () => {
    const forms = await tenForms()
    const values = Array.from({ length: 200_000 }, (_, at) => [`v${String(at % 10)}`, at % 100])
    const message = "Cannot correlate\n\tat org.engine.Step(Step.java:42)"
    const text = JSON.stringify({ type: "X", message, values, said: `sent ${password}` })
    const { masked, ms } = timed(() => maskJsonText(text, forms))
    expect(forms).toHaveLength(10)
    expect(masked).toBe(text.replace(password, MASK))
    // The pass costs 15 to 35 ms, and 50 to 130 ms with coverage on a runner at its limit; a
    // pattern compiled per form for every literal and number, as up to 0.34, cost 6 to 11 s
    // there, so 2 s tells the two apart.
    expect(ms).toBeLessThan(2000)
  })

  it("of 300,000 literals that each hold an escape and no secret, at the cost of one form", async () => {
    // The forms of a Basic credential, an API key and a client secret.
    const forms = [
      ...(await tenForms()),
      ...secretForms(["k3y of/the api+1", "cl1ent s3cret/val!"]),
    ]
    const escaped = ["\n", "\t", '"']
    const lines = Array.from({ length: 300_000 }, (_, at) => escaped[at % escaped.length])
    const text = JSON.stringify({ type: "X", lines, said: `sent ${password}` })
    const runs = [0, 1, 2].map(() => ({
      all: timed(() => maskJsonText(text, forms)),
      one: timed(() => maskJsonText(text, [password])),
    }))
    const least = (of: "all" | "one") => Math.min(...runs.map((run) => run[of].ms))
    expect(forms).toHaveLength(18)
    expect(runs[0]!.all.masked).toBe(text.replace(password, MASK))
    // Each literal is parsed and searched once for all forms, and written back only if that
    // changed it: 80 to 100 ms, 190 to 200 ms with coverage on a runner at its limit, 1 to 1.3
    // times what one form costs. Masked form by form, as up to 0.34 and before the one search,
    // the eighteen cost 2.5 to 3.3 times one.
    expect(least("all")).toBeLessThan(2000)
    expect(least("all")).toBeLessThan(2 * least("one"))
  })

  it.each([
    ["0000", "0"],
    ["----", "-"],
  ])(
    "of a 3 MB run in which a form overlapping itself (%s) starts at every character, about as fast as up to 0.34",
    (secret, char) => {
      const forms = secretForms([secret])
      const text = JSON.stringify({ type: "X", message: `dump ${char.repeat(3_000_000)}`, n: 1 })
      // The least of three runs of each, taken in turn, so a moment of load weighs on neither.
      const runs = [0, 1, 2].map(() => ({
        linear: timed(() => maskJsonText(text, forms)),
        reference: timed(() => referenceMaskJsonText(text, forms)),
      }))
      const least = (of: "linear" | "reference") => Math.min(...runs.map((run) => run[of].ms))
      expect(runs[0]!.linear.masked).toBe(runs[0]!.reference.masked)
      // The run costs 80 to 120 ms, 0.4 to 1.1 times the reference's, which builds the same
      // masked text; searched from each occurrence to the next, it cost 2.2 to 3.1 times.
      expect(least("linear")).toBeLessThan(1.5 * least("reference"))
    },
  )
})
