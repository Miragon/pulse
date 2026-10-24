import type { InstanceDetail, WaitState } from "../../contract/index.js"
import { FlowNodes } from "../bpmn/flow-nodes.js"
import type { MoveOption, WaitRow } from "../protocol/index.js"
import { ActiveTokens } from "./active-tokens.js"
import { ElementLabels } from "./element-labels.js"
import { MoveSources } from "./move-sources.js"
import { MoveTargets } from "./move-targets.js"

const TRUNCATED = "Pulse sees only part of this instance; moving a token needs all of it."

export interface MovableWaits {
  readonly rows: WaitRow[]
  readonly moves: MoveOption[]
}

export class MoveOptions {
  private readonly labels: ElementLabels
  private readonly sources: MoveSources
  private readonly targets: MoveTargets

  constructor(
    private readonly detail: InstanceDetail,
    diagramXml: string,
  ) {
    const nodes = FlowNodes.of(diagramXml)
    const tokens = new ActiveTokens(detail)
    this.labels = new ElementLabels(diagramXml)
    this.sources = new MoveSources(nodes, tokens, this.labels)
    this.targets = new MoveTargets(nodes, tokens, this.labels)
  }

  applied(rows: readonly WaitRow[]): MovableWaits {
    if (this.detail.instance.state !== "running") {
      return { rows: [...rows], moves: [] }
    }
    const moves: MoveOption[] = []
    const marked = rows.map((row, index) => {
      const waitState = this.detail.waitStates[index]
      const refusal = waitState === undefined ? undefined : this.refusalOf(waitState)
      if (refusal !== undefined) {
        return { ...row, moveRefusal: refusal }
      }
      moves.push(this.optionFor(row.elementId, waitState?.incidentId !== undefined))
      return row
    })
    return { rows: marked, moves }
  }

  private refusalOf(waitState: WaitState): string | undefined {
    return this.detail.truncated
      ? TRUNCATED
      : this.sources.refusalOf(waitState, this.detail.instance.id)
  }

  private optionFor(fromElementId: string, closesIncident: boolean): MoveOption {
    return {
      fromElementId,
      fromLabel: this.labels.of(fromElementId),
      ...this.targets.from(fromElementId, closesIncident),
    }
  }
}
