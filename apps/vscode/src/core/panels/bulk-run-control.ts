import type { BpmnProcessId, InstanceId } from '../../contract/index.js';
import { LiveFailures } from '../refresh/live-failures.js';
import { BulkFailures } from './bulk-failures.js';
import type { BulkFollow } from './bulk-follow.js';
import type { BulkRun } from './bulk-run.js';
import type { BulkRuns } from './bulk-runs.js';
import type { BulkSelection } from './bulk-selection.js';
import type { PanelContext } from './panel-context.js';
import { Problems } from './problems.js';

export interface RunParts {
  readonly runs: BulkRuns;
  readonly follow: BulkFollow;
  readonly selection?: BulkSelection;
  readonly republish: () => void;
}

export class BulkRunControl {
  constructor(
    private readonly context: PanelContext,
    private readonly bpmnProcessId: BpmnProcessId,
    private readonly parts: RunParts,
  ) {}

  run(): BulkRun | undefined {
    return this.parts.runs.of(this.bpmnProcessId);
  }

  dismiss(): void {
    this.parts.runs.forget(this.bpmnProcessId);
  }

  async stop(): Promise<void> {
    const run = this.run();
    const commands = this.context.commands;
    const operationId = run?.stopTarget();
    if (run === undefined || commands === undefined || operationId === undefined) {
      return;
    }
    run.stopping();
    this.parts.republish();
    await BulkFailures.note(this.context, run).catch(() => undefined);
    try {
      await commands.stopBulkOperation(operationId);
    } catch (error) {
      if (LiveFailures.stopsLiveUpdates(error)) {
        this.context.live?.lane.block();
      }
      const problem = Problems.of(error, this.context.engine);
      run.stopFailed(`${problem.title} ${problem.detail}`);
      this.context.effects.reportProblem(problem);
    }
    this.parts.follow.follow(run);
  }

  async check(): Promise<void> {
    const run = this.run();
    if (run?.phase === 'unknown') {
      await this.parts.follow.check(run);
    }
  }

  async showFailures(): Promise<void> {
    const run = this.run();
    if (run === undefined) {
      return;
    }
    try {
      await BulkFailures.show(this.context, run);
    } catch (error) {
      this.context.effects.reportProblem(Problems.of(error, this.context.engine));
    }
  }

  async remaining(): Promise<readonly InstanceId[] | undefined> {
    const run = this.run();
    if (run === undefined || run.isActive()) {
      return undefined;
    }
    const { action, ids } = run.plan;
    try {
      const page = await this.context.runtime.searchInstances(
        action.eligibleFilter({ instanceIds: ids }),
        { limit: ids.length },
      );
      this.dismiss();
      return page.items.map((instance) => instance.id);
    } catch (error) {
      this.context.effects.reportProblem(Problems.of(error, this.context.engine));
      return undefined;
    }
  }

  async selectRemaining(): Promise<void> {
    const remaining = await this.remaining();
    if (remaining !== undefined) {
      this.parts.selection?.clear();
      this.parts.selection?.toggle(remaining, true);
    }
  }
}
