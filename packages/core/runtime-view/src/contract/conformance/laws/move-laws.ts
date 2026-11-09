import { ElementId } from "../../model/ids.js"
import type { InstanceDetail, WaitState } from "../../model/read-models.js"
import type { TokenMove } from "../../ports/process-commands.js"
import { Ensure } from "../ensure.js"
import {
  COMMAND_CASE,
  type CommandConformanceCase,
  type CommandHarness,
} from "../command-harness.js"
import { WORLD_ELEMENT, WORLD_SECOND_TOKEN, type CommandInstanceAlias } from "../world/world.js"

const REASON = "Charged by hand after the outage"
const REVIEW_ORDER = ElementId(WORLD_ELEMENT.reviewOrder)
const CHARGE_PAYMENT = ElementId(WORLD_ELEMENT.chargePayment)

class MoveSteps {
  static async detailOf(
    harness: CommandHarness,
    alias: CommandInstanceAlias,
    law: string,
  ): Promise<InstanceDetail> {
    const detail = await harness.runtime.getInstanceDetail(harness.world.instanceIds[alias])
    return Ensure.defined(detail, law, `no detail for ${alias}`)
  }

  static ownWaits(detail: InstanceDetail): string[] {
    return detail.waitStates
      .filter((waitState: WaitState) => waitState.instanceId === detail.instance.id)
      .map((waitState) => waitState.elementId)
  }

  static move(fromElementId: ElementId, toElementId: ElementId, reason = REASON): TokenMove {
    return { fromElementId, toElementId, reason }
  }

  static async waitsExactly(
    harness: CommandHarness,
    alias: CommandInstanceAlias,
    expected: readonly string[],
    law: string,
  ): Promise<InstanceDetail> {
    const detail = await MoveSteps.detailOf(harness, alias, law)
    Ensure.that(detail.instance.state === "running", law, `${alias} is ${detail.instance.state}`)
    Ensure.sameSet(MoveSteps.ownWaits(detail), expected, law)
    return detail
  }
}

const moveSkips: CommandConformanceCase = {
  name: COMMAND_CASE.moveSkips,
  async run(harness) {
    await MoveSteps.waitsExactly(harness, "CMD-SKIP", [CHARGE_PAYMENT], this.name)
    await harness.commands.moveToken(
      harness.world.instanceIds["CMD-SKIP"],
      MoveSteps.move(CHARGE_PAYMENT, REVIEW_ORDER),
    )
    await Ensure.eventually(async () => {
      const detail = await MoveSteps.waitsExactly(harness, "CMD-SKIP", [REVIEW_ORDER], this.name)
      const stillOpen = detail.incidents.filter((incident) => incident.elementId === CHARGE_PAYMENT)
      Ensure.that(stillOpen.length === 0, this.name, "the incident at the source is still open")
    }, harness.writeVisibility)
  },
}

const moveReruns: CommandConformanceCase = {
  name: COMMAND_CASE.moveReruns,
  async run(harness) {
    await MoveSteps.waitsExactly(harness, "CMD-RERUN", [REVIEW_ORDER], this.name)
    await harness.commands.moveToken(
      harness.world.instanceIds["CMD-RERUN"],
      MoveSteps.move(REVIEW_ORDER, REVIEW_ORDER),
    )
    await Ensure.eventually(async () => {
      const detail = await MoveSteps.waitsExactly(harness, "CMD-RERUN", [REVIEW_ORDER], this.name)
      const runs = detail.path.filter((run) => run.elementId === REVIEW_ORDER)
      const open = runs.filter((run) => run.endedAt === undefined)
      Ensure.that(open.length === 1, this.name, `${open.length} open runs of the element`)
      Ensure.that(
        runs.some((run) => run.canceled),
        this.name,
        "the old run of the element was not canceled",
      )
    }, harness.writeVisibility)
  },
}

const moveRejected: CommandConformanceCase = {
  name: COMMAND_CASE.moveRejected,
  async run(harness) {
    const twin = harness.world.instanceIds[WORLD_SECOND_TOKEN.instance]
    const twinTokens = [REVIEW_ORDER, REVIEW_ORDER]
    await MoveSteps.waitsExactly(harness, WORLD_SECOND_TOKEN.instance, twinTokens, this.name)
    const rerun = MoveSteps.move(REVIEW_ORDER, REVIEW_ORDER)
    const attempts = [
      [harness.world.unknown.instanceId, rerun, "an unknown instance"],
      [harness.world.instanceIds["CMD-ENDED"], rerun, "an ended instance"],
      [
        harness.world.instanceIds["CMD-EDIT"],
        MoveSteps.move(REVIEW_ORDER, REVIEW_ORDER, "  "),
        "a blank reason",
      ],
      [twin, MoveSteps.move(CHARGE_PAYMENT, REVIEW_ORDER), "an element without a token"],
      [twin, rerun, "an element with several tokens"],
    ] as const
    for (const [instanceId, move, what] of attempts) {
      await Ensure.rejected(harness.commands.moveToken(instanceId, move), this.name, what)
    }
    await MoveSteps.waitsExactly(harness, WORLD_SECOND_TOKEN.instance, twinTokens, this.name)
  },
}

export const MOVE_LAWS: readonly CommandConformanceCase[] = [moveSkips, moveReruns, moveRejected]
