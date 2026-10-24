import {
  ElementId,
  IncidentId,
  MoveReasons,
  RuntimeError,
  type CalledProcess,
  type IncidentDetails,
  type InstanceDetail,
  type InstanceId,
  type ModelFile,
  type ProcessCommands,
  type TokenMove,
  type VariableChange,
} from '../../contract/index.js';
import type {
  IncidentRow,
  InstanceView,
  LiveUpdates,
  Notice,
  WebviewIntent,
  WriteState,
  WriteTarget,
} from '../protocol/index.js';
import { InstanceViewElements } from '../views/instance-view-elements.js';
import { MoveOutcomes } from '../views/move-outcomes.js';
import { VariableValues } from '../views/variable-values.js';
import { WriteOutcomes } from '../views/write-outcomes.js';
import { WriteRequests, type ChosenMove, type DataFreshness } from '../views/write-requests.js';
import type { ElementLinks } from './model-links.js';
import type { PanelContext, WriteRequest } from './panel-context.js';
import { Problems } from './problems.js';

const RECHECKS_MS = [2000, 3000, 5000, 10_000, 20_000, 20_000] as const;

type MoveIntent = Extract<WebviewIntent, { readonly type: 'moveToken' }>;

export interface LoadedInstance {
  readonly view: InstanceView;
  readonly detail: InstanceDetail;
  readonly calledProcesses: readonly CalledProcess[];
  readonly modelLinks: ElementLinks;
  readonly model: ModelFile | undefined;
  readonly fullDetails: ReadonlyMap<IncidentId, IncidentDetails>;
}

export interface WriteHost {
  current(): LoadedInstance | undefined;
  reload(): Promise<void>;
  republish(): void;
  live(): LiveUpdates | undefined;
}

export class InstanceWrites {
  private state: WriteState | undefined;
  private outcome: Notice | undefined;
  private busy = false;
  private rechecking = false;
  private generation = 0;

  constructor(
    private readonly context: PanelContext,
    private readonly instanceId: InstanceId,
    private readonly host: WriteHost,
  ) {}

  decorate(view: InstanceView): InstanceView {
    const written = this.state === undefined ? view : { ...view, write: this.state };
    return WriteOutcomes.shownIn(written, this.outcome);
  }

  isBusy(): boolean {
    return this.busy || this.rechecking;
  }

  forgetOutcome(): void {
    this.generation += 1;
    this.outcome = undefined;
    this.state = undefined;
  }

  async retry(incidentId: string): Promise<void> {
    const commands = this.context.commands;
    const loaded = this.host.current();
    const row = loaded?.view.incidents.find(
      (candidate) => candidate.id === incidentId && candidate.retryable === true,
    );
    if (commands === undefined || loaded === undefined || row === undefined) {
      return;
    }
    const target: WriteTarget = { kind: 'incident', incidentId };
    const retried = await this.run(
      target,
      WriteRequests.retry(loaded.view, row, this.freshnessOf(loaded.view)),
      async () => {
        await commands.retryIncident(IncidentId(incidentId));
        this.context.effects.reportWritten(
          `Retried the incident at ${InstanceViewElements.nameOf(loaded.view, row.elementId)} on ${this.where()}.`,
        );
        this.outcome = WriteOutcomes.RETRY_CHECK;
        await this.host.reload();
      },
    );
    if (retried) {
      this.rechecking = true;
      try {
        await this.recheck(row, this.generation);
      } finally {
        this.rechecking = false;
      }
    }
  }

  async setVariable(name: string, valueJson: string): Promise<void> {
    const commands = this.context.commands;
    const loaded = this.host.current();
    const row = loaded?.view.variables.find(
      (candidate) => candidate.name === name && candidate.scopeElementId === undefined,
    );
    if (commands === undefined || loaded === undefined || row?.editor === undefined) {
      return;
    }
    const target: WriteTarget = { kind: 'variable', name };
    const invalid = VariableValues.whyInvalid({ ...row, editor: row.editor }, valueJson);
    if (invalid !== undefined) {
      this.show({ status: 'failed', target, message: invalid });
      return;
    }
    const change = this.changeOf(loaded.detail, name, valueJson);
    const request = WriteRequests.variableChange(
      loaded.view,
      row,
      valueJson,
      this.freshnessOf(loaded.view),
    );
    await this.run(target, request, async () => {
      await commands.setVariable(this.instanceId, change);
      this.context.effects.reportWritten(`Changed ${name} on ${this.where()}.`);
      await this.host.reload();
      const after = this.host.current();
      this.outcome = after === undefined ? undefined : WriteOutcomes.afterChange(name, after.view);
    });
  }

