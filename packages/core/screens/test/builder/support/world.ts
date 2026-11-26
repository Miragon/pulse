import {
  BpmnProcessId,
  DefinitionId,
  type DefinitionSummary,
  type ProcessRuntime,
} from "@miragon/pulse-engine-core"
import { FakeEngine, FakeWorld, PatchedRuntime } from "@miragon/pulse-engine-core/testing"
import type { EngineScreenReads } from "../../../src/builder/index.js"

export interface CountedReads {
  readonly reads: EngineScreenReads
  readonly calls: string[]
}

export class ScreenWorld {
  static readonly AS_OF = new Date("2026-11-19T09:00:00.000Z")

  static world(patch: Partial<ProcessRuntime> = {}): ProcessRuntime {
    return new PatchedRuntime(new FakeEngine(FakeWorld.seed().state), patch)
  }

  static counted(runtime: ProcessRuntime): CountedReads {
    const calls: string[] = []
    const count =
      <Value>(name: string, read: () => Promise<Value>) =>
      (): Promise<Value> => {
        calls.push(name)
        return read()
      }
    return {
      reads: {
        describeEngine: count("describeEngine", () => runtime.describeEngine()),
        listDefinitions: count("listDefinitions", () => runtime.listDefinitions()),
      },
      calls,
    }
  }

  static summary(
    bpmnProcessId: string,
    counts: {
      readonly running: number
      readonly withIncident: number
      readonly incidents?: number
      readonly incidentsAtLeast?: true
    },
    name?: string,
  ): DefinitionSummary {
    return {
      latest: {
        id: DefinitionId(`${bpmnProcessId}:4`),
        bpmnProcessId: BpmnProcessId(bpmnProcessId),
        version: 4,
        ...(name === undefined ? {} : { name }),
      },
      incidents: 0,
      ...counts,
    }
  }
}
