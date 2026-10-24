import type { DefinitionSummary, EngineInfo } from '../../contract/index.js';
import type { EngineView, ProcessListFilter, WebviewIntent } from '../protocol/index.js';
import type { Attention } from '../refresh/live-context.js';
import { PanelLive } from '../refresh/panel-live.js';
import { EngineViewBuilder } from '../views/engine-view-builder.js';
import { CommonIntents } from './common-intents.js';
import type { Panel } from './panel.js';
import type { PanelContext } from './panel-context.js';
import { ViewSession, type Snapshot } from './view-session.js';

interface EngineFacts {
  readonly asOf: Date;
  readonly definitions: readonly DefinitionSummary[];
  readonly info: EngineInfo | undefined;
  readonly order?: readonly string[];
}

interface EngineLoaded extends EngineFacts, Snapshot<EngineView> {
  readonly order: readonly string[];
}

const ALL_PROCESSES: ProcessListFilter = { scope: 'all' };

export class EnginePanel implements Panel {
  private filter = ALL_PROCESSES;
  private readonly session: ViewSession<EngineView, EngineLoaded>;
  private readonly common: CommonIntents;
  private readonly live: PanelLive;

  constructor(private readonly context: PanelContext) {
    this.live = new PanelLive(context, 'engine', {
      refreshQuietly: () =>
        this.session.refreshQuietly(
          (loaded) => this.refresh(loaded),
          () => this.load(),
        ),
      isBusy: () => false,
      hasEnded: () => false,
      showLive: () => {
        this.session.republish();
      },
    });
    this.session = new ViewSession(context, context.engine.name, {
      live: () => this.live.status(),
      settled: (read) => {
        this.live.settled(read);
      },
    });
    this.common = new CommonIntents(context, this.live);
  }

  async handle(intent: WebviewIntent): Promise<void> {
    switch (intent.type) {
      case 'ready':
        return this.session.resume(() => this.load());
      case 'refresh':
        return this.session.reload(() => this.load());
      case 'filterProcesses':
        this.filter = intent.filter;
        this.session.rebuild((loaded) =>
          this.snapshot({ asOf: loaded.asOf, definitions: loaded.definitions, info: loaded.info }),
        );
        return;
      case 'openProcess':
        this.openProcess(intent.bpmnProcessId, intent.toSide);
        return;
      case 'openWebUi':
        this.openWebUi();
        return;
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
    this.live.dispose();
    this.session.close();
  }

  private async load(): Promise<EngineLoaded> {
    const asOf = this.context.now();
    const [definitions, info] = await Promise.all([
      this.context.definitions.read(0),
      this.context.runtime.describeEngine().catch(() => undefined),
    ]);
    return this.snapshot({ asOf, definitions, info });
  }

  private async refresh(loaded: EngineLoaded): Promise<EngineLoaded> {
    const asOf = this.context.now();
    const definitions = await this.context.definitions.read(0);
    return this.snapshot({ asOf, definitions, info: loaded.info, order: loaded.order });
  }

  private snapshot(facts: EngineFacts): EngineLoaded {
    const builder = new EngineViewBuilder({
      engine: this.context.engine,
      asOf: facts.asOf,
      definitions: facts.definitions,
      info: facts.info,
      filter: this.filter,
      ...(facts.order === undefined ? {} : { order: facts.order }),
    });
    return { ...facts, order: builder.processOrder(), view: builder.build() };
  }

  private openProcess(bpmnProcessId: string, toSide: boolean): void {
    const shown = this.session
      .current()
      ?.definitions.find((summary) => summary.latest.bpmnProcessId === bpmnProcessId);
    if (shown !== undefined) {
      this.context.effects.openLatestDefinition(shown.latest.bpmnProcessId, { toSide });
    }
  }

  private openWebUi(): void {
    if (this.context.engine.webUi !== undefined) {
      this.context.effects.openWebUi({ kind: 'engine' });
    }
  }
}
