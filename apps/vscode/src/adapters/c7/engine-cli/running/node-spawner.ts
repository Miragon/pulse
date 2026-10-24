import { execFile, type ExecFileException } from "node:child_process"
import type { EngineCliExit, EngineCliInvocation, EngineCliSpawner } from "./engine-cli-spawner.js"

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

export class NodeSpawner implements EngineCliSpawner {
  spawn(invocation: EngineCliInvocation): Promise<EngineCliExit> {
    return new Promise((resolve) => {
      const child = execFile(
        invocation.command,
        [...invocation.args],
        {
          env: invocation.environment,
          timeout: invocation.timeoutMs,
          maxBuffer: MAX_OUTPUT_BYTES,
          encoding: "utf8",
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          resolve(this.exitOf(error, stdout, stderr))
        },
      )
      child.stdin?.end(invocation.input ?? "")
    })
  }

  private exitOf(error: ExecFileException | null, stdout: string, stderr: string): EngineCliExit {
    return {
      exitCode: this.exitCodeOf(error),
      timedOut: error?.killed === true,
      stdout,
      stderr: error !== null && stderr === "" ? error.message : stderr,
    }
  }

  private exitCodeOf(error: ExecFileException | null): number | null {
    if (error === null) {
      return 0
    }
    return typeof error.code === "number" ? error.code : null
  }
}
