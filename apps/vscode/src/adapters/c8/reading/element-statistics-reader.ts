import { ElementId, type DefinitionId, type ElementStatistics } from "../../../contract/index.js"
import { BpmnText, type ContainerText } from "../mapping/bpmn-text.js"
import { Keys } from "../mapping/keys.js"
import type { CamundaClient, ElementStatisticsView } from "../rest/index.js"
import type { Diagrams } from "./diagrams.js"

export class ElementStatisticsReader {
  constructor(
    private readonly client: CamundaClient,
    private readonly diagrams: Diagrams,
  ) {}

  async read(definitionId: DefinitionId): Promise<ElementStatistics[]> {
    if (!Keys.isKey(definitionId)) {
      return []
    }
    const rows = await this.client.elementStatistics(definitionId)
    const containers = await this.containersOf(definitionId, rows)
    const statistics = await Promise.all(
      rows.map((row) => this.statisticOf(definitionId, row, containers.get(row.elementId))),
    )
    return statistics.filter(
      (statistic) =>
        statistic.active > 0 || statistic.incidents > 0 || statistic.incidentsInCalledInstances > 0,
    )
  }

  private async containersOf(
    definitionId: DefinitionId,
    rows: readonly ElementStatisticsView[],
  ): Promise<ReadonlyMap<string, ContainerText>> {
    if (rows.every((row) => row.incidents === 0)) {
      return new Map()
    }
    const xml = await this.diagrams.xml(definitionId)
    const containers = xml === undefined ? [] : BpmnText.containers(xml)
    return new Map(containers.map((container) => [container.elementId, container]))
  }

  private async statisticOf(
    definitionId: DefinitionId,
    row: ElementStatisticsView,
    container: ContainerText | undefined,
  ): Promise<ElementStatistics> {
    if (row.incidents === 0 || container === undefined) {
      return ElementStatisticsReader.unsplit(row)
    }
    const raisedHere = await this.client.incidents(
      { processDefinitionKey: definitionId, elementId: row.elementId },
      { limit: 0 },
    )
    if (raisedHere.capped) {
      return ElementStatisticsReader.unsplit(row)
    }
    const raisedInside = Math.max(row.incidents - raisedHere.total, 0)
    return ElementStatisticsReader.statistic(
      row.elementId,
      row.active + raisedInside,
      raisedHere.total,
      container.callsProcess ? raisedInside : 0,
    )
  }

  private static unsplit(row: ElementStatisticsView): ElementStatistics {
    return ElementStatisticsReader.statistic(row.elementId, row.active, row.incidents, 0)
  }

  private static statistic(
    elementId: string,
    active: number,
    incidents: number,
    incidentsInCalledInstances: number,
  ): ElementStatistics {
    return { elementId: ElementId(elementId), active, incidents, incidentsInCalledInstances }
  }
}
