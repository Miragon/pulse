import {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  IncidentId,
  InstanceId,
  IsoTimestamp,
  type InstanceDetail,
  type InstanceState,
  type WaitState,
} from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { FlowNodes } from "../../src/core/bpmn/flow-nodes.js"
import type { MoveOption, WaitRow } from "../../src/core/protocol/index.js"
import { MoveOptions } from "../../src/core/views/move-options.js"
import type { EngineCli } from "../../src/ports/index.js"

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:collaboration id="Collaboration"><bpmn:participant id="Shop" processRef="moves" /></bpmn:collaboration>
  <bpmn:process id="moves" isExecutable="true">
    <!-- <bpmn:userTask id="Commented" name="Not here" /> -->
    <bpmn:startEvent id="Start" name="Order received"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="Review" name="Review order" />
    <bpmn:boundaryEvent id="Overdue" name="Overdue" attachedToRef="Review" />
    <bpmn:parallelGateway id="Fork" />
    <bpmn:userTask id="Pack" name="Pack" />
    <bpmn:serviceTask id="Charge" name="Charge payment"><bpmn:script><![CDATA[ <bpmn:userTask id="Hidden" /> ]]></bpmn:script></bpmn:serviceTask>
    <bpmn:parallelGateway id="Join" name="Both done" />
    <bpmn:callActivity id="Ship" name="Ship" />
    <bpmn:eventBasedGateway id="Wait" name="Answer?" />
    <bpmn:intermediateCatchEvent id="Answered" name="Answered" />
    <bpmn:intermediateCatchEvent id="Silence" name="Silence" />
    <bpmn:subProcess id="Check" name="Check">
      <bpmn:startEvent id="CheckStart" />
      <bpmn:userTask id="Inspect" name="Inspect" />
      <bpmn:userTask id="Weigh" name="Pack" />
      <bpmn:endEvent id="CheckEnd" />
    </bpmn:subProcess>
    <bpmn:userTask id="Remind" name="Remind">
      <bpmn:multiInstanceLoopCharacteristics isSequential="true" />
    </bpmn:userTask>
    <bpmn:endEvent id="End" name="Done" />
    <bpmn:subProcess id="Outer" name="Outer">
      <bpmn:subProcess id="Inner" name="Inner"><bpmn:userTask id="Deep" name="Deep" /></bpmn:subProcess>
    </bpmn:subProcess>
    <bpmn:subProcess id="Cancelled" triggeredByEvent="true">
      <bpmn:startEvent id="CancelledStart" />
      <bpmn:userTask id="Refund" name="Refund" />
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="f1" sourceRef="Start" targetRef="Review" />
    <bpmn:sequenceFlow id="f2" sourceRef="Review" targetRef="Fork" />
    <bpmn:sequenceFlow id="f3" sourceRef="Fork" targetRef="Pack" />
    <bpmn:sequenceFlow id="f4" sourceRef="Fork" targetRef="Charge" />
    <bpmn:sequenceFlow id="f5" sourceRef="Pack" targetRef="Join" />
    <bpmn:sequenceFlow id="f6" sourceRef="Charge" targetRef="Join" />
    <bpmn:sequenceFlow id="f7" sourceRef="Join" targetRef="Ship" />
    <bpmn:sequenceFlow id="f8" sourceRef="Ship" targetRef="Wait" />
    <bpmn:sequenceFlow id="f9" sourceRef="Wait" targetRef="Answered" />
    <bpmn:sequenceFlow id="f10" sourceRef="Wait" targetRef="Silence" />
    <bpmn:sequenceFlow id="f11" sourceRef="Answered" targetRef="Check" />
    <bpmn:sequenceFlow id="f12" sourceRef="Silence" targetRef="Remind" />
    <bpmn:sequenceFlow id="f13" sourceRef="Check" targetRef="End" />
    <bpmn:sequenceFlow id="f14" sourceRef="Remind" targetRef="End" />
    <bpmn:sequenceFlow id="f15" sourceRef="CheckStart" targetRef="Inspect" />
    <bpmn:sequenceFlow id="f16" sourceRef="Inspect" targetRef="Weigh" />
    <bpmn:sequenceFlow id="f17" sourceRef="Weigh" targetRef="CheckEnd" />
  </bpmn:process>
  <bpmn:process id="other"><bpmn:userTask id="Elsewhere" name="Elsewhere" /></bpmn:process>
