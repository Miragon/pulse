import type { DefinitionSummary, VersionSummary } from '../../../contract/index.js';
import type { Mapper } from './mapper.js';

export class DefinitionSummaryMapper implements Mapper<
  readonly VersionSummary[],
  DefinitionSummary[]
> {
  map(versions: readonly VersionSummary[]): DefinitionSummary[] {
    const byProcess = this.groupedByProcess(versions);
    return [...byProcess.keys()]
      .sort((left, right) => left.localeCompare(right))
      .flatMap((key) => this.summaryOf(byProcess.get(key) ?? []));
  }

  private summaryOf(versions: readonly VersionSummary[]): DefinitionSummary[] {
    const [latest] = versions;
    if (latest === undefined) {
      return [];
    }
    return [
      {
        latest: latest.definition,
        running: versions.reduce((sum, version) => sum + version.running, 0),
        withIncident: versions.reduce((sum, version) => sum + version.withIncident, 0),
      },
    ];
  }

  private groupedByProcess(versions: readonly VersionSummary[]): Map<string, VersionSummary[]> {
    const byProcess = new Map<string, VersionSummary[]>();
    for (const version of versions) {
      const key = version.definition.bpmnProcessId;
      byProcess.set(key, [...(byProcess.get(key) ?? []), version]);
    }
    return byProcess;
  }
}