  async move(intent: MoveIntent): Promise<void> {
    const commands = this.context.commands;
    const loaded = this.host.current();
    const option = loaded?.view.moves?.find((move) => move.fromElementId === intent.fromElementId);
    const target = option?.targets.find((move) => move.elementId === intent.toElementId);
    if (
      commands === undefined ||
      loaded === undefined ||
      option === undefined ||
      target === undefined
    ) {
      return;
    }
    const writeTarget: WriteTarget = { kind: 'token', fromElementId: option.fromElementId };
    const invalid = MoveReasons.whyInvalid(intent.reason);
    if (invalid !== undefined) {
      this.show({ status: 'failed', target: writeTarget, message: invalid });
      return;
    }
    const chosen = { before: loaded.view, option, target, reason: intent.reason.trim() };
    const request = WriteRequests.move(chosen, this.freshnessOf(loaded.view));
    await this.run(writeTarget, request, () => this.moved(commands, chosen));
  }

  private async moved(commands: ProcessCommands, chosen: ChosenMove): Promise<void> {
    const { option, target } = chosen;
    const move: TokenMove = {
      fromElementId: ElementId(option.fromElementId),
      toElementId: ElementId(target.elementId),
      reason: chosen.reason,
    };
    await commands.moveToken(this.instanceId, move).catch((error: unknown) => this.refused(error));
    this.context.effects.reportWritten(
      `Moved the token from ${option.fromLabel} to ${target.label} on ${this.where()}.`,
    );
    const generation = this.generation;
    await this.host.reload();
    const after = this.host.current();
    this.outcome =
      after === undefined || generation !== this.generation
        ? undefined
        : MoveOutcomes.after(option, target, chosen.before, after.view);
  }

  private async refused(error: unknown): Promise<never> {
    if (!RuntimeError.is(error) || error.failure !== 'rejected') {
      throw error;
    }
    await this.host.reload();
    throw new RuntimeError('rejected', `Nothing was changed. ${error.message}`, { cause: error });
  }

  private async recheck(row: IncidentRow, generation: number): Promise<void> {
    for (const [index, delay] of RECHECKS_MS.entries()) {
      await this.context.wait(delay);
      if (generation !== this.generation || this.context.live?.lane.isBlocked === true) {
        return;
      }
      await this.host.reload();
      const after = this.host.current()?.view;
      const stillChecking = index < RECHECKS_MS.length - 1;
      this.outcome =
        after === undefined ? undefined : WriteOutcomes.afterRetry(row, after, stillChecking);
      this.host.republish();
      if (after === undefined || WriteOutcomes.isSettled(row, after)) {
        return;
      }
    }
  }

  private changeOf(detail: InstanceDetail, name: string, valueJson: string): VariableChange {
    const variable = detail.variables.find(
      (candidate) => candidate.name === name && candidate.scope.kind === 'instance',
    );
    const keepsType = variable?.type !== undefined && variable.kind !== 'null';
    return { name, valueJson: valueJson.trim(), ...(keepsType ? { type: variable.type } : {}) };
  }

  private freshnessOf(view: InstanceView): DataFreshness {
    const ageMs = this.context.now().getTime() - Date.parse(view.asOf);
    return { ageMs: Math.max(0, ageMs), live: this.host.live() };
  }

  private where(): string {
    return `${this.context.engine.name} (${this.context.engine.host})`;
  }

  private show(state: WriteState | undefined): void {
    this.state = state;
    this.host.republish();
  }

  private async run(
    target: WriteTarget,
    request: WriteRequest,
    write: () => Promise<void>,
  ): Promise<boolean> {
    if (this.busy) {
      return false;
    }
    this.busy = true;
    try {
      return await this.confirmed(target, request, write);
    } finally {
      this.busy = false;
    }
  }

  private async confirmed(
    target: WriteTarget,
    request: WriteRequest,
    write: () => Promise<void>,
  ): Promise<boolean> {
    if (!(await this.context.effects.confirmWrite(request))) {
      this.show({ status: 'cancelled', target });
      return false;
    }
    this.generation += 1;
    this.outcome = undefined;
    this.show({ status: 'pending', target });
    try {
      await write();
      this.show({ status: 'done', target });
      return true;
    } catch (error) {
      const problem = Problems.of(error, this.context.engine);
      this.context.effects.reportProblem(problem);
      this.show({ status: 'failed', target, message: `${problem.title} ${problem.detail}` });
      return false;
    }
  }
}
