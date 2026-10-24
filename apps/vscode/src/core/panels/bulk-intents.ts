import { InstanceId, type BpmnProcessId } from "../../contract/index.js"
import type { DefinitionView, OfferedBulkKind, WebviewIntent } from "../protocol/index.js"
import type { Attention } from "../refresh/live-context.js"
import { BulkDecoration } from "../views/bulk-decoration.js"
import type { OfferedBulkAction } from "./bulk-action.js"
import { BulkFollow, type FollowHost } from "./bulk-follow.js"
import { BulkRunControl } from "./bulk-run-control.js"
import { BULK_CAP, BulkSelection } from "./bulk-selection.js"
import { BulkWrite } from "./bulk-write.js"
import { CancelInstancesAction } from "./cancel-instances-action.js"
import type { DefinitionLoaded } from "./definition-reads.js"
import { InstanceListQuery } from "./instance-list-query.js"
import type { PanelContext } from "./panel-context.js"
import { Problems } from "./problems.js"
import { SelectionPreview } from "./selection-preview.js"

type BulkIntent = Extract<
  WebviewIntent,
  {
    readonly type:
      | "toggleInstances"
      | "selectMatching"
      | "clearSelection"
      | "startBulk"
      | "stopBulk"
      | "dismissBulk"
      | "checkBulk"
      | "selectRemaining"
      | "showBulkFailures"
      | "openMigration"
  }
>

const BULK_INTENTS: ReadonlySet<WebviewIntent["type"]> = new Set([
  "toggleInstances",
  "selectMatching",
  "clearSelection",
  "startBulk",
  "stopBulk",
  "dismissBulk",
  "checkBulk",
  "selectRemaining",
  "showBulkFailures",
  "openMigration",
])

const CANCEL = new CancelInstancesAction()
const ACTIONS: Readonly<Record<OfferedBulkKind, OfferedBulkAction>> = { cancelInstances: CANCEL }
const OFFERED: readonly [OfferedBulkAction, ...OfferedBulkAction[]] = [CANCEL]

export interface BulkHost extends FollowHost {
  current(): DefinitionLoaded | undefined
}

export class BulkIntents {
  private readonly selection = new BulkSelection()
  private readonly write: BulkWrite
  private readonly follow: BulkFollow
  private readonly control: BulkRunControl
  private readonly decoration = new BulkDecoration(OFFERED)
  private readonly query: InstanceListQuery
  private readonly retry: () => void
  private disposed = false

  constructor(
    private readonly context: PanelContext,
    private readonly bpmnProcessId: BpmnProcessId,
    private readonly host: BulkHost,
  ) {
    this.follow = new BulkFollow(context, host)
    this.control = new BulkRunControl(context, bpmnProcessId, {
      runs: context.bulkRuns,
      follow: this.follow,
      selection: this.selection,
      republish: () => {
        host.republish()
      },
    })
    const preview = new SelectionPreview(context)
    this.write = new BulkWrite(context, context.bulkRuns, {
      bpmnProcessId,
      prepare: async (action, ids) => {
        const loaded = host.current()
        return loaded === undefined ? undefined : preview.prepared(loaded, action, ids)
      },
      registered: () => {
        this.selection.clear()
        host.republish()
      },
    })
    this.query = new InstanceListQuery(context.runtime)
    this.retry = () => {
      this.resume()
    }
  }

  static handles(intent: WebviewIntent): intent is BulkIntent {
    return BULK_INTENTS.has(intent.type)
  }

  async handle(intent: BulkIntent): Promise<void> {
    switch (intent.type) {
      case "stopBulk":
        await this.control.stop()
        break
      case "dismissBulk":
        this.control.dismiss()
        break
      case "checkBulk":
        await this.control.check()
        break
      case "selectRemaining":
        await this.control.selectRemaining()
        break
      case "showBulkFailures":
        await this.control.showFailures()
        break
      case "openMigration":
        this.openMigration()
        break
      case "clearSelection":
        this.selection.clear()
        break
      default:
        await this.select(intent)
    }
    this.host.republish()
  }

