import { IncidentId, type InstanceId } from '../../contract/index.js';
import type { InstanceView, WebviewIntent } from '../protocol/index.js';
import type { Attention } from '../refresh/live-context.js';
import { PanelLive } from '../refresh/panel-live.js';
import { CallTargets } from '../views/call-targets.js';
import { HandoverText } from '../views/handover-text.js';
import { Labels } from '../views/labels.js';
import { CallJumps } from './call-jumps.js';
import { CommonIntents } from './common-intents.js';
import { InstanceReads } from './instance-reads.js';
import { InstanceWrites, type LoadedInstance } from './instance-writes.js';
import { ModelLinks, type ElementLink } from './model-links.js';
import type { Panel } from './panel.js';
import { SelectedElement } from './selected-element.js';
import type { PanelContext } from './panel-context.js';
import { ViewSession } from './view-session.js';

type LocalSourceIntent = Extract<
  WebviewIntent,
  { readonly type: 'selectElement' | 'openModel' | 'openCode' }
>;

interface SourceTarget {
  readonly incidentId?: string | undefined;
  readonly elementId?: string | undefined;
}

const LOCAL_SOURCE_INTENTS: ReadonlySet<WebviewIntent['type']> = new Set([
  'selectElement',
  'openModel',
  'openCode',
]);

export class InstancePanel implements Panel {
  private readonly session: ViewSession<InstanceView, LoadedInstance>;
  private readonly writes: InstanceWrites;
  private readonly common: CommonIntents;
  private readonly jumps: CallJumps;
  private readonly links: ModelLinks;
  private readonly selection: SelectedElement;
  private readonly reads: InstanceReads;
  private readonly live: PanelLive;

  constructor(
    private readonly context: PanelContext,
    instanceId: InstanceId,
  ) {
    this.writes = new InstanceWrites(context, instanceId, {
      current: () => this.session.current(),
      reload: () => this.reloadInLane(),
      republish: () => {
        this.session.republish();
      },
      live: () => this.live.status(),
    });
    this.live = new PanelLive(context, 'instance', {
      refreshQuietly: () =>
        this.session.refreshQuietly(
          (loaded) => this.reads.refresh(loaded),
          () => this.reads.load(),
        ),
      isBusy: () => this.writes.isBusy(),
      hasEnded: () => InstanceReads.hasEnded(this.session.current()),
      showLive: () => {
        this.session.republish();
      },
    });
    this.session = new ViewSession(context, Labels.shortId(instanceId), {
      decorate: (view) => this.selection.decorate(this.withNotice(this.writes.decorate(view))),
      live: () => this.live.status(),
      settled: (read) => {
        this.live.settled(read);
      },
    });
    this.common = new CommonIntents(context, this.live);
    this.jumps = new CallJumps(context, () => {
      this.session.republish();
    });
    this.links = new ModelLinks(context);
    this.reads = new InstanceReads(context, instanceId, { jumps: this.jumps, links: this.links });
    this.selection = new SelectedElement(this.links, () => {
      this.session.republish();
    });
  }

  async handle(intent: WebviewIntent): Promise<void> {
    if (LOCAL_SOURCE_INTENTS.has(intent.type)) {
      return this.handleLocalSource(intent as LocalSourceIntent);
    }
    switch (intent.type) {
      case 'ready':
        return this.session.resume(() => this.reads.load());
      case 'refresh':
        this.writes.forgetOutcome();
        this.jumps.forgetNotice();
        return this.session.reload(() => this.reads.load());
      case 'openCall':
        return this.openCall(intent.elementId, intent.toSide);
      case 'openWebUi':
        this.openWebUi();
        return;
      case 'copyHandover':
        this.copyHandover();
        return;
      case 'retryIncident':
        return this.writes.retry(intent.incidentId);
      case 'setVariable':
        return this.writes.setVariable(intent.name, intent.valueJson);
      case 'moveToken':
        return this.writes.move(intent);
      default:
        return this.common.handle(intent);
    }
  }

  attend(attention: Attention): void {
    this.live.attend(attention);
  }

  nudge(): void {
    this.live.nudge();
  }

  dispose(): void {
    this.writes.forgetOutcome();
    this.live.dispose();
    this.session.close();
  }

  private reloadInLane(): Promise<void> {
    const reload = () => this.session.reload(() => this.reads.load());
    const lane = this.context.live?.lane;
    return lane === undefined ? reload() : lane.run(reload);
  }

  private async handleLocalSource(intent: LocalSourceIntent): Promise<void> {
    switch (intent.type) {
      case 'selectElement':
        return this.select(intent.elementId);
      case 'openModel':
        return this.openModel(intent);
      case 'openCode':
        this.openCode(intent);
    }
  }

  private async openCall(elementId: string, toSide: boolean): Promise<void> {
    const loaded = this.session.current();
    if (loaded !== undefined) {
      const target = new CallTargets(loaded.calledProcesses, loaded.detail).of(elementId);
      await this.jumps.open({ target, elementId, diagramXml: loaded.view.diagramXml }, { toSide });
    }
  }

  private async select(elementId: string): Promise<void> {
    const definition = this.session.current()?.detail.instance.definition;
    if (definition !== undefined) {
      await this.selection.select(definition, elementId);
    }
  }

  private async openModel(target: SourceTarget): Promise<void> {
    const link = this.linkOf(target.incidentId);
    if (link !== undefined) {
      await this.links.openModel(link.model, link.elementId);
    }
  }

  private openCode(target: SourceTarget): void {
    const link = this.linkOf(target.incidentId);
    if (link !== undefined) {
      this.links.openCode(link);
    } else if (target.incidentId === undefined && target.elementId !== undefined) {
      this.openCodeOf(target.elementId);
    }
  }

  private openCodeOf(elementId: string): void {
    const incident = [...(this.session.current()?.modelLinks.values() ?? [])].find(
      (link) => link.elementId === elementId && link.code !== undefined,
    );
    if (incident === undefined) {
      this.selection.openCode(elementId);
    } else {
      this.links.openCode(incident);
    }
  }

  private linkOf(incidentId: string | undefined): ElementLink | undefined {
    return incidentId === undefined
      ? undefined
      : this.session.current()?.modelLinks.get(IncidentId(incidentId));
  }

  private openWebUi(): void {
    const instance = this.session.current()?.detail.instance;
    if (instance !== undefined && this.context.engine.webUi !== undefined) {
      this.context.effects.openWebUi({ kind: 'instance', instance });
    }
  }

  private withNotice(view: InstanceView): InstanceView {
    const notice = this.jumps.notice();
    return notice === undefined ? view : { ...view, notice };
  }

  private copyHandover(): void {
    const loaded = this.session.current();
    if (loaded !== undefined) {
      this.context.effects.copyToClipboard(HandoverText.of(loaded.view), 'handover');
    }
  }
}
