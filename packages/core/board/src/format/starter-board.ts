import { BoardVocabulary } from "./board-vocabulary.js"

export class StarterBoard {
  static of(title: string, engines: readonly string[]): string {
    const board = {
      schemaVersion: BoardVocabulary.SCHEMA_VERSION,
      title,
      engines,
      rows: [
        {
          row: [
            { widget: "counter", props: { title: "Running", filter: {} } },
            {
              widget: "counter",
              props: { title: "With incident", filter: { withIncident: true } },
            },
            { widget: "incidentSummary", props: { title: "With incident per process" } },
          ],
        },
        { row: [{ widget: "instanceList", props: { filter: {} } }] },
      ],
    }
    return `${JSON.stringify(board, undefined, 2)}\n`
  }
}
