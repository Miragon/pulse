import type { CalledProcess, DefinitionId } from "../../contract/index.js"
import { BpmnStructure } from "../bpmn/bpmn-structure.js"
import { ElementNames } from "../bpmn/element-names.js"
import type { Notice } from "../protocol/index.js"
import { CallLinks } from "../views/call-links.js"
import type { CalledInstanceChoice, CallTarget } from "../views/call-targets.js"
import { Labels } from "../views/labels.js"
import type { InstanceChoice, OpenOptions, PanelContext } from "./panel-context.js"

export interface CallJump {
  readonly target: CallTarget | undefined
  readonly elementId: string
  readonly diagramXml: string
}

export class CallJumps {
  private shown: Notice | undefined

  constructor(
    private readonly context: PanelContext,
    private readonly republish: () => void,
  ) {}

  async calledProcessesOf(definitionId: DefinitionId): Promise<readonly CalledProcess[]> {
    const xml = await this.context.diagrams.get(definitionId)
    return BpmnStructure.hasCallActivities(xml)
      ? this.context.runtime.getCalledProcesses(definitionId)
      : []
  }

  notice(): Notice | undefined {
    return this.shown
  }

  forgetNotice(): void {
    this.shown = undefined
  }

  async open(jump: CallJump, options: OpenOptions): Promise<void> {
    const target = jump.target
    switch (target?.kind) {
      case "definition":
        this.context.effects.openDefinition(
          target.definition.bpmnProcessId,
          target.definition.id,
          options,
        )
        return
      case "missing":
        this.shown = {
          tone: "info",
          title: `${CallLinks.missingText(target.bpmnProcessId, this.context.engine.name)}.`,
          actions: [],
        }
        this.republish()
        return
      case "instances":
        await this.openCalledInstance(target.choices, jump, options)
        return
      default:
        return
    }
  }

  private async openCalledInstance(
    choices: readonly CalledInstanceChoice[],
    jump: CallJump,
    options: OpenOptions,
  ): Promise<void> {
    const [only] = choices
    if (choices.length === 1 && only !== undefined) {
      this.context.effects.openInstance(only.instance.id, options)
      return
    }
    const element = ElementNames.of(jump.diagramXml).get(jump.elementId) ?? jump.elementId
    const chosen = await this.context.effects.pickInstance(
      `${choices.length} instances called from ${element}`,
      choices.map((choice) => this.choiceOf(choice)),
    )
    if (chosen !== undefined) {
      this.context.effects.openInstance(chosen, options)
    }
  }

  private choiceOf({ instance, withIncident }: CalledInstanceChoice): InstanceChoice {
    const state = Labels.instanceState(instance.state)
    return {
      instanceId: instance.id,
      label: `${instance.bpmnProcessId} ${Labels.shortId(instance.id)}`,
      description: withIncident ? `${state} · with incident` : state,
    }
  }
}