</bpmn:definitions>`

const CONDITIONS = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="moves">
    <bpmn:eventBasedGateway id="Gate" name="Paid?" />
    <bpmn:intermediateCatchEvent id="Paid" name="Payment received"><bpmn:messageEventDefinition /></bpmn:intermediateCatchEvent>
    <bpmn:intermediateCatchEvent id="Approved" name="Approved">
      <bpmn:conditionalEventDefinition><bpmn:condition>approved</bpmn:condition></bpmn:conditionalEventDefinition>
    </bpmn:intermediateCatchEvent>
    <bpmn:intermediateCatchEvent id="Waived" name="Fee waived"><bpmn:conditionalEventDefinition /></bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="g1" sourceRef="Gate" targetRef="Paid" />
    <bpmn:sequenceFlow id="g2" sourceRef="Gate" targetRef="Approved" />
    <bpmn:sequenceFlow id="g3" sourceRef="Gate" targetRef="Waived" />
  </bpmn:process>
</bpmn:definitions>`

const EVENTS = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="moves">
    <bpmn:eventBasedGateway id="Returned" name="Parcel back?" />
    <bpmn:intermediateCatchEvent id="Parcel" name="Parcel received"><bpmn:messageEventDefinition /></bpmn:intermediateCatchEvent>
    <bpmn:receiveTask id="Pickup" name="Courier picks up" messageRef="PickedUp" />
    <bpmn:intermediateCatchEvent id="Recall" name="Product recall announced"><bpmn:signalEventDefinition /></bpmn:intermediateCatchEvent>
    <bpmn:intermediateCatchEvent id="Window" name="14 days"><bpmn:timerEventDefinition /></bpmn:intermediateCatchEvent>
    <bpmn:userTask id="Refund" name="Refund" />
    <bpmn:sequenceFlow id="r1" sourceRef="Returned" targetRef="Parcel" />
    <bpmn:sequenceFlow id="r2" sourceRef="Returned" targetRef="Pickup" />
    <bpmn:sequenceFlow id="r3" sourceRef="Returned" targetRef="Recall" />
    <bpmn:sequenceFlow id="r4" sourceRef="Returned" targetRef="Window" />
    <bpmn:sequenceFlow id="r5" sourceRef="Parcel" targetRef="Refund" />
  </bpmn:process>
