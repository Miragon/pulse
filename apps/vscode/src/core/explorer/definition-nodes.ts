import type {
  BpmnProcessId,
  DefinitionId,
  DefinitionSummary,
  ProcessRuntime,
} from '../../contract/index.js';

export interface DefinitionNode {
  readonly bpmnProcessId: BpmnProcessId;
  readonly latestDefinitionId: DefinitionId;
  readonly label: string;
  readonly description: string;
  readonly withIncident: number;
}

export class DefinitionNodes {
  constructor(private readonly runtime: Pick<ProcessRuntime, 'listDefinitions'>) {}

  async list(): Promise<DefinitionNode[]> {
    const summaries = await this.runtime.listDefinitions();
    return summaries
      .map((summary) => this.nodeOf(summary))
      .sort((left, right) => left.label.localeCompare(right.label));
  }

  private nodeOf(summary: DefinitionSummary): DefinitionNode {
    return {
      bpmnProcessId: summary.latest.bpmnProcessId,
      latestDefinitionId: summary.latest.id,
      label: summary.latest.name ?? summary.latest.bpmnProcessId,
      description: this.describeCounts(summary),
      withIncident: summary.withIncident,
    };
  }

  private describeCounts(summary: DefinitionSummary): string {
    const running = summary.running === 0 ? 'idle' : `${summary.running} running`;
    return `${running} · latest v${summary.latest.version}`;
  }
}
