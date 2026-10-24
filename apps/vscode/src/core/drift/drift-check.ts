import type { DefinitionId, VersionSummary } from '../../contract/index.js';
import type { Notice } from '../protocol/index.js';
import type { DriftFinding, LocalModel, ModelDrift } from './model-drift.js';

export interface DriftOutcome {
  readonly matchingDefinitionId?: DefinitionId;
  readonly notices: readonly Notice[];
}

export class DriftCheck {
  constructor(
    private local: LocalModel | undefined,
    private readonly drift: ModelDrift,
  ) {}

  get fileName(): string | undefined {
    return this.local?.fileName;
  }

  compareWith(local: LocalModel): void {
    this.local = local;
  }

  async resolve(versions: readonly VersionSummary[]): Promise<DriftOutcome> {
    const local = this.local;
    if (local === undefined || versions.length === 0) {
      return { notices: [] };
    }
    try {
      const finding = await this.drift.compare(local, versions);
      const notice = this.noticeOf(local, finding, versions[0]?.definition.id);
      return finding.kind === 'matches'
        ? { matchingDefinitionId: finding.definitionId, notices: [notice] }
        : { notices: [notice] };
    } catch {
      return { notices: [this.comparisonFailed(local)] };
    }
  }

  private noticeOf(
    local: LocalModel,
    finding: DriftFinding,
    newestId: DefinitionId | undefined,
  ): Notice {
    if (finding.kind === 'differs') {
      return {
        tone: 'warning',
        title: `${local.fileName} differs from every deployed version.`,
        detail: `The diagram shows the deployed v${finding.latestVersion}. Element ids may not match your file.`,
        actions: [],
      };
    }
    if (finding.latest) {
      return {
        tone: 'info',
        title: `${local.fileName} matches the deployed v${finding.version}.`,
        actions: [],
      };
    }
    return {
      tone: 'warning',
      title: `${local.fileName} matches v${finding.version}, but a newer version is deployed.`,
      detail: `Badges show v${finding.version}, the version of your file.`,
      actions:
        newestId === undefined
          ? []
          : [{ kind: 'selectVersion', label: 'Show newest', definitionId: newestId }],
    };
  }

  private comparisonFailed(local: LocalModel): Notice {
    return {
      tone: 'warning',
      title: `Couldn't compare ${local.fileName} with the deployed versions.`,
      detail: 'The engine did not return the diagram of every version. Refresh to try again.',
      actions: [],
    };
  }
}
