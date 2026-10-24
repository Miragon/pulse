import type { IncidentId } from "../../model/ids.js"
import type { Variable } from "../../model/read-models.js"
import { Ensure } from "../ensure.js"
import {
  COMMAND_CASE,
  type CommandConformanceCase,
  type CommandHarness,
} from "../command-harness.js"
import type { CommandInstanceAlias } from "../world/world.js"

const PAGE = { limit: 50 } as const
const BEYOND_DOUBLE_PRECISION = "9007199254740993"
const ADDRESS = '{"city":"Munich","zip":"80331"}'

class CommandSteps {
  static async openIncidents(
    harness: CommandHarness,
    alias: CommandInstanceAlias,
  ): Promise<IncidentId[]> {
    const page = await harness.runtime.searchIncidents(
      { instanceId: harness.world.instanceIds[alias] },
      PAGE,
    )
    return page.items.map((incident) => incident.id)
  }

  static async onlyIncidentOf(
    harness: CommandHarness,
    alias: CommandInstanceAlias,
    law: string,
  ): Promise<IncidentId> {
    const [first, ...more] = await CommandSteps.openIncidents(harness, alias)
    Ensure.that(more.length === 0, law, `${alias} has ${more.length + 1} open incidents`)
    return Ensure.defined(first, law, `${alias} has no open incident`)
  }

  static async variableOf(harness: CommandHarness, name: string, law: string): Promise<Variable> {
    const detail = await harness.runtime.getInstanceDetail(harness.world.instanceIds["CMD-EDIT"])
    const variable = Ensure.defined(detail, law, "no detail for CMD-EDIT").variables.find(
      (candidate) => candidate.name === name && candidate.scope.kind === "instance",
    )
    return Ensure.defined(variable, law, `CMD-EDIT has no variable ${name}`)
  }

  static async change(harness: CommandHarness, name: string, valueJson: string): Promise<void> {
    const before = await CommandSteps.variableOf(harness, name, "change").catch(() => undefined)
    await harness.commands.setVariable(harness.world.instanceIds["CMD-EDIT"], {
      name,
      valueJson,
      ...(before?.type === undefined ? {} : { type: before.type }),
    })
  }

  static sameJson(left: string, right: string): boolean {
    return JSON.stringify(JSON.parse(left)) === JSON.stringify(JSON.parse(right))
  }
}

const retryClosesIncident: CommandConformanceCase = {
  name: COMMAND_CASE.retryClosesIncident,
  async run(harness) {
    const retried = await CommandSteps.onlyIncidentOf(harness, "CMD-RETRY", this.name)
    const kept = await CommandSteps.onlyIncidentOf(harness, "CMD-KEEP", this.name)
    await harness.commands.retryIncident(retried)
    await Ensure.eventually(async () => {
      const stillOpen = await CommandSteps.openIncidents(harness, "CMD-RETRY")
      Ensure.that(!stillOpen.includes(retried), this.name, "the retried incident is still open")
      const others = await CommandSteps.openIncidents(harness, "CMD-KEEP")
      Ensure.that(
        others.includes(kept),
        this.name,
        "the incident of another instance was closed too",
      )
    }, harness.writeVisibility)
  },
}

const retryRejected: CommandConformanceCase = {
  name: COMMAND_CASE.retryRejected,
  async run(harness) {
    await Ensure.rejected(
      harness.commands.retryIncident(harness.world.unknown.incidentId),
      this.name,
      "an unknown incident",
    )
    const incident = await CommandSteps.onlyIncidentOf(harness, "CMD-TWICE", this.name)
    await harness.commands.retryIncident(incident)
    await Ensure.rejected(
      harness.commands.retryIncident(incident),
      this.name,
      "an incident retried before",
    )
  },
}

const variableReadsBack: CommandConformanceCase = {
  name: COMMAND_CASE.variableReadsBack,
  async run(harness) {
    const amountBefore = await CommandSteps.variableOf(harness, "amount", this.name)
    await CommandSteps.change(harness, "note", '"second"')
    await CommandSteps.change(harness, "amount", "43")
    await Ensure.eventually(async () => {
      const note = await CommandSteps.variableOf(harness, "note", this.name)
      const amount = await CommandSteps.variableOf(harness, "amount", this.name)
      Ensure.that(
        note.valueJson === '"second"' && note.kind === "string",
        this.name,
        `note reads ${Ensure.describe(note)}`,
      )
      Ensure.that(
        amount.valueJson === "43" && amount.kind === "integer" && amount.type === amountBefore.type,
        this.name,
        `amount reads ${Ensure.describe(amount)}, was ${Ensure.describe(amountBefore)}`,
      )
    }, harness.writeVisibility)
  },
}

const variableLossless: CommandConformanceCase = {
  name: COMMAND_CASE.variableLossless,
  async run(harness) {
    await CommandSteps.change(harness, "ledger", BEYOND_DOUBLE_PRECISION)
    await CommandSteps.change(harness, "address", ADDRESS)
    await Ensure.eventually(async () => {
      const ledger = await CommandSteps.variableOf(harness, "ledger", this.name)
      const address = await CommandSteps.variableOf(harness, "address", this.name)
      Ensure.that(
        ledger.valueJson === BEYOND_DOUBLE_PRECISION && ledger.kind === "integer",
        this.name,
        `ledger reads ${Ensure.describe(ledger)}`,
      )
      Ensure.that(
        CommandSteps.sameJson(address.valueJson, ADDRESS) && address.kind === "json",
        this.name,
        `address reads ${Ensure.describe(address)}`,
      )
    }, harness.writeVisibility)
  },
}

const variableRejected: CommandConformanceCase = {
  name: COMMAND_CASE.variableRejected,
  async run(harness) {
    const change = { name: "note", valueJson: '"late"' }
    await Ensure.rejected(
      harness.commands.setVariable(harness.world.unknown.instanceId, change),
      this.name,
      "an unknown instance",
    )
    await Ensure.rejected(
      harness.commands.setVariable(harness.world.instanceIds["CMD-ENDED"], change),
      this.name,
      "an ended instance",
    )
  },
}

export const COMMAND_LAWS: readonly CommandConformanceCase[] = [
  retryClosesIncident,
  retryRejected,
  variableReadsBack,
  variableLossless,
  variableRejected,
]
