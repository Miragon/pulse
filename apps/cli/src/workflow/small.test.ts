import { describe, expect, it } from "vitest"
import { itemCommand } from "./next.js"
import {
  amount,
  compareText,
  compareTime,
  countOf,
  definitionKeyOf,
  engineFormat,
  engineTime,
  field,
  num,
  records,
  str,
  yes,
} from "./records.js"
import { shellWord } from "./shell.js"
import { timelineOf } from "./timeline.js"

describe("records", () => {
  it("reads typed properties defensively", () => {
    expect(records([{ a: 1 }, null, "x", [1]])).toEqual([{ a: 1 }])
    expect(records("x")).toEqual([])
    expect([
      str({ a: "x" }, "a"),
      str({ a: "" }, "a"),
      str({ a: 1 }, "a"),
      str(undefined, "a"),
    ]).toEqual(["x", undefined, undefined, undefined])
    expect([num({ a: 1 }, "a"), num({ a: 3n }, "a"), num({ a: "1" }, "a")]).toEqual([
      1,
      3,
      undefined,
    ])
    expect([yes({ a: true }, "a"), yes({ a: "true" }, "a")]).toEqual([true, false])
    expect([countOf({ count: 4 }), countOf({}), countOf(null)]).toEqual([4, 0, 0])
    expect([definitionKeyOf("order:1:x"), definitionKeyOf(""), definitionKeyOf(undefined)]).toEqual(
      ["order", undefined, undefined],
    )
  })

  it("reads and writes engine timestamps", () => {
    expect(engineTime("2024-05-01T10:00:00.000+0200")).toBe(Date.parse("2024-05-01T08:00:00.000Z"))
    expect(engineTime("2024-05-01T08:00:00Z")).toBe(Date.parse("2024-05-01T08:00:00.000Z"))
    expect([engineTime("nope"), engineTime(undefined)]).toEqual([undefined, undefined])
    expect(engineFormat(Date.parse("2024-05-01T08:00:00.000Z"))).toBe(
      "2024-05-01T08:00:00.000+0000",
    )
    expect([compareText("a", "b"), compareText("b", "a"), compareText("a", "a")]).toEqual([
      -1, 1, 0,
    ])
    expect([
      compareTime("2024-01-01", "2024-01-02"),
      compareTime("2024-01-02", "2024-01-01"),
      compareTime(undefined, "2024-01-01"),
      compareTime(undefined, undefined),
    ]).toEqual([-1, 1, 1, 0])
  })
})

describe("shellWord", () => {
  it("quotes only what needs quoting", () => {
    expect(shellWord("order-process_2.v1")).toBe("order-process_2.v1")
    expect(shellWord("my task")).toBe("'my task'")
    expect(shellWord("it's")).toBe("'it'\\''s'")
  })
})

describe("itemCommand", () => {
  it("names the generated command that moves one wait state", () => {
    const at = { activityId: "a", executionId: "ex1", eventSubscriptionId: "s1" }
    expect(itemCommand({ ...at, kind: "message", eventName: "Paid now" })).toBe(
      "pulse-cli execution trigger-event ex1 'Paid now'",
    )
    expect(itemCommand({ ...at, kind: "signal", eventName: "go" })).toBe(
      "pulse-cli signal throw --name go --execution-id ex1",
    )
    expect(itemCommand({ ...at, kind: "message" })).toBe("pulse-cli execution trigger-event ex1 ''")
    expect(itemCommand({ activityId: "r", kind: "other", executionId: "ex2" })).toBe(
      "pulse-cli execution signal ex2",
    )
    expect(
      itemCommand({ activityId: "t", kind: "timer", jobId: "j", dueDate: "d", retries: 1 }),
    ).toBe("pulse-cli job execute j")
    expect(itemCommand({ ...at, kind: "conditional" })).toBeUndefined()
  })
})

describe("timelineOf", () => {
  it("attaches incidents to the last entry of their activity that started before them, else the first", () => {
    const entries = timelineOf(
      [
        {
          activityId: "book",
          activityType: "serviceTask",
          startTime: "2026-01-01T00:00:01.000+0000",
        },
        {
          activityId: "book",
          activityType: "serviceTask",
          startTime: "2026-01-01T00:00:05.000+0000",
        },
        {
          activityId: "later",
          activityType: "serviceTask",
          startTime: "2026-01-01T00:00:09.000+0000",
        },
      ],
      [
        {
          id: "h2",
          incidentType: "failedJob",
          activityId: "book",
          createTime: "2026-01-01T00:00:06.000+0000",
          open: true,
        },
        {
          id: "h1",
          incidentType: "failedJob",
          activityId: "book",
          createTime: "2026-01-01T00:00:02.000+0000",
          deleted: true,
        },
        {
          id: "h3",
          incidentType: "failedJob",
          activityId: "later",
          createTime: "2026-01-01T00:00:03.000+0000",
        },
        {
          id: "h4",
          incidentType: "failedJob",
          activityId: "nowhere",
          createTime: "2026-01-01T00:00:03.000+0000",
        },
      ],
    )
    expect(entries.map((entry) => entry.incidents?.map((incident) => incident.state))).toEqual([
      ["deleted"],
      ["open"],
      ["resolved"],
    ])
  })
})

describe("record helpers without a record", () => {
  it("are false, missing or zero for undefined", () => {
    expect([yes(undefined, "a"), amount(undefined, "a"), field(undefined, "a")]).toEqual([
      false,
      0,
      "",
    ])
  })
})
