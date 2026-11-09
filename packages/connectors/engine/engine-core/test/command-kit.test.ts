import { describe, expect, test } from "vitest"
import { ElementId, RuntimeError, ValueKinds, type ProcessCommands } from "../src/index.js"
import {
  COMMAND_CASE,
  ConformanceKit,
  PatchedCommands,
  PatchedRuntime,
  WORLD_ELEMENT,
  type CommandCaseName,
  type CommandHarness,
} from "../src/testing/index.js"
import { CommandHarnesses } from "./support/command-harnesses.js"

type Sabotage = (commands: ProcessCommands, harness: CommandHarness) => Partial<ProcessCommands>

function sabotaged(sabotage: Sabotage): CommandHarness {
  const harness = CommandHarnesses.conforming()
  return {
    ...harness,
    commands: new PatchedCommands(harness.commands, sabotage(harness.commands, harness)),
  }
}

const SABOTAGES: readonly (readonly [string, Sabotage, readonly CommandCaseName[]])[] = [
  [
    "a retry closes every open incident",
    (commands, harness) => ({
      retryIncident: async (incidentId) => {
        const page = await harness.runtime.searchIncidents({}, { limit: 50 })
        for (const incident of page.items) {
          await commands.retryIncident(incident.id)
        }
        if (!page.items.some((incident) => incident.id === incidentId)) {
          throw new RuntimeError("rejected", "not open")
        }
      },
    }),
    [COMMAND_CASE.retryClosesIncident, COMMAND_CASE.retryRejected],
  ],
  [
    "a retry of a closed incident is silently ignored",
    (commands) => ({
      retryIncident: (incidentId) => commands.retryIncident(incidentId).catch(() => undefined),
    }),
    [COMMAND_CASE.retryRejected],
  ],
  [
    "a changed variable is stored as text",
    (commands) => ({
      setVariable: (instanceId, change) =>
        commands.setVariable(instanceId, {
          ...change,
          valueJson: JSON.stringify(change.valueJson),
        }),
    }),
    [COMMAND_CASE.variableReadsBack, COMMAND_CASE.variableLossless],
  ],
  [
    "numbers pass through a double",
    (commands) => ({
      setVariable: (instanceId, change) =>
        commands.setVariable(instanceId, {
          ...change,
          valueJson: /^\d+$/.test(change.valueJson)
            ? String(Number(change.valueJson))
            : change.valueJson,
        }),
    }),
    [COMMAND_CASE.variableLossless],
  ],
  [
    "unknown and ended instances fail as engine failures",
    (commands) => ({
      setVariable: (instanceId, change) =>
        commands.setVariable(instanceId, change).catch(() => {
          throw new RuntimeError("engineFailure", "boom")
        }),
    }),
    [COMMAND_CASE.variableRejected],
  ],
  [
    "a move cancels its source without starting its target",
    (commands) => ({
      moveToken: (instanceId, move) =>
        commands.moveToken(instanceId, {
          ...move,
          toElementId: ElementId(WORLD_ELEMENT.orderReviewed),
        }),
    }),
    [COMMAND_CASE.moveSkips, COMMAND_CASE.moveReruns],
  ],
  [
    "a refused move is silently ignored",
    (commands) => ({
      moveToken: (instanceId, move) => commands.moveToken(instanceId, move).catch(() => undefined),
    }),
    [COMMAND_CASE.moveRejected],
  ],
  [
    "a move without a reason goes through",
    (commands) => ({
      moveToken: (instanceId, move) =>
        commands.moveToken(instanceId, {
          ...move,
          reason: move.reason.trim() === "" ? "filled in" : move.reason,
        }),
    }),
    [COMMAND_CASE.moveRejected],
  ],
]

describe("the conforming fake commands", () => {
  new ConformanceKit(test).registerCommandLaws(() => Promise.resolve(CommandHarnesses.conforming()))

  test("fail no case", async () => {
    expect(await CommandHarnesses.failingCases(CommandHarnesses.conforming())).toEqual([])
  })
})

describe("the command kit", () => {
  test("pins every case name", () => {
    expect(
      ConformanceKit.commandLaws()
        .map((conformanceCase) => conformanceCase.name)
        .sort(),
    ).toEqual(Object.values(COMMAND_CASE).sort())
  })

  test.each(SABOTAGES)("catches commands where %s", async (_flaw, sabotage, expected) => {
    expect(await CommandHarnesses.failingCases(sabotaged(sabotage))).toEqual([...expected].sort())
  })
})

const STALE_READS_AFTER_A_WRITE = 3
const VISIBLE_WITHIN = { withinMs: 2_000, wait: () => Promise.resolve() }