  resume(): void {
    const run = this.control.run()
    if (this.disposed) {
      return
    }
    if (run?.isActive() === true) {
      this.follow.follow(run)
    } else {
      this.context.bulkRuns.whenStarted(this.bpmnProcessId, this.retry)
    }
  }

  clearSelection(): void {
    this.selection.clear()
  }

  isBusy(): boolean {
    return this.write.isBusy()
  }

  attend(attention: Attention): void {
    this.follow.attend(attention)
    if (attention === "watched") {
      this.resume()
    }
  }

  dispose(): void {
    this.disposed = true
    this.write.close()
    this.follow.dispose()
  }

  decorate(view: DefinitionView): DefinitionView {
    const loaded = this.host.current()
    return this.decoration.decorate(view, {
      run: this.control.run(),
      selection: this.selection,
      instances: loaded?.instances ?? [],
      migrates: loaded !== undefined && this.migrates(loaded),
      scene: {
        now: this.context.now().getTime(),
        environment: this.context.engine.environment,
        canWrite: this.context.commands !== undefined,
      },
    })
  }

  private async select(
    intent: Extract<
      BulkIntent,
      { readonly type: "toggleInstances" | "selectMatching" | "startBulk" }
    >,
  ): Promise<void> {
    const loaded = this.host.current()
    if (
      loaded === undefined ||
      !BulkDecoration.selects(loaded, this.context.commands !== undefined)
    ) {
      return
    }
    switch (intent.type) {
      case "toggleInstances":
        this.toggle(loaded, intent.ids, intent.selected)
        return
      case "selectMatching":
        return this.selectMatching(loaded)
      case "startBulk":
        return this.start(intent.action)
    }
  }

  private toggle(loaded: DefinitionLoaded, ids: readonly string[], selected: boolean): void {
    const eligible = new Set(
      loaded.instances
        .filter((instance) => OFFERED.some((action) => action.eligible(instance)))
        .map((instance) => instance.id),
    )
    this.selection.toggle(
      ids.map((id) => InstanceId(id)).filter((id) => eligible.has(id)),
      selected,
    )
  }

  private async selectMatching(loaded: DefinitionLoaded): Promise<void> {
    const [selecting] = OFFERED
    const matching = selecting.matching(loaded.filter, loaded.scopeCounts)
    if (matching > BULK_CAP) {
      this.selection.refuse(matching)
      return
    }
    try {
      const ids = await this.query.idsMatching(
        loaded.selected,
        loaded.filter,
        (filter) => selecting.eligibleFilter(filter),
        BULK_CAP,
      )
      if (ids.length > BULK_CAP) {
        this.selection.refuse(ids.length)
      } else {
        this.selection.selectAll(ids)
      }
    } catch (error) {
      this.context.effects.reportProblem(Problems.of(error, this.context.engine))
    }
  }

  private openMigration(): void {
    const loaded = this.host.current()
    const instanceIds = this.selection.selected()
    if (loaded === undefined || instanceIds.length === 0 || !this.migrates(loaded)) {
      return
    }
    this.context.effects.openMigration({
      bpmnProcessId: this.bpmnProcessId,
      sourceDefinitionId: loaded.selected,
      instanceIds,
    })
    this.selection.clear()
  }

  private migrates(loaded: DefinitionLoaded): boolean {
    const canWrite = this.context.commands !== undefined
    return BulkDecoration.selects(loaded.view, canWrite) && loaded.versions.length > 1
  }

  private async start(kind: OfferedBulkKind): Promise<void> {
    const run = await this.write.start(ACTIONS[kind], this.selection.selected())
    if (run?.phase === "failed") {
      this.selection.clear()
      this.selection.toggle(run.plan.ids, true)
    } else if (run !== undefined) {
      this.follow.follow(run)
    }
  }
}
