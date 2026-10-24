import type {
  BulkOperationId,
  InstanceFilter,
  InstanceId,
  InstanceSummary,
  MigrationPlan,
  ProcessCommands,
} from '../../contract/index.js';
import type { BulkKind, ScopeCounts } from '../protocol/index.js';
import type { BulkAction, BulkWording } from './bulk-action.js';

export interface MigrationVersions {
  readonly source: number;
  readonly target: number;
}

export class MigrateInstancesAction implements BulkAction {
  readonly kind: BulkKind = 'migrateInstances';
  readonly sendsReason = false;
  readonly wording: BulkWording;

  constructor(
    readonly plan: MigrationPlan,
    versions: MigrationVersions,
  ) {
    this.wording = {
      offer: 'Migrate to version…',
      verb: 'migrate',
      doing: 'Migrating',
      done: 'migrated',
      eligible: `on v${versions.source}`,
      skipped: `ended or left v${versions.source}`,
      arrival: ` to v${versions.target}`,
      lasting: [],
      warning: "Migrating can't be undone.",
      notDone: 'The engine could not migrate them.',
      stalled:
        'The engine has not migrated any more instances. Check that it runs its background jobs, then wait or stop.',
      reasonPrompt: '',
    };
  }

  eligible(instance: InstanceSummary): boolean {
    const running = instance.state === 'running' || instance.state === 'suspended';
    return running && instance.definition.id === this.plan.sourceDefinitionId;
  }

  eligibleFilter(filter: InstanceFilter): InstanceFilter {
    return { ...filter, definitionId: this.plan.sourceDefinitionId, lifecycle: 'running' };
  }

  arrivedFilter(filter: InstanceFilter): InstanceFilter {
    return { ...filter, definitionId: this.plan.targetDefinitionId };
  }

  matching(_filter: unknown, counts: ScopeCounts): number {
    return counts.running;
  }

  submit(commands: ProcessCommands, instanceIds: readonly InstanceId[]): Promise<BulkOperationId> {
    return commands.migrateInstances(this.plan, instanceIds);
  }
}
