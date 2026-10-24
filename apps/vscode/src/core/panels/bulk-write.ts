import {
  RuntimeError,
  type BpmnProcessId,
  type InstanceId,
  type ProcessCommands,
  type RuntimeFailure,
} from '../../contract/index.js';
import type { Problem } from '../protocol/index.js';
import type { BulkPreview } from '../views/bulk-requests.js';
import { Labels } from '../views/labels.js';
import type { BulkAction } from './bulk-action.js';
import { BulkRun } from './bulk-run.js';
import type { BulkRuns } from './bulk-runs.js';
import type { BulkRequest, PanelContext } from './panel-context.js';
import { Problems } from './problems.js';

const UNKNOWN_OUTCOMES: ReadonlySet<RuntimeFailure> = new Set<RuntimeFailure>([
  'unreachable',
  'unexpectedResponse',
  'engineFailure',
]);

export interface PreparedBulk {
  readonly preview: BulkPreview;
  readonly request: BulkRequest;
}

export interface WriteSubject<Action extends BulkAction> {
  readonly bpmnProcessId: BpmnProcessId;
  prepare(action: Action, ids: readonly InstanceId[]): Promise<PreparedBulk | undefined>;
  registered(run: BulkRun): void;
}

export class BulkWrite<Action extends BulkAction = BulkAction> {
  private busy = false;
  private closed = false;

  constructor(
    private readonly context: PanelContext,
    private readonly runs: BulkRuns,
    private readonly subject: WriteSubject<Action>,
  ) {}

  isBusy(): boolean {
    return this.busy;
  }

  close(): void {
    this.closed = true;
  }

  async start(action: Action, ids: readonly InstanceId[]): Promise<BulkRun | undefined> {
    const commands = this.context.commands;
    const current = this.runs.of(this.subject.bpmnProcessId);
    if (this.busy || current?.isActive() === true || commands === undefined || ids.length === 0) {
      return undefined;
    }
    if (current?.lingers === true) {
      this.context.effects.reportProblem(this.keptBatch());
      return undefined;
    }
    this.busy = true;
    try {
      return await this.confirmed(action, ids, commands);
    } catch (error) {
      this.context.effects.reportProblem(Problems.of(error, this.context.engine));
      return undefined;
    } finally {
      this.busy = false;
    }
  }

  private async confirmed(
    action: Action,
    ids: readonly InstanceId[],
    commands: ProcessCommands,
  ): Promise<BulkRun | undefined> {
    const prepared = await this.subject.prepare(action, ids);
    if (prepared === undefined) {
      return undefined;
    }
    const { preview, request } = prepared;
    if (preview.plan.ids.length === 0) {
      this.context.effects.reportProblem(this.nothingLeft(action, ids.length));
      return undefined;
    }
    const answer = await this.context.effects.confirmBulk(request);
    if (answer === undefined || this.closed) {
      return undefined;
    }
    const run = new BulkRun(preview.plan, this.context.now());
    if (!this.runs.start(this.subject.bpmnProcessId, run)) {
      this.context.effects.reportProblem(this.anotherRun());
      return undefined;
    }
    this.subject.registered(run);
    await this.submit(run, commands, answer.reason);
    return run;
  }

  private async submit(
    run: BulkRun,
    commands: ProcessCommands,
    reason: string | undefined,
  ): Promise<void> {
    const { action, ids } = run.plan;
    try {
      run.submitted(await action.submit(commands, ids, reason), this.context.now());
      this.context.effects.reportWritten(
        `Started to ${action.wording.verb} ${Labels.plural(ids.length, 'instance')} on ${this.context.engine.name} (${this.context.engine.host}).`,
      );
    } catch (error) {
      const problem = Problems.of(error, this.context.engine);
      const unknown = RuntimeError.is(error) && UNKNOWN_OUTCOMES.has(error.failure);
      run.failed(`${problem.title} ${problem.detail}`, unknown);
    }
  }

  private nothingLeft(action: BulkAction, selected: number): Problem {
    return {
      title: `Nothing left to ${action.wording.verb}.`,
      detail: `${Labels.plural(selected, 'selected instance')} ${selected === 1 ? 'has' : 'have'} ${action.wording.skipped}.`,
      canEditConnection: false,
    };
  }

  private keptBatch(): Problem {
    return {
      title: 'The engine keeps the batch of the last bulk write.',
      detail: 'Remove it from the strip first, then try again.',
      canEditConnection: false,
    };
  }

  private anotherRun(): Problem {
    return {
      title: 'Another bulk write runs on this process.',
      detail: 'Wait until it ends, then try again.',
      canEditConnection: false,
    };
  }
}
