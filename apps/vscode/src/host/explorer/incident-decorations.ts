import * as vscode from "vscode"

const SCHEME = "pulse-definition"
const ENGINE_SCHEME = "pulse-engine"
const MAX_BADGE = 9

export class IncidentDecorations implements vscode.FileDecorationProvider {
  static definitionUri(engine: string, bpmnProcessId: string, withIncident: number): vscode.Uri {
    return vscode.Uri.from({
      scheme: SCHEME,
      path: `/${encodeURIComponent(engine)}/${encodeURIComponent(bpmnProcessId)}`,
      query: `withIncident=${withIncident}`,
    })
  }

  static engineUri(engine: string, production: boolean): vscode.Uri {
    return vscode.Uri.from({
      scheme: ENGINE_SCHEME,
      path: `/${encodeURIComponent(engine)}`,
      query: `production=${production}`,
    })
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme === ENGINE_SCHEME) {
      return this.engineDecoration(uri)
    }
    if (uri.scheme !== SCHEME) {
      return undefined
    }
    const count = this.incidentCount(uri)
    if (count === 0) {
      return undefined
    }
    return new vscode.FileDecoration(
      count > MAX_BADGE ? `${MAX_BADGE}+` : String(count),
      `${count} running instance${count === 1 ? "" : "s"} with an incident, here or in a called instance`,
      new vscode.ThemeColor("list.errorForeground"),
    )
  }

  private engineDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    return new URLSearchParams(uri.query).get("production") === "true"
      ? new vscode.FileDecoration(
          "!",
          "Production engine",
          new vscode.ThemeColor("list.errorForeground"),
        )
      : undefined
  }

  private incidentCount(uri: vscode.Uri): number {
    return Number(new URLSearchParams(uri.query).get("withIncident") ?? "0")
  }
}