function lagging(): CommandHarness {
  const harness = CommandHarnesses.conforming()
  const lastSeen = new Map<string, unknown>()
  let staleReads = 0
  const stale = <Result>(key: string, read: () => Promise<Result>): Promise<Result> => {
    if (staleReads > 0 && lastSeen.has(key)) {
      staleReads -= 1
      return Promise.resolve(lastSeen.get(key) as Result)
    }
    return read().then((result) => {
      lastSeen.set(key, result)
      return result
    })
  }
  const written = (write: Promise<void>) =>
    write.then(() => {
      staleReads = STALE_READS_AFTER_A_WRITE
    })
  return {
    ...harness,
    runtime: new PatchedRuntime(harness.runtime, {
      searchIncidents: (filter, page) =>
        stale(`incidents ${JSON.stringify(filter)}`, () =>
          harness.runtime.searchIncidents(filter, page),
        ),
      getInstanceDetail: (instanceId) =>
        stale(`detail ${instanceId}`, () => harness.runtime.getInstanceDetail(instanceId)),
    }),
    commands: new PatchedCommands(harness.commands, {
      retryIncident: (incidentId) => written(harness.commands.retryIncident(incidentId)),
      setVariable: (instanceId, change) =>
        written(harness.commands.setVariable(instanceId, change)),
      moveToken: (instanceId, move) => written(harness.commands.moveToken(instanceId, move)),
    }),
  }
}

describe("reads that lag behind writes", () => {
  test("fail every read-back without a declared write visibility", async () => {
    expect(await CommandHarnesses.failingCases(lagging())).toEqual(
      [
        COMMAND_CASE.retryClosesIncident,
        COMMAND_CASE.variableReadsBack,
        COMMAND_CASE.variableLossless,
        COMMAND_CASE.moveSkips,
        COMMAND_CASE.moveReruns,
      ].sort(),
    )
  })

  test("pass once the harness declares how long a write may take to show", async () => {
    expect(
      await CommandHarnesses.failingCases({ ...lagging(), writeVisibility: VISIBLE_WITHIN }),
    ).toEqual([])
  })

  test("do not wait out an engine error", async () => {
    const harness = CommandHarnesses.conforming()
    const failing: CommandHarness = {
      ...harness,
      runtime: new PatchedRuntime(harness.runtime, {
        getInstanceDetail: () => Promise.reject(new RuntimeError("engineFailure", "boom")),
      }),
      writeVisibility: { withinMs: 60_000, wait: () => Promise.reject(new Error("waited")) },
    }
    const lossless = ConformanceKit.commandLaws().find(
      (conformanceCase) => conformanceCase.name === COMMAND_CASE.variableLossless,
    )
    await expect(lossless!.run(failing)).rejects.toMatchObject({ failure: "engineFailure" })
  })
})

describe("a move that starts its target but keeps its source", () => {
  test("fails only the skip law", async () => {
    const harness = CommandHarnesses.conforming()
    const skipped = harness.world.instanceIds["CMD-SKIP"]
    const kept = {
      kind: "asyncContinuation",
      instanceId: skipped,
      elementId: ElementId(WORLD_ELEMENT.chargePayment),
      retriesLeft: 0,
    } as const
    const keepsSource: CommandHarness = {
      ...harness,
      runtime: new PatchedRuntime(harness.runtime, {
        getInstanceDetail: async (instanceId) => {
          const detail = await harness.runtime.getInstanceDetail(instanceId)
          if (instanceId !== skipped || detail === undefined) {
            return detail
          }
          const moved = detail.waitStates.every((wait) => wait.elementId !== kept.elementId)
          return moved ? { ...detail, waitStates: [...detail.waitStates, kept] } : detail
        },
      }),
    }
    expect(await CommandHarnesses.failingCases(keepsSource)).toEqual([COMMAND_CASE.moveSkips])
  })
})

describe("the kind of a JSON value", () => {
  test.each([
    ['"text"', "string"],
    ["42", "integer"],
    ["-4.5e3", "decimal"],
    ["true", "boolean"],
    ["null", "null"],
    ['{"a":1}', "json"],
    ["[1]", "json"],
  ])("%s is %s", (valueJson, kind) => {
    expect(ValueKinds.ofJson(valueJson)).toBe(kind)
  })
})

describe("a retried fake incident", () => {
  test("leaves its wait state ready for another attempt and clears the incident flag", async () => {
    const harness = CommandHarnesses.conforming()
    const instanceId = harness.world.instanceIds["CMD-RETRY"]
    const [incident] = (await harness.runtime.searchIncidents({ instanceId }, { limit: 5 })).items
    await harness.commands.retryIncident(incident!.id)
    const detail = await harness.runtime.getInstanceDetail(instanceId)
    expect(detail?.instance.hasIncident).toBe(false)
    expect(detail?.waitStates).toEqual([
      expect.objectContaining({ kind: "asyncContinuation", retriesLeft: 1 }),
    ])
    expect(detail?.waitStates[0]).not.toHaveProperty("incidentId")
  })
})