</bpmn:definitions>`

const GATEWAY_REFUSAL =
  "The token waits at the gateway Answer? until one of the events after it occurs; Pulse does not move a token away from an event-based gateway."
const RETURNED_REFUSAL =
  "The token waits at the gateway Parcel back? until one of the events after it occurs; Pulse does not move a token away from an event-based gateway."
const PAID_REFUSAL =
  "The token waits at the gateway Paid? until one of the events after it occurs; Pulse does not move a token away from an event-based gateway. Change a variable on the Variables tab to meet the condition of Approved or Fee waived."

const INSTANCE = InstanceId("instance-1")
const SINCE = IsoTimestamp("2026-10-21T08:00:00Z")

type TokenKind = "userTask" | "asyncContinuation" | "message" | "signal" | "timer" | "other"

interface Token {
  readonly at: string
  readonly kind?: TokenKind
  readonly instanceId?: string
  readonly attachedTo?: string
  readonly incident?: boolean
}

function kindOf(kind: TokenKind = "userTask") {
  return kind === "other" ? { kind, description: "waits for something else" } : { kind }
}

function waitOf(token: Token): WaitState {
  return {
    ...kindOf(token.kind),
    instanceId: InstanceId(token.instanceId ?? INSTANCE),
    elementId: ElementId(token.at),
    ...(token.attachedTo === undefined ? {} : { attachedToElementId: ElementId(token.attachedTo) }),
    ...(token.incident === true ? { incidentId: IncidentId("incident-1") } : {}),
  }
}

function detailOf(
  tokens: readonly Token[],
  options: { runs?: readonly string[]; state?: InstanceState; truncated?: boolean } = {},
): InstanceDetail {
  return {
    instance: {
      id: INSTANCE,
      definition: {
        id: DefinitionId("moves:1"),
        bpmnProcessId: BpmnProcessId("moves"),
        version: 1,
      },
      state: options.state ?? "running",
      hasIncident: false,
    },
    path: (options.runs ?? []).map((elementId) => ({
      elementId: ElementId(elementId),
      startedAt: SINCE,
      canceled: false,
    })),
    waitStates: tokens.map(waitOf),
    incidents: [],
    calledInstances: [],
    variables: [],
    truncated: options.truncated ?? false,
  }
}

class RecordingCli implements EngineCli {
  readonly asked: { readonly detail: InstanceDetail; readonly waitState: WaitState }[] = []

  triggerCommand(detail: InstanceDetail, waitState: WaitState): string | undefined {
    this.asked.push({ detail, waitState })
    return waitState.kind === "other"
      ? undefined
      : `pulse advance ${waitState.instanceId} --activity-id ${waitState.elementId}`
  }
}

function movesOf(
  detail: InstanceDetail,
  xml = XML,
  cli?: EngineCli,
): { rows: WaitRow[]; moves: MoveOption[] } {
  const rows = detail.waitStates.map((waitState) => ({
    elementId: waitState.elementId,
    kindLabel: "User task",
  }))
  return new MoveOptions(detail, xml, cli).applied(rows)
}

function optionAt(tokens: readonly Token[], runs: readonly string[] = []): MoveOption {
  const option = movesOf(detailOf(tokens, { runs })).moves[0]
  if (option === undefined) {
    throw new Error("no move offered")
  }
  return option
}

function targetOf(option: MoveOption, elementId: string) {
  const target = option.targets.find((candidate) => candidate.elementId === elementId)
  if (target === undefined) {
    throw new Error(`${elementId} is not offered`)
  }
  return target
}

function refusalOf(option: MoveOption, elementId: string): string | undefined {
  return option.refused.find((candidate) => candidate.elementId === elementId)?.reason
}

describe("the flow nodes of a deployed diagram", () => {
  const nodes = FlowNodes.of(XML)

  test("ignore elements inside comments and script text", () => {
    expect(nodes.kindOf("Commented")).toBeUndefined()
    expect(nodes.kindOf("Hidden")).toBeUndefined()
    expect(nodes.kindOf("Charge")).toBe("serviceTask")
  })

  test("ignore an element inside a comment that a removed comment splits", () => {
    const split = FlowNodes.of(
      '<definitions><process id="p"><!<!-- inner -->-- <serviceTask id="Split"/> --><serviceTask id="Kept"/></process></definitions>',
    )
    expect(split.kindOf("Split")).toBeUndefined()
    expect(split.kindOf("Kept")).toBe("serviceTask")
  })

  test("know the scopes around an element, innermost first", () => {
    expect(nodes.scopesAround("Inspect")).toEqual(["Check", "moves"])
    expect(nodes.scopesAround("Elsewhere")).toEqual(["other"])
    expect(nodes.attachedTo("Overdue")).toBe("Review")
  })

  test("know multi-instance elements, event sub-processes and event-based gateways", () => {
    expect(nodes.isMultiInstance("Remind")).toBe(true)
    expect(nodes.isMultiInstance("Review")).toBe(false)
    expect(nodes.isInEventSubProcess("Refund")).toBe(true)
    expect(nodes.isInEventSubProcess("Inspect")).toBe(false)
    expect(nodes.eventGatewayBefore("Answered")).toBe("Wait")
    expect(nodes.eventGatewayBefore("Check")).toBeUndefined()
  })

  test("know the conditional events after an event-based gateway", () => {
    expect(nodes.conditionsAfter("Wait")).toEqual([])
    expect(nodes.conditionsAfter("End")).toEqual([])
    expect(FlowNodes.of(CONDITIONS).conditionsAfter("Gate")).toEqual(["Approved", "Waived"])
  })

  test("find the joins after an element, also when the path leaves a sub-process", () => {
    expect(nodes.joinsAfter("Review")).toEqual([])
    expect(nodes.joinsAfter("Pack")).toEqual(["Join"])
    expect(nodes.joinsAfter("Ship")).toEqual([])
    expect(nodes.reachesAlongBranch("Inspect", "End")).toBe(true)
    expect(nodes.reachesAlongBranch("Review", "Pack")).toBe(false)
  })
})

describe("the targets of a move", () => {
  const option = optionAt([{ at: "Review" }])

  test("offer the element itself, tasks, gateways and sub-processes of the same process", () => {
    expect(option.fromLabel).toBe("Review order")
    for (const elementId of [
      "Review",
      "Fork",
      "Pack",
      "Join",
      "Ship",
      "Wait",
      "Check",
      "Inspect",
    ]) {
      expect(targetOf(option, elementId).elementId).toBe(elementId)
    }
  })

  test.each([
    ["Start", "A start event begins a new path; pick the element after it."],
    ["CheckStart", "A start event begins a new path; pick the element after it."],
    ["Overdue", "A boundary event belongs to its task; pick the task instead."],
    ["End", "Moving the token to an end event can end the instance."],
    ["Answered", "This event waits behind Answer?; move the token to Answer? instead."],
    ["Remind", "Pulse does not start multi-instance elements."],
    ["Refund", "Pulse does not start event sub-processes."],
    ["Elsewhere", "This element belongs to another process."],
  ])("refuse %s", (elementId, reason) => {
    expect(refusalOf(option, elementId)).toBe(reason)
  })

  test("tell elements with the same name apart", () => {
    expect(targetOf(option, "Pack").label).toBe("Pack (Pack)")
    expect(targetOf(option, "Weigh").label).toBe("Pack (Weigh)")
  })

  test("refuse a target inside a sub-process that runs more than once", () => {
    const twice = optionAt([{ at: "Review" }], ["Check", "Check"])
    expect(refusalOf(twice, "Inspect")).toBe(
      "Check runs more than once; Pulse can't tell which one to use.",
    )
  })
})

describe("the effects and warnings of a move", () => {
  test("say what a re-run does", () => {
    const target = targetOf(optionAt([{ at: "Review" }]), "Review")
    expect(target.effects).toEqual([
      "Cancels Review order.",
      "Review order starts again, with its listeners and input mappings.",
    ])
    expect(target.warnings).toEqual([])
  })

  test("say that the incident closes", () => {
    const target = targetOf(optionAt([{ at: "Charge", incident: true }]), "Join")
    expect(target.effects[0]).toBe("Cancels Charge payment and closes its incident.")
  })

  test("leave a called instance out of the effects of a call activity that waits for its job", () => {
    const target = targetOf(optionAt([{ at: "Ship" }]), "Wait")
    expect(target.effects.join(" ")).not.toContain("called")
  })

  test("warn when the target leads into a join the token did not reach before", () => {
    const target = targetOf(optionAt([{ at: "Review" }]), "Pack")
    expect(target.warnings).toEqual([
      "The token reaches Both done, which may wait for its other paths.",
    ])
  })

  test("warn when the join no longer gets the token", () => {
    const target = targetOf(optionAt([{ at: "Charge" }, { at: "Pack" }]), "Ship")
    expect(target.warnings).toContain(
      "Both done no longer gets the token from Charge payment; its other paths wait there.",
    )
  })

  test("stay quiet about a join the branch keeps feeding when an earlier step runs again", () => {
    const branch = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="moves">
    <bpmn:parallelGateway id="F" /><bpmn:userTask id="A1" name="First" /><bpmn:userTask id="A2" name="Second" />
    <bpmn:userTask id="B" name="Other" /><bpmn:parallelGateway id="J" name="Both done" />
    <bpmn:sequenceFlow id="s1" sourceRef="F" targetRef="A1" /><bpmn:sequenceFlow id="s2" sourceRef="A1" targetRef="A2" />
    <bpmn:sequenceFlow id="s3" sourceRef="A2" targetRef="J" /><bpmn:sequenceFlow id="s4" sourceRef="F" targetRef="B" />
    <bpmn:sequenceFlow id="s5" sourceRef="B" targetRef="J" />
  </bpmn:process>
</bpmn:definitions>`
    const option = movesOf(detailOf([{ at: "A2" }, { at: "B" }]), branch).moves[0]!
    expect(targetOf(option, "A1").warnings).toEqual([])
  })

  test("stay quiet when the target lies before the fork that feeds every path", () => {
    expect(targetOf(optionAt([{ at: "Ship" }]), "Review").warnings).toEqual([])
    expect(targetOf(optionAt([{ at: "Ship" }]), "Fork").warnings).toEqual([])
  })

  test("end every sub-process the only token leaves", () => {
    const target = targetOf(optionAt([{ at: "Deep" }], ["Outer", "Inner", "Deep"]), "Ship")
    expect(target.effects).toEqual(
      expect.arrayContaining([
        "Ends Inner without completing it.",
        "Ends Outer without completing it.",
      ]),
    )
    expect(target.warnings).toEqual([])
  })

  test("stay quiet for a skip along the same branch", () => {
    expect(targetOf(optionAt([{ at: "Ship" }]), "Check").warnings).toEqual([])
    expect(targetOf(optionAt([{ at: "Inspect" }], ["Check"]), "Weigh").warnings).toEqual([])
  })

  test("warn when the target already holds a token", () => {
    const target = targetOf(optionAt([{ at: "Charge" }, { at: "Pack" }]), "Pack")
    expect(target.warnings).toContain("Pack (Pack) already holds a token; then it holds two.")
  })

  test("enter a sub-process without its start event", () => {
    const target = targetOf(optionAt([{ at: "Ship" }]), "Inspect")
    expect(target.effects).toContain("Enters Check without passing its start event.")
  })

  test("end a sub-process the last token leaves", () => {
    const target = targetOf(optionAt([{ at: "Inspect" }], ["Check"]), "Ship")
    expect(target.effects).toContain("Ends Check without completing it.")
    expect(target.warnings).toEqual([])
  })

  test("warn when other tokens stay behind in the sub-process", () => {
    const option = optionAt([{ at: "Inspect" }, { at: "Weigh" }], ["Check"])
    const target = targetOf(option, "Ship")
    expect(target.effects).not.toContain("Ends Check without completing it.")
    expect(target.warnings).toContain("Check keeps its other tokens; only this one leaves.")
  })
})

