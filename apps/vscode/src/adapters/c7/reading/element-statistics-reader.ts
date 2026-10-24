import type { DefinitionId, ElementStatistics } from '../../../contract/index.js';
import type { ElementActivity } from '../mapping/element-statistics-mapper.js';
import type { Mapper } from '../mapping/mapper.js';
import type { EngineClient } from '../engine-cli/index.js';

export class ElementStatisticsReader {
  constructor(
    private readonly client: EngineClient,
    private readonly statistics: Mapper<ElementActivity, ElementStatistics[]>,
  ) {}

  async of(definitionId: DefinitionId): Promise<ElementStatistics[]> {
    const [activities, incidents] = await Promise.all([
      this.client.activityStatistics(definitionId),
      this.client.incidents({ processDefinitionId: definitionId }),
    ]);
    return this.statistics.map({ activities, incidents });
  }
}
