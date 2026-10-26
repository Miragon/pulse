import { InstanceId, type InstanceSummary } from "../../contract/index.js"
import { Labels, Problems } from "../../core/index.js"
import * as vscode from "vscode"
import type { Connection } from "../connections/connection.js"
import type { ConnectionRegistry } from "../connections/connection-registry.js"
import { NotificationText } from "../notification-text.js"
import type { PanelManager } from "../panels/panel-manager.js"
import type { Command } from "./command.js"
import { COMMAND } from "./command-ids.js"

const MATCH_LIMIT = 20
const LOOKS_LIKE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^\d{10,}$/i

interface InstancePick extends vscode.QuickPickItem {
  readonly instanceId: InstanceId
}

export class GoToInstanceCommand implements Command {
  readonly id = COMMAND.goToInstance

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly panels: PanelManager,
  ) {}

  async run(): Promise<void> {
    const connection = this.registry.active()
    if (connection === undefined) {
      return
    }
    const query = await vscode.window.showInputBox({
      title: `Go to Process Instance on ${connection.target.name}`,
      prompt: "Instance ID or business key",
      value: await this.clipboardSuggestion(),
    })
    const trimmed = query?.trim() ?? ""
    if (trimmed === "") {
      return
    }
    try {
      await this.openFound(connection, trimmed, await this.findInstances(connection, trimmed))
    } catch (error) {
      const problem = Problems.of(error, connection.badge)
      void vscode.window.showErrorMessage(
        NotificationText.withoutLinks(`${problem.title} ${problem.detail}`),
      )
    }
  }

  private async clipboardSuggestion(): Promise<string> {
    const text = (await vscode.env.clipboard.readText()).trim()
    return LOOKS_LIKE_ID.test(text) ? text : ""
  }

  private async findInstances(connection: Connection, query: string): Promise<InstancePick[]> {
    const direct = await connection.runtime.getInstanceDetail(InstanceId(query))
    if (direct !== undefined) {
      return [this.pickOf(direct.instance, connection)]
    }
    const page = await connection.runtime.searchInstances(
      { businessKey: query },
      { limit: MATCH_LIMIT },
    )
    return page.items.map((instance) => this.pickOf(instance, connection))
  }

  private pickOf(instance: InstanceSummary, connection: Connection): InstancePick {
    const definition = instance.definition
    return {
      label: instance.businessKey ?? Labels.shortId(instance.id),
      description: `${definition.name ?? definition.bpmnProcessId} v${definition.version}`,
      detail: `${instance.state} · ${connection.target.name} · ${instance.id}`,
      instanceId: instance.id,
    }
  }

  private async openFound(
    connection: Connection,
    query: string,
    found: readonly InstancePick[],
  ): Promise<void> {
    const [first] = found
    if (first === undefined) {
      void vscode.window.showInformationMessage(
        NotificationText.withoutLinks(
          `No instance with the ID or business key "${query}" on ${connection.target.name}.`,
        ),
      )
      return
    }
    const picked =
      found.length === 1
        ? first
        : await vscode.window.showQuickPick(found, {
            title: `${found.length} instances with the business key "${query}"`,
          })
    if (picked !== undefined) {
      this.panels.openInstance(connection, picked.instanceId)
    }
  }
}