describe("the tokens that can be moved", () => {
  test.each([
    [
      [{ at: "Review", instanceId: "called-1" }],
      [],
      "Open the called instance to move this token.",
    ],
    [
      [{ at: "Overdue", attachedTo: "Review" }],
      [],
      "This event belongs to Review order; move the token at Review order instead.",
    ],
    [[{ at: "Pack" }, { at: "Pack" }], [], "2 tokens wait here; Pulse moves only a single one."],
    [[{ at: "Answered" }], [], GATEWAY_REFUSAL],
    [
      [{ at: "Remind" }],
      [],
      "This element runs as multi-instance; Pulse moves only single tokens.",
    ],
    [[{ at: "Refund" }], [], "Pulse does not move tokens inside an event sub-process."],
    [[{ at: "Check" }], [], "Move a token inside the sub-process instead."],
    [[{ at: "Unknown" }], [], "Pulse does not find this element in the deployed diagram."],
    [
      [{ at: "Inspect" }],
      ["Check", "Check"],
      "Check runs more than once; Pulse moves only unambiguous tokens.",
    ],
  ])("refuse %o with runs %o", (tokens, runs, reason) => {
    const { rows, moves } = movesOf(detailOf(tokens, { runs }))
    expect(rows[0]).toMatchObject({ moveRefusal: reason })
    expect(rows[0]).not.toHaveProperty("cliCommand")
    expect(moves).toEqual([])
  })

  test("name the variables as the way on when a condition waits behind the gateway, and the CLI for the message beside it", () => {
    const { rows, moves } = movesOf(
      detailOf([
        { at: "Paid", kind: "message" },
        { at: "Approved", kind: "other" },
        { at: "Waived", kind: "other" },
      ]),
      CONDITIONS,
      new RecordingCli(),
    )
    expect(rows.map((row) => row.moveRefusal)).toEqual([
      `${PAID_REFUSAL} Trigger Payment received with the CLI: pulse advance instance-1 --activity-id Paid`,
      PAID_REFUSAL,
      PAID_REFUSAL,
    ])
    expect(rows.map((row) => row.cliCommand)).toEqual([
      "pulse advance instance-1 --activity-id Paid",
      undefined,
      undefined,
    ])
    expect(rows[1]).not.toHaveProperty("cliCommand")
    expect(moves).toEqual([])
  })

  test("count the open runs of an element as tokens", () => {
    const { rows } = movesOf(
      detailOf([{ at: "Inspect" }], { runs: ["Check", "Inspect", "Inspect"] }),
    )
    expect(rows[0]?.moveRefusal).toBe("2 tokens wait here; Pulse moves only a single one.")
  })

  test("offer a move for a single own token", () => {
    const { rows, moves } = movesOf(detailOf([{ at: "Review" }]))
    expect(rows[0]).toEqual({ elementId: "Review", kindLabel: "User task" })
    expect(moves.map((move) => move.fromElementId)).toEqual(["Review"])
  })

  test("refuse every token of a truncated instance", () => {
    const { rows } = movesOf(detailOf([{ at: "Review" }], { truncated: true }))
    expect(rows[0]).toEqual({
      elementId: "Review",
      kindLabel: "User task",
      moveRefusal: "Pulse sees only part of this instance; moving a token needs all of it.",
    })
  })

  test.each(["suspended", "completed"] as const)("offer nothing in a %s instance", (state) => {
    const { rows, moves } = movesOf(detailOf([{ at: "Review" }], { state }))
    expect(rows[0]).toEqual({ elementId: "Review", kindLabel: "User task" })
    expect(moves).toEqual([])
  })
})

