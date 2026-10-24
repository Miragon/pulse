import { ElementId, type ElementMapping, type MigrationPlan } from '../../contract/index.js';
import { MigrationElements } from '../views/migration-elements.js';
import { MigrationRows } from '../views/migration-rows.js';
import type { CheckOutcome } from './migration-checks.js';
import type { MigrationLoaded, MigrationState } from './migration-reads.js';

export interface EditHost {
  current(): MigrationLoaded | undefined;
  update(change: Partial<MigrationState>): void;
  check(plan: MigrationPlan): void;
}

export class MigrationEdits {
  constructor(private readonly host: EditHost) {}

  static planOf(state: MigrationState): MigrationPlan | undefined {
    return state.target === undefined
      ? undefined
      : {
          sourceDefinitionId: state.source.id,
          targetDefinitionId: state.target.id,
          mappings: state.mappings,
        };
  }

  map(sourceElementId: string, targetElementId: string): void {
    const loaded = this.host.current();
    const mapping: ElementMapping = {
      sourceElementId: ElementId(sourceElementId),
      targetElementId: ElementId(targetElementId),
    };
    if (loaded === undefined || !this.rowsOf(loaded).has(sourceElementId)) {
      return;
    }
    if (!new MigrationElements(loaded.sourceXml, loaded.targetXml).maps(mapping)) {
      return;
    }
    this.changeMappings(
      loaded,
      [...this.without(loaded, sourceElementId), mapping],
      sourceElementId,
    );
  }

  unmap(sourceElementId: string): void {
    const loaded = this.host.current();
    if (loaded?.mappings.some((mapping) => mapping.sourceElementId === sourceElementId) !== true) {
      return;
    }
    this.changeMappings(loaded, this.without(loaded, sourceElementId), sourceElementId);
  }

  focus(sourceElementId: string): void {
    const loaded = this.host.current();
    if (loaded !== undefined && this.rowsOf(loaded).has(sourceElementId)) {
      this.host.update({ focused: sourceElementId });
    }
  }

  leaveOutBlocked(): void {
    const loaded = this.host.current();
    if (loaded === undefined) {
      return;
    }
    const blocked = new MigrationRows(loaded).blockedIds();
    if (blocked.length > 0) {
      this.host.update({ leftOut: [...new Set([...loaded.leftOut, ...blocked])] });
    }
  }

  checked(plan: MigrationPlan, outcome: CheckOutcome): void {
    const loaded = this.host.current();
    if (loaded?.mappings !== plan.mappings) {
      return;
    }
    this.host.update(
      outcome.kind === 'checked'
        ? { checking: false, problems: outcome.check.problems, checkFailure: undefined }
        : { checking: false, checkFailure: outcome.message },
    );
  }

  private changeMappings(
    loaded: MigrationLoaded,
    mappings: readonly ElementMapping[],
    focused: string,
  ): void {
    this.host.update({ mappings, focused, checking: true, checkFailure: undefined });
    const plan = MigrationEdits.planOf({ ...loaded, mappings });
    if (plan !== undefined) {
      this.host.check(plan);
    }
  }

  private without(loaded: MigrationLoaded, sourceElementId: string): ElementMapping[] {
    return loaded.mappings.filter((mapping) => mapping.sourceElementId !== sourceElementId);
  }

  private rowsOf(loaded: MigrationLoaded): ReadonlySet<string> {
    return new Set(new MigrationRows(loaded).rows().map((row) => row.sourceElementId));
  }
}
