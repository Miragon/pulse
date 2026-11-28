import { describe, expect, it } from "vitest"
import { keptAnswer, recordedRead, textReplacer, type AnswerPath } from "./recorded-answer.js"

/**
 * What a recording keeps of an answer: the paths a page reads (keys, `[]` for an array's elements,
 * `*` for a map's), each keeping all below it, the free text among them replaced, the diagrams
 * among them without what the engine runs; the paths an answer lacks told; and the typing that
 * holds a page's paths to the fields it reads.
 */

type Count = number | { atLeast: number } | null

interface Stats {
  asOf: string
  now: { running: number; started: Count }
  buckets: { start: string; endedAt: Record<string, Count> }[]
  durations: { from: string; medianMs: number | null } | null
  latest?: { message: string | null; at: string } | null
}

const ANSWER = {
  asOf: "2026-11-25T09:00:00.000Z",
  engine: "prod-a",
  now: { running: 3, started: { atLeast: 2 }, secret: "x" },
  buckets: [
    { start: "d1", end: "d2", endedAt: { End_A: 1, End_B: { atLeast: 0 } } },
    { start: "d2", end: "d3", endedAt: {} },
  ],
  durations: null,
  latest: { message: "Connection refused by 10.0.0.7", at: "t", by: "alice" },
}

const keep = (paths: readonly string[], text: readonly string[] = [], replace = true) =>
  keptAnswer(ANSWER, { paths, text }, { text: replace ? textReplacer() : null })

describe("keptAnswer", () => {
  it("keeps only the paths it names, an array's elements by [] and a map's keys by *", () => {
    const paths = ["asOf", "now.running", "buckets[].start", "buckets[].endedAt.*", "durations"]
    expect(keep(paths)).toEqual({
      data: {
        asOf: ANSWER.asOf,
        now: { running: 3 },
        buckets: [
          { start: "d1", endedAt: { End_A: 1, End_B: { atLeast: 0 } } },
          { start: "d2", endedAt: {} },
        ],
        durations: null,
      },
      lacking: [],
    })
  })

  it("keeps everything below a path, the whole answer for the empty one", () => {
    expect(keep(["now", "buckets"]).data).toEqual({ now: ANSWER.now, buckets: ANSWER.buckets })
    expect(keep([""]).data).toEqual(ANSWER)
    expect(keptAnswer([{ a: 1, b: 2 }], { paths: ["[].a"] }, { text: null }).data).toEqual([
      { a: 1 },
    ])
    expect(keptAnswer({ m: [[{ a: 1, b: 2 }]] }, { paths: ["m[][].a"] }, { text: null })).toEqual({
      data: { m: [[{ a: 1 }]] },
      lacking: [],
    })
  })

  it("keeps a scalar where the paths go deeper as it is, nothing of an object of another shape", () => {
    expect(keep(["asOf.x", "now[].running", "buckets.start"]).data).toEqual({
      asOf: ANSWER.asOf,
      now: {},
      buckets: [{}, {}],
    })
    expect(keptAnswer("text", { paths: ["a"] }, { text: null }).data).toBe("text")
  })

  it("tells each key it names that an object lacks, none under a null or past another shape", () => {
    const { lacking } = keep(["asOf", "missing", "now.incidents", "durations.from", "buckets[].x"])
    expect(lacking).toEqual(["missing", "now.incidents", "buckets[].x"])
    expect(keep(["buckets.*.start"]).lacking).toEqual([])
  })

  it("replaces the free text it names, in arrays and maps too, each distinct text once", () => {
    const answer = { rows: [{ m: "a" }, { m: "b" }, { m: "a" }], byId: { x: "c", y: 3 } }
    const { data } = keptAnswer(
      answer,
      { paths: ["rows", "byId"], text: ["rows[].m", "byId.*", "rows.m", "byId[]"] },
      { text: textReplacer() },
    )
    const placeholder = (n: number) => `Text left out of the recording (${String(n)})`
    expect(data).toEqual({
      rows: [{ m: placeholder(1) }, { m: placeholder(2) }, { m: placeholder(1) }],
      byId: { x: placeholder(3), y: 3 },
    })
    expect(keep(["latest"], ["latest.message"], false).data).toEqual({ latest: ANSWER.latest })
    expect(textReplacer()("")).toBe("")
  })

  it("replaces every string below a text path that names an object or an array", () => {
    const answer = { incidents: [{ message: "hunter2 in nested object", at: "t", count: 2 }] }
    const read = { paths: ["incidents"], text: ["incidents"] }
    expect(keptAnswer(answer, read, { text: textReplacer() }).data).toEqual({
      incidents: [
        {
          message: "Text left out of the recording (1)",
          at: "Text left out of the recording (2)",
          count: 2,
        },
      ],
    })
    const diagram = { diagram: { xml: '<task id="A" camunda:class="com.acme.Secret"/>', n: 1 } }
    const bpmn = { paths: ["diagram"], bpmn: ["diagram"] }
    expect(keptAnswer(diagram, bpmn, { text: null }).data).toEqual({
      diagram: { xml: '<task id="A"/>', n: 1 },
    })
  })

  it("keeps a placeholder as it is, so a recording recorded again keeps it in any order", () => {
    const placeholder = (n: number) => `Text left out of the recording (${String(n)})`
    const replace = textReplacer()
    expect([placeholder(2), "a", placeholder(2), "b", "a"].map(replace)).toEqual([
      placeholder(2),
      placeholder(1),
      placeholder(2),
      placeholder(3),
      placeholder(1),
    ])
  })

  it("keeps the BPMN diagrams it names without what the engine runs, their text as told", () => {
    const xml =
      '<bpmn:task id="A" camunda:assignee="alice"><bpmn:documentation>Ask Bob</bpmn:documentation>' +
      "<bpmn:extensionElements><camunda:x/></bpmn:extensionElements></bpmn:task>"
    const read = { paths: ["xml", "n"], bpmn: ["xml", "n"] }
    expect(keptAnswer({ xml, n: 1 }, read, { text: textReplacer() }).data).toEqual({
      xml: '<bpmn:task id="A"></bpmn:task>',
      n: 1,
    })
    expect(keptAnswer({ xml }, read, { text: null }).data).toEqual({
      xml: '<bpmn:task id="A"><bpmn:documentation>Ask Bob</bpmn:documentation></bpmn:task>',
    })
  })
})

describe("recordedRead", () => {
  it("passes a read through as it is", () => {
    const read = { paths: ["asOf", "now", "buckets", "durations", "latest"] } as const
    expect(recordedRead<Stats>()(read)).toBe(read)
  })

  it("types every path of the answer, and a read that keeps every field of it", () => {
    const paths: AnswerPath<Stats>[] = [
      "now.started.atLeast",
      "buckets[]",
      "buckets[].endedAt.*",
      "buckets[].endedAt.*.atLeast",
      "latest.message",
    ]
    expect(paths).toHaveLength(5)
    const asOf = "asOf"
    // @ts-expect-error durations.medianMs, latest.message and latest.at, named as `uncovered`
    const read = recordedRead<Stats>()({
      paths: [asOf, "now.running", "now.started", "buckets", "durations.from"],
    })
    expect(read.paths).toContain(asOf)
    // @ts-expect-error a path the answer does not have
    const typo: AnswerPath<Stats> = "now.runing"
    expect(typo).toBe("now.runing")
  })
})
