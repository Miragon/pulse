import type { ProcessRuntime } from "@miragon/pulse-engine-core"
import { FakeEngine, FakeWorld, PatchedRuntime } from "@miragon/pulse-engine-core/testing"
import type { BoardReads, EngineSource } from "../../../src/builder/index.js"
import { BoardParser, type BoardDefinition } from "../../../src/index.js"

export interface CountedEngine {
  readonly source: EngineSource
  readonly calls: string[]
}

export class BuilderWorld {
  static world(patch: Partial<ProcessRuntime> = {}): ProcessRuntime {
    return new PatchedRuntime(new FakeEngine(FakeWorld.seed().state), patch)
  }

  static counted(name: string, runtime: ProcessRuntime): CountedEngine {
    const calls: string[] = []
    const reads = new Proxy(runtime, {
      get(target, property, receiver) {
        const value: unknown = Reflect.get(target, property, receiver)
        if (typeof value !== "function") {
          return value
        }
        return (...args: unknown[]) => {
          calls.push(String(property))
          return (value as (...parameters: unknown[]) => unknown).apply(target, args)
        }
      },
    }) satisfies BoardReads
    return { source: { name, reads }, calls }
  }

  static board(widgets: readonly unknown[], engines: readonly string[]): BoardDefinition {
    const parsed = BoardParser.parse(
      JSON.stringify({
        title: "Orders",
        engines,
        rows: widgets.map((widget) => ({ row: [widget] })),
      }),
    )
    if ("problems" in parsed) {
      throw new Error(JSON.stringify(parsed.problems))
    }
    return parsed.board
  }
}
