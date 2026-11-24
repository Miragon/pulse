import { BpmnProcessId, DefinitionId, type MigrationPlan } from "@miragon/pulse-engine-core"
import { MigrationPlanText, type MigrationPlanDefinition } from "@miragon/pulse-migration-plan"
import { MigrationChecks, type CheckOutcome } from "../panels/migration-checks.js"
import type { PanelContext } from "../panels/panel-context.js"
import type { Panel } from "../panels/panel.js"
import { ViewSession } from "../panels/view-session.js"
import type { MigrationPlanView, WebviewIntent } from "../protocol/index.js"
import type { PlanContext, PlanSource } from "./plan-context.js"
import { PlanEdits } from "./plan-edits.js"
import { PlanIntents } from "./plan-intents.js"
import { PlanReads, type PlanLoaded } from "./plan-reads.js"

export class MigrationPlanPanel implements Panel {
  private readonly session: ViewSession<MigrationPlanView, PlanLoaded>
  private readonly checks: MigrationChecks
  private focusing: string | undefined

  constructor(private readonly context: PlanContext) {
    this.session = new ViewSession(context, context.source.fileName)
    this.checks = new MigrationChecks(context, (plan, outcome) => {
      this.checked(plan, outcome)
    })
  }

  static over(context: PanelContext, source: PlanSource): MigrationPlanPanel {
    const { effects } = context
    return new MigrationPlanPanel({
      source,
      runtime: context.runtime,
      diagrams: context.diagrams,
      engine: context.engine,
      publish: context.publish,
      now: context.now,
      wait: context.wait,
      navigation: {
        openDefinition: (bpmnProcessId, definitionId, options) => {
          effects.openDefinition(bpmnProcessId, definitionId, options)
        },
        openFile: () => {
          effects.openSource(source.location)
        },
        goBack: () => {
          effects.goBack()
        },
        copy: (text, label) => {
          effects.copyToClipboard(text, label)
        },
        editConnection: () => {
          effects.editConnection()
        },
        setCredentials: () => {
          effects.setCredentials()
        },
      },
    })
  }

  async handle(intent: WebviewIntent): Promise<void> {
    switch (intent.type) {
      case "ready":
        await this.session.resume(() => PlanReads.load(this.context))
        return
      case "refresh":
        await this.reload()
        return
      case "focusMapping":
        this.focus(intent.sourceElementId)
        return
      case "mapElement":
        await this.edit(
          (state) => PlanEdits.mapped(state, intent.sourceElementId, intent.targetElementId),
          intent.sourceElementId,
        )
        return
      case "unmapElement":
        await this.edit(
          (state) => PlanEdits.unmapped(state, intent.sourceElementId),
          intent.sourceElementId,
        )
        return
      default:
        this.forward(intent)
    }
  }

  async changed(): Promise<void> {
    const loaded = this.session.current()
    const revised =
      loaded === undefined || this.session.showsProblem()
        ? undefined
        : await PlanReads.revised(this.context, loaded)
    if (revised === "unchanged") {
      return
    }
    if (revised === undefined) {
      await this.reload()
      return
    }
    const focused = this.focusing ?? revised.focused
    this.focusing = undefined
    const shown = PlanReads.snapshot({ ...revised, focused }, this.context.engine)
    this.session.rebuild(() => shown)
    this.checks.schedule({
      sourceDefinitionId: shown.source.id,
      targetDefinitionId: shown.target.id,
      mappings: shown.mappings,
    })
  }

  attend(): void {
    return undefined
  }

  nudge(): void {
    return undefined
  }

  dispose(): void {
    this.checks.cancel()
    this.session.close()
  }

  private forward(intent: WebviewIntent): void {
    switch (intent.type) {
      case "openDefinition":
        this.openDefinition(intent.bpmnProcessId, intent.definitionId)
        return
      case "openPlanFile":
        this.context.navigation.openFile()
        return
      default:
        PlanIntents.forward(this.context.navigation, intent)
    }
  }

  private async reload(): Promise<void> {
    this.checks.cancel()
    await this.session.reload(() => PlanReads.load(this.context))
  }

  private async edit(
    change: (loaded: PlanLoaded) => MigrationPlanDefinition | undefined,
    focused: string,
  ): Promise<void> {
    const loaded = this.session.current()
    const plan = loaded === undefined || this.session.showsProblem() ? undefined : change(loaded)
    if (plan === undefined) {
      return
    }
    const text = MigrationPlanPanel.textOf(plan)
    this.focusing = focused
    if (text !== undefined && (await this.context.source.write(text))) {
      await this.changed()
      return
    }
    this.focusing = undefined
    this.session.republish()
  }

  private static textOf(plan: MigrationPlanDefinition): string | undefined {
    try {
      return MigrationPlanText.of(plan)
    } catch {
      return undefined
    }
  }

  private checked(plan: MigrationPlan, outcome: CheckOutcome): void {
    this.session.rebuild((loaded) =>
      loaded.mappings !== plan.mappings
        ? loaded
        : PlanReads.snapshot(
            outcome.kind === "checked"
              ? { ...loaded, checking: false, problems: outcome.check.problems }
              : { ...loaded, checking: false, checkFailure: outcome.message },
            this.context.engine,
          ),
    )
  }

  private focus(sourceElementId: string): void {
    const shown = this.session.current()?.view.rows
    if (shown?.some((row) => row.sourceElementId === sourceElementId) === true) {
      this.session.rebuild((loaded) =>
        PlanReads.snapshot({ ...loaded, focused: sourceElementId }, this.context.engine),
      )
    }
  }

  private openDefinition(bpmnProcessId: string, definitionId: string): void {
    const view = this.session.current()?.view
    const shown = [view?.source.definitionId, view?.target.definitionId]
    if (view?.bpmnProcessId === bpmnProcessId && shown.includes(definitionId)) {
      this.context.navigation.openDefinition(
        BpmnProcessId(bpmnProcessId),
        DefinitionId(definitionId),
        { toSide: false },
      )
    }
  }
}
