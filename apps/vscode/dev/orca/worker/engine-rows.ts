import { DefinitionNodes, Problems } from "../../../src/core/index.js"
import type { Connection } from "../../../src/host/connections/connection.js"
import type { DefinitionRow, EngineRow } from "../protocol.js"

const ENVIRONMENT_LABELS = {
  local: "LOCAL",
  test: "TEST",
  production: "PROD",
  unclassified: "",
} as const

export class EngineRows {
  static async of(connection: Connection, active: boolean): Promise<EngineRow> {
    const listed = await EngineRows.definitions(connection)
    const base = {
      name: connection.target.name,
      active,
      writable: connection.commands !== undefined,
      needsLogin: connection.target.auth.kind === "basic",
    }
    if ("problem" in listed) {
      return {
        ...base,
        description: EngineRows.describe(connection, connection.badge.host),
        problem: listed.problem,
        definitions: [],
      }
    }
    const withIncident = listed.rows.reduce((sum, row) => sum + row.withIncident, 0)
    return {
      ...base,
      description: EngineRows.describe(connection, `${withIncident} with incident`),
      definitions: listed.rows,
    }
  }

  private static async definitions(
    connection: Connection,
  ): Promise<
    | { readonly rows: readonly DefinitionRow[] }
    | { readonly problem: EngineRow["problem"] & object }
  > {
    try {
      const nodes = await new DefinitionNodes(connection.definitions).list()
      return {
        rows: nodes.map((node) => ({
          bpmnProcessId: node.bpmnProcessId,
          label: node.label,
          description:
            node.withIncident === 0
              ? node.description
              : `${node.withIncident} with incident · ${node.description}`,
          withIncident: node.withIncident,
        })),
      }
    } catch (error) {
      const problem = Problems.of(error, connection.badge)
      return {
        problem: {
          title: problem.title,
          detail: problem.detail,
          needsCredentials: problem.needsCredentials === true,
        },
      }
    }
  }

  private static describe(connection: Connection, detail: string): string {
    return [ENVIRONMENT_LABELS[connection.badge.environment], detail].filter(Boolean).join(" · ")
  }
}
