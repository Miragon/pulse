import * as vscode from "vscode"
import type { Environment } from "@miragon/pulse-runtime-view/protocol"
import {
  LivePolicy,
  WritePolicy,
  type EnvironmentSettings,
  type WritesSetting,
} from "@miragon/pulse-runtime-view/host-kit"

type Scoped = Readonly<Record<string, unknown>>

export class PulseSettings {
  static environments(): EnvironmentSettings {
    const inspected = vscode.workspace.getConfiguration("pulse").inspect<Scoped>("environments")
    return {
      user: inspected?.globalValue,
      workspace: [inspected?.workspaceValue, inspected?.workspaceFolderValue],
    }
  }

  static writes(): WritesSetting {
    return WritePolicy.settingOf(
      vscode.workspace.getConfiguration("pulse").inspect("writes")?.globalValue,
    )
  }

  static liveUpdates(): unknown {
    return vscode.workspace.getConfiguration("pulse").inspect("liveUpdates")?.globalValue
  }

  static async turnOnLiveUpdates(environment: Environment): Promise<void> {
    const user = PulseSettings.liveUpdates()
    await vscode.workspace
      .getConfiguration("pulse")
      .update(
        "liveUpdates",
        LivePolicy.turnedOn(user, environment),
        vscode.ConfigurationTarget.Global,
      )
  }
}
