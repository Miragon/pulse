import { DefinitionId, type BpmnProcessId } from "../../contract/index.js"
import { DriftCheck } from "../drift/drift-check.js"
import { ModelDrift, type LocalModel } from "../drift/model-drift.js"
import type { DefinitionView, InstanceListFilter, WebviewIntent } from "../protocol/index.js"
import type { Attention } from "../refresh/live-context.js"
import { PanelLive } from "../refresh/panel-live.js"
import { BulkIntents } from "./bulk-intents.js"
import { CallJumps } from "./call-jumps.js"
import { CommonIntents } from "./common-intents.js"
import { DefinitionLinks } from "./definition-links.js"
import {
  DefinitionReads,
  type DefinitionLoaded,
  type DefinitionRequest,
} from "./definition-reads.js"
import { ModelLinks } from "./model-links.js"
import type { Panel } from "./panel.js"
import type { PanelContext } from "./panel-context.js"
import { ViewSession } from "./view-session.js"

export interface DefinitionTarget {
  readonly bpmnProcessId: BpmnProcessId
  readonly definitionId?: DefinitionId
  readonly filter?: InstanceListFilter
  readonly localModel?: LocalModel
}

const RUNNING: InstanceListFilter = { scope: "running" }

export class DefinitionPanel implements Panel {
  private request: DefinitionRequest
  private readonly session: ViewSession<DefinitionView, DefinitionLoaded>
  private readonly drift: DriftCheck
  private readonly reads: DefinitionReads
  private readonly common: CommonIntents
  private readonly jumps: CallJumps
  private readonly links: DefinitionLinks
  private readonly bulk: BulkIntents
  private readonly live: PanelLive

  constructor(
    private readonly context: PanelContext,
    private readonly target: DefinitionTarget,
  ) {
    this.request = { selected: target.definitionId, filter: target.filter ?? RUNNING }
    this.drift = new DriftCheck(target.localModel, new ModelDrift(context.diagrams))
    this.live = new PanelLive(context, "definition", {
      refreshQuietly: (tick) =>
        this.session.refreshQuietly(
          (loaded) => this.reads.refresh(loaded, tick),
          () => this.reads.load(this.request),
        ),
      isBusy: () => this.bulk.isBusy(),
      hasEnded: () => false,
      showLive: () => {
        this.session.republish()
      },
    })
    this.session = new ViewSession(context, target.bpmnProcessId, {
      decorate: (view) => this.bulk.decorate(this.withNotice(view)),
      live: () => this.live.status(),
      settled: (read) => {
        this.live.settled(read)
      },
    })
    this.common = new CommonIntents(context, this.live)
    this.jumps = new CallJumps(context, () => {
      this.session.republish()
    })
    const modelLinks = new ModelLinks(context)
    this.links = new DefinitionLinks(context, {
      jumps: this.jumps,
      links: modelLinks,
      current: () => this.session.current(),
    })
    this.bulk = new BulkIntents(context, target.bpmnProcessId, {
      current: () => this.session.current(),
      reload: () => this.reloadInLane(),
      republish: () => {
        this.session.republish()
      },
    })
    this.reads = new DefinitionReads(context, target.bpmnProcessId, {
      drift: this.drift,
      jumps: this.jumps,
      links: modelLinks,
    })
  }

  async handle(intent: WebviewIntent): Promise<void> {
    if (BulkIntents.handles(intent)) {
      return this.bulk.handle(intent)
    }
    if (DefinitionLinks.handles(intent)) {
      return this.links.handle(intent)
    }
    switch (intent.type) {
      case "ready":
        await this.session.resume(() => this.reads.load(this.request))
        this.bulk.resume()
        return
      case "refresh":
        return this.reload()
      case "selectVersion":
        this.bulk.clearSelection()
        this.request = { selected: DefinitionId(intent.definitionId), filter: RUNNING }
        return this.reload()
      case "filterInstances":
        this.bulk.clearSelection()
        this.request = { ...this.request, filter: intent.filter }
        return this.reload()
      case "loadMoreInstances":
        return this.loadMore()
      default:
        return this.common.handle(intent)
    }
  }

  attend(attention: Attention): void {
    this.live.attend(attention)
    this.bulk.attend(attention)
  }

  nudge(): void {
    this.live.nudge()
  }

  dispose(): void {
    this.live.dispose()
    this.bulk.dispose()
    this.session.close()
  }

  async compareWith(local: LocalModel): Promise<void> {
    this.drift.compareWith(local)
    this.request = { ...this.request, selected: this.target.definitionId }
    await this.reload()
  }

  private reload(): Promise<void> {
    const request = this.request
    this.jumps.forgetNotice()
    return this.session.reload(() => this.reads.load(request))
  }

  private reloadInLane(): Promise<void> {
    const reload = () => this.session.reload(() => this.reads.load(this.request))
    const lane = this.context.live?.lane
    return lane === undefined ? reload() : lane.run(reload)
  }

  private async loadMore(): Promise<void> {
    if (this.session.current()?.next === undefined) {
      return
    }
    await this.session.extend((loaded) => this.reads.more(loaded))
  }

  private withNotice(view: DefinitionView): DefinitionView {
    const notice = this.jumps.notice()
    return notice === undefined ? view : { ...view, notices: [...view.notices, notice] }
  }
}