describe("the way on from an event-based gateway", () => {
  function rowAt(token: Token, cli?: EngineCli): WaitRow | undefined {
    const { rows, moves } = movesOf(detailOf([token]), EVENTS, cli)
    expect(moves).toEqual([])
    return rows[0]
  }

  function refusalAt(token: Token, cli?: EngineCli): string | undefined {
    return rowAt(token, cli)?.moveRefusal
  }

  test.each([
    ["message catch event", { at: "Parcel", kind: "message" }, "Parcel received"],
    ["receive task waiting for its message", { at: "Pickup", kind: "message" }, "Courier picks up"],
    ["signal catch event", { at: "Recall", kind: "signal" }, "Product recall announced"],
    ["timer catch event", { at: "Window", kind: "timer" }, "14 days"],
  ] as const)("names the CLI command the engine's adapter gives for a %s", (_, token, label) => {
    const cli = new RecordingCli()
    const command = `pulse advance instance-1 --activity-id ${token.at}`
    expect(rowAt(token, cli)).toMatchObject({
      moveRefusal: `${RETURNED_REFUSAL} Trigger ${label} with the CLI: ${command}`,
      cliCommand: command,
    })
    expect(cli.asked.map(({ detail, waitState }) => [detail.instance.id, waitState])).toEqual([
      ["instance-1", expect.objectContaining({ elementId: token.at, kind: token.kind })],
    ])
  })

  test("names no command when the adapter has none for the row or the engine no CLI", () => {
    const withoutCommand = rowAt({ at: "Pickup", kind: "other" }, new RecordingCli())
    const withoutCli = rowAt({ at: "Parcel", kind: "message" })
    for (const row of [withoutCommand, withoutCli]) {
      expect(row?.moveRefusal).toBe(RETURNED_REFUSAL)
      expect(row).not.toHaveProperty("cliCommand")
    }
  })

  test("keeps the called instance's refusal for a token behind a gateway of another instance", () => {
    const cli = new RecordingCli()
    expect(refusalAt({ at: "Parcel", kind: "message", instanceId: "called-1" }, cli)).toBe(
      "Open the called instance to move this token.",
    )
    expect(cli.asked).toEqual([])
  })

  test("asks the CLI for no other refusal", () => {
    const cli = new RecordingCli()
    const { rows } = movesOf(detailOf([{ at: "Pack" }, { at: "Pack" }]), XML, cli)
    expect(rows[0]?.moveRefusal).toBe("2 tokens wait here; Pulse moves only a single one.")
    expect(rows[0]).not.toHaveProperty("cliCommand")
    expect(cli.asked).toEqual([])
  })

  test("moves a token past its event, at the continuation after the event", () => {
    const cli = new RecordingCli()
    const { rows, moves } = movesOf(
      detailOf([{ at: "Parcel", kind: "asyncContinuation" }]),
      EVENTS,
      cli,
    )
    expect(rows[0]).not.toHaveProperty("moveRefusal")
    expect(moves.map((move) => move.fromElementId)).toEqual(["Parcel"])
    expect(cli.asked).toEqual([])
  })
})
