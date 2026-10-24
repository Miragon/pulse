import { DefinitionId, type InstanceId } from '../../contract/index.js';
import type { MigrationView, WebviewIntent } from '../protocol/index.js';
import type { Attention } from '../refresh/live-context.js';
import { MigrationViewBuilder } from '../views/migration-view-builder.js';
import { BulkFollow } from './bulk-follow.js';
import type { BulkRun } from './bulk-run.js';
import { BulkRunControl } from './bulk-run-control.js';
import { BulkWrite } from './bulk-write.js';
import { MigrateInstancesAction } from './migrate-instances-action.js';
import { MigrationChecks } from './migration-checks.js';
import { MigrationEdits } from './migration-edits.js';
import { MigrationPreview } from './migration-preview.js';
import {
  MigrationReads,
  type MigrationLoaded,
  type MigrationRequest,
  type MigrationState,
} from './migration-reads.js';
import type { Panel } from './panel.js';
import type { MigrationTarget, PanelContext } from './panel-context.js';
import type { Unavailable } from './view-session.js';
import { ViewSession } from './view-session.js';

export class MigrationPanel implements Panel {
  private request: MigrationRequest;
  private readonly session: ViewSession<MigrationView, MigrationLoaded>;
  private readonly reads: MigrationReads;
  private readonly checks: MigrationChecks;
  private readonly edits: MigrationEdits;
  private readonly write: BulkWrite<MigrateInstancesAction>;
  private readonly follow: BulkFollow;
  private readonly control: BulkRunControl;
  private readonly retry: () => void;
  private settledRun: BulkRun | undefined;
  private disposed = false;

  constructor(
    private readonly context: PanelContext,
    private readonly target: MigrationTarget,
  ) {
    this.request = MigrationPanel.requestOf(target);
    this.reads = new MigrationReads(context, target.bpmnProcessId);
    this.session = new ViewSession(context, target.bpmnProcessId, {
      decorate: (view) => this.withRun(view),
    });
    const host = {
      current: () => this.session.current(),
      update: (change: Partial<MigrationState>) => {
        this.update(change);
      },
    };
    this.edits = new MigrationEdits({
      ...host,
      check: (plan) => {
        this.checks.schedule(plan);
      },
    });
    this.checks = new MigrationChecks(context, (plan, outcome) => {
      this.edits.checked(plan, outcome);
    });
    this.follow = new BulkFollow(context, {
      reload: () => this.reloadInLane(),
      republish: () => {
        this.session.republish();
      },
    });
    this.control = new BulkRunControl(context, target.bpmnProcessId, {
      runs: context.bulkRuns,
      follow: this.follow,
      republish: () => {
        this.session.republish();
      },
    });
    const preview = new MigrationPreview(context, this.reads, host);
    this.write = new BulkWrite(context, context.bulkRuns, {
      bpmnProcessId: target.bpmnProcessId,
      prepare: (action, ids) => preview.prepared(action, ids),
      registered: () => {
        this.session.republish();
      },
    });
    this.retry = () => {
      this.resume();
    };
  }

  static requestOf(target: MigrationTarget): MigrationRequest {
    return {
      sourceDefinitionId: target.sourceDefinitionId,
      instanceIds: target.instanceIds,
      leftOut: [],
    };
  }

  async handle(intent: WebviewIntent): Promise<void> {
    switch (intent.type) {
      case 'ready':
        await this.session.resume(() => this.load());
        this.resume();
        return;
      case 'refresh':
        return this.reload();
      case 'pickMigrationTarget':
        return this.pickTarget(DefinitionId(intent.definitionId));
      case 'startMigration':
        return this.start();
      default:
        await this.handleOther(intent);
    }
  }

  attend(attention: Attention): void {
    this.follow.attend(attention);
    if (attention === 'watched') {
      this.resume();
    }
  }

  nudge(): void {
    return;
  }

  dispose(): void {
    this.disposed = true;
    this.checks.cancel();
    this.write.close();
    this.follow.dispose();
    this.session.close();
  }

  async retarget(target: MigrationTarget): Promise<void> {
    const kept = this.keptRequest();
    const sameSource = target.sourceDefinitionId === kept.sourceDefinitionId;
    this.request = {
      ...MigrationPanel.requestOf(target),
      ...(sameSource && kept.targetDefinitionId !== undefined
        ? {
            targetDefinitionId: kept.targetDefinitionId,
            ...(kept.mappings === undefined ? {} : { mappings: kept.mappings }),
          }
        : {}),
    };
    await this.session.reload(() => this.load());
  }

  private async handleOther(intent: WebviewIntent): Promise<void> {
    switch (intent.type) {
      case 'mapElement':
        this.edits.map(intent.sourceElementId, intent.targetElementId);
        return;
      case 'unmapElement':
        this.edits.unmap(intent.sourceElementId);
        return;
      case 'focusMapping':
        this.edits.focus(intent.sourceElementId);
        return;
      case 'leaveOutUnmapped':
        this.edits.leaveOutBlocked();
        return;
      default:
        await this.handleRun(intent);
    }
  }

