import { Present } from "../present.js"
import { EngineCliFailure } from "../engine-cli-failure.js"
import { JsonObject } from "../views/json-object.js"
import { LosslessJson } from "../views/lossless-json.js"
import type { EngineCliExit } from "./engine-cli-spawner.js"

const MAX_MESSAGE_LENGTH = 500

export class EngineCliErrorLine {
  static failureOf(exit: EngineCliExit): EngineCliFailure {
    const error = EngineCliErrorLine.reportedIn(exit.stderr)
    if (error === undefined) {
      const message = exit.stderr.trim().slice(0, MAX_MESSAGE_LENGTH) || "the engine CLI failed"
      return new EngineCliFailure(message, { code: "CLI_FAILED", exitCode: exit.exitCode })
    }
    return new EngineCliFailure(error.optionalString("message") ?? "the engine CLI failed", {
      code: error.optionalString("code") ?? "UNKNOWN",
      exitCode: error.optionalNumber("exitCode") ?? exit.exitCode,
      ...Present.fields({
        status: error.optionalNumber("status"),
        engineType: error.optionalString("engineType"),
        hint: error.optionalString("hint"),
      }),
    })
  }

  private static reportedIn(stderr: string): JsonObject | undefined {
    const trimmed = stderr.trim()
    const candidates = [trimmed, ...trimmed.split(/\r?\n/).reverse()]
    for (const candidate of candidates) {
      const reported = EngineCliErrorLine.reportedErrorOf(candidate)
      if (reported !== undefined) {
        return reported
      }
    }
    return undefined
  }

  private static reportedErrorOf(candidate: string): JsonObject | undefined {
    try {
      const line = JsonObject.ifObject(LosslessJson.parse(candidate))
      return line === undefined ? undefined : JsonObject.ifObject(line.value("error"))
    } catch {
      return undefined
    }
  }
}
