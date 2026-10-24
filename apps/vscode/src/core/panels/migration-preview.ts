import type { InstanceId } from '../../contract/index.js';
import { MigrationRequests } from '../views/migration-requests.js';
import { MigrationRows } from '../views/migration-rows.js';
import type { PreparedBulk } from './bulk-write.js';
import type { MigrateInstancesAction } from './migrate-instances-action.js';
import { MigrationReads, type MigrationLoaded, type MigrationState } from './migration-reads.js';
import type { PanelContext } from './panel-context.js';

export interface PreviewHost {
  current(): MigrationLoaded | undefined;
  update(change: Partial<MigrationState>): void;
}

export class MigrationPreview {
  constructor(
    private readonly context: PanelContext,
    private readonly reads: MigrationReads,
    private readonly host: PreviewHost,
  ) {}

  async prepared(
    action: MigrateInstancesAction,
    ids: readonly InstanceId[],
  ): Promise<PreparedBulk | undefined> {
    const loaded = this.host.current();
    if (loaded === undefined || !(await this.stillFits(action, loaded))) {
      return undefined;
    }
    const page = await this.context.runtime.searchInstances(
      action.eligibleFilter({ instanceIds: ids }),
      { limit: ids.length },
    );
    const state = this.host.current();
    if (state === undefined || this.changed(action, loaded, state)) {
      this.refuse('The plan changed while Pulse checked it.', 'Look at it again, then migrate.');
      return undefined;
    }
    const eligible = page.items.filter((instance) => action.eligible(instance));
    const preview = {
      plan: {
        action,
        definitionId: state.source.id,
        version: state.source.version,
        ids: eligible.map((instance) => instance.id),
        skipped: ids.length - eligible.length,
        leftOut: state.leftOut.length,
      },
      selected: ids.length,
      firstRows: eligible,
    };
    return { preview, request: new MigrationRequests(state, preview).request() };
  }

  private async stillFits(
    action: MigrateInstancesAction,
    loaded: MigrationLoaded,
  ): Promise<boolean> {
    const { runtime } = this.context;
    const [check, statistics] = await Promise.all([
      runtime.checkMigration(action.plan),
      runtime.getElementStatistics(loaded.source.id),
    ]);
    const waiting = await this.reads.waitingAt(
      loaded.source.id,
      MigrationReads.tokenElements({ statistics, sourceXml: loaded.sourceXml }),
      { mappings: action.plan.mappings, instanceIds: loaded.instanceIds },
    );
    const planned = (this.host.current()?.mappings ?? loaded.mappings) === action.plan.mappings;
    this.host.update({
      statistics,
      waiting,
      ...(planned ? { problems: check.problems, checkFailure: undefined } : {}),
    });
    if (check.problems.length > 0) {
      this.refuse('The plan has problems now.', check.problems[0]?.message ?? '');
      return false;
    }
    const current = this.host.current() ?? loaded;
    const blocked = new MigrationRows({ ...current, mappings: action.plan.mappings }).blocked();
    if (blocked.labels.length > 0) {
      this.refuse(
        'Instances wait where the plan has no mapping.',
        `Map ${blocked.labels.join(', ')} or leave those instances out, then migrate.`,
      );
      return false;
    }
    return true;
  }

  private changed(
    action: MigrateInstancesAction,
    loaded: MigrationState,
    state: MigrationState,
  ): boolean {
    return (
      state.source.id !== action.plan.sourceDefinitionId ||
      state.target?.id !== action.plan.targetDefinitionId ||
      state.mappings !== action.plan.mappings ||
      state.leftOut !== loaded.leftOut ||
      state.instanceIds !== loaded.instanceIds
    );
  }

  private refuse(title: string, detail: string): void {
    this.context.effects.reportProblem({ title, detail, canEditConnection: false });
  }
}