  private async handleRun(intent: WebviewIntent): Promise<void> {
    switch (intent.type) {
      case 'stopBulk':
        await this.control.stop();
        break;
      case 'dismissBulk':
        this.control.dismiss();
        break;
      case 'checkBulk':
        await this.control.check();
        break;
      case 'showBulkFailures':
        await this.control.showFailures();
        break;
      default:
        this.handleShell(intent);
        return;
    }
    this.session.republish();
  }

  private handleShell(intent: WebviewIntent): void {
    switch (intent.type) {
      case 'goBack':
        this.context.effects.goBack();
        return;
      case 'copy':
        this.context.effects.copyToClipboard(intent.text, intent.label);
        return;
      case 'editConnection':
        this.context.effects.editConnection();
        return;
      case 'setCredentials':
        this.context.effects.setCredentials();
        return;
      default:
        return;
    }
  }

  private async start(): Promise<void> {
    const loaded = this.session.current();
    const plan = loaded === undefined ? undefined : MigrationEdits.planOf(loaded);
    if (loaded?.target === undefined || plan === undefined || this.offerOf(loaded) !== 'ready') {
      return;
    }
    this.checks.cancel();
    const action = new MigrateInstancesAction(plan, {
      source: loaded.source.version,
      target: loaded.target.version,
    });
    const run = await this.write.start(action, this.selectedOf(loaded));
    if (run !== undefined && run.phase !== 'failed') {
      this.follow.follow(run);
    }
    this.session.republish();
  }

  private pickTarget(definitionId: DefinitionId): Promise<void> {
    const loaded = this.session.current();
    const known = loaded?.versions.some((version) => version.definition.id === definitionId);
    if (known !== true || definitionId === this.request.sourceDefinitionId) {
      return Promise.resolve();
    }
    this.checks.cancel();
    const { sourceDefinitionId, instanceIds, leftOut } = this.keptRequest();
    this.request = { sourceDefinitionId, instanceIds, leftOut, targetDefinitionId: definitionId };
    return this.session.reload(() => this.load());
  }

  private reload(): Promise<void> {
    this.request = this.keptRequest();
    return this.session.reload(() => this.load());
  }

  private reloadInLane(): Promise<void> {
    this.request = this.keptRequest();
    const reload = () => this.session.reload(() => this.load());
    const lane = this.context.live?.lane;
    return lane === undefined ? reload() : lane.run(reload);
  }

  private keptRequest(): MigrationRequest {
    const loaded = this.session.current();
    if (loaded === undefined) {
      return this.request;
    }
    return {
      sourceDefinitionId: loaded.source.id,
      instanceIds: this.request.instanceIds,
      leftOut: loaded.leftOut,
      ...(loaded.target === undefined
        ? {}
        : { targetDefinitionId: loaded.target.id, mappings: loaded.mappings }),
    };
  }

  private async load(): Promise<MigrationLoaded | Unavailable> {
    const run = this.control.run();
    if (run?.isActive() !== true) {
      this.settledRun = run;
    }
    const state = await this.reads.load(this.request);
    return 'problem' in state ? state : this.snapshot({ ...state, checking: false });
  }

  private update(change: Partial<MigrationState>): void {
    this.session.rebuild((loaded) => this.snapshot({ ...loaded, ...change }));
  }

  private snapshot(state: MigrationState): MigrationLoaded {
    return { ...state, view: this.viewOf(state) };
  }

  private withRun(view: MigrationView): MigrationView {
    const loaded = this.session.current();
    return loaded === undefined ? view : this.viewOf(loaded);
  }

  private viewOf(state: MigrationState): MigrationView {
    return new MigrationViewBuilder(state, {
      engine: this.context.engine,
      now: this.context.now().getTime(),
      canWrite: this.context.commands !== undefined,
      run: this.control.run(),
    }).build();
  }

  private offerOf(loaded: MigrationLoaded): string {
    return this.viewOf(loaded).offer.status;
  }

  private selectedOf(loaded: MigrationLoaded): InstanceId[] {
    const leftOut = new Set(loaded.leftOut);
    return loaded.instanceIds.filter((id) => !leftOut.has(id));
  }

  private resume(): void {
    const run = this.control.run();
    if (this.disposed) {
      return;
    }
    if (run?.isActive() === true) {
      this.follow.follow(run);
      return;
    }
    if (run !== undefined && run !== this.settledRun) {
      this.settledRun = run;
      void this.reloadInLane();
    }
    this.context.bulkRuns.whenStarted(this.target.bpmnProcessId, this.retry);
  }
}
