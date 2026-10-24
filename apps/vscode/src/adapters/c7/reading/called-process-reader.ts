import type { CalledProcess, DefinitionId } from '../../../contract/index.js';
import { ErrorTranslation } from '../errors/error-translation.js';
import type { CalledElement } from '../mapping/called-element-mapper.js';
import type { CallsOfDefinition } from '../mapping/called-process-mapper.js';
import type { Mapper } from '../mapping/mapper.js';
import type { EngineClient } from '../engine-cli/index.js';

export interface CalledProcessMappers {
  readonly calledElements: Mapper<string, CalledElement[]>;
  readonly calledProcesses: Mapper<CallsOfDefinition, CalledProcess[]>;
}

export class CalledProcessReader {
  constructor(
    private readonly client: EngineClient,
    private readonly mappers: CalledProcessMappers,
  ) {}

  async read(definitionId: DefinitionId): Promise<CalledProcess[]> {
    const [xml, statistics] = await Promise.all([
      ErrorTranslation.unlessMissing(() => this.client.diagramXml(definitionId)),
      this.client.definitionStatistics(),
    ]);
    if (xml === undefined) {
      return [];
    }
    return this.mappers.calledProcesses.map({
      callerId: definitionId,
      calledElements: this.mappers.calledElements.map(xml),
      definitions: statistics.map((row) => row.definition),
    });
  }
}
