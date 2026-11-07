import { basename } from "node:path"
import type { EngineAccess } from "../../core/protocol/index.js"
import type { Credentials } from "./connection.js"
import type { EngineTarget } from "./engine-target.js"
import { TargetHosts } from "./target-hosts.js"

export type WritesSetting = "localOnly" | "enabled" | "disabled"

const SETTINGS: ReadonlySet<unknown> = new Set<WritesSetting>(["localOnly", "enabled", "disabled"])

export class WritePolicy {
  static settingOf(userValue: unknown): WritesSetting {
    return SETTINGS.has(userValue) ? (userValue as WritesSetting) : "localOnly"
  }

  static access(
    target: EngineTarget,
    setting: WritesSetting,
    credentials: Credentials,
  ): EngineAccess {
    if (setting === "disabled") {
      return WritePolicy.denied("Writes are turned off with pulse.writes.")
    }
    if (target.readOnly === true) {
      return WritePolicy.denied(
        `${target.name} is a read-only profile in ${WritePolicy.fileOf(target)}.`,
      )
    }
    const loopback = TargetHosts.isLoopback(target)
    if (!loopback && setting === "localOnly") {
      return WritePolicy.denied(
        `Writes are on for engines on this machine (localhost) only. Set pulse.writes to "enabled" in your user settings to allow them on ${target.name}.`,
      )
    }
    if (!loopback && !(target.auth.kind === "basic" && credentials.kind === "basic")) {
      return WritePolicy.denied(
        `${target.name} needs a login before Pulse writes, so that the engine records who changed what.`,
      )
    }
    return {
      writable: true,
      note: `Pulse may retry incidents, change variables, move tokens, cancel and migrate instances on ${target.name}. Turn this off with pulse.writes.`,
    }
  }

  private static denied(note: string): EngineAccess {
    return { writable: false, note: `Read-only. ${note}` }
  }

  private static fileOf(target: EngineTarget): string {
    return target.source.kind === "file" ? basename(target.source.path) : "its project file"
  }
}
