import { EngineCliFailure } from "../engine-cli-failure.js"
import { EngineCliOutputError } from "../engine-cli-output-error.js"
import { LosslessJson } from "../views/lossless-json.js"
import { NodeSpawner } from "./node-spawner.js"
import {
  EngineCliEnvironment,
  type Environment,
  type EngineCliAccess,
  type EngineCliConnection,
} from "./engine-cli-environment.js"
import { EngineCliErrorLine } from "./engine-cli-error-line.js"
import type { EngineCliSpawner } from "./engine-cli-spawner.js"

export interface EngineCliRunnerOptions {
  readonly cliPath: string
  readonly connection: EngineCliConnection
  readonly timeoutMs?: number
  readonly spawner?: EngineCliSpawner
  readonly nodePath?: string
  readonly baseEnvironment?: Environment
}

interface EngineCliLaunch {
  readonly command: string
  readonly cliPath: string
  readonly environment: Readonly<Record<string, string>>
  readonly timeoutMs: number
}

const DEFAULT_TIMEOUT_MS = 60_000

export class EngineCliRunner {
  constructor(
    private readonly spawner: EngineCliSpawner,
    private readonly launch: EngineCliLaunch,
  ) {}

  static create(
    options: EngineCliRunnerOptions,
    access: EngineCliAccess = "read",
  ): EngineCliRunner {
    return new EngineCliRunner(options.spawner ?? new NodeSpawner(), {
      command: options.nodePath ?? process.execPath,
      cliPath: options.cliPath,
      environment: EngineCliEnvironment.of(
        options.connection,
        options.baseEnvironment ?? process.env,
        access,
      ),
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })
  }

  async text(args: readonly string[], input?: string): Promise<string> {
    const exit = await this.spawner.spawn({
      command: this.launch.command,
      args: [this.launch.cliPath, ...args],
      environment: this.launch.environment,
      timeoutMs: this.launch.timeoutMs,
      ...(input === undefined ? {} : { input }),
    })
    if (exit.timedOut) {
      throw this.timedOut()
    }
    if (exit.exitCode !== 0) {
      throw EngineCliErrorLine.failureOf(exit)
    }
    return exit.stdout
  }

  async json(args: readonly string[], input?: string): Promise<unknown> {
    return this.parsed(await this.text(args, input))
  }

  private timedOut(): EngineCliFailure {
    return new EngineCliFailure(
      `the engine CLI did not answer within ${this.launch.timeoutMs} ms`,
      {
        code: "TIMEOUT",
        exitCode: null,
      },
    )
  }

  private parsed(stdout: string): unknown {
    try {
      return LosslessJson.parse(stdout)
    } catch (error: unknown) {
      throw new EngineCliOutputError(`the engine CLI printed no JSON: ${String(error)}`)
    }
  }
}
