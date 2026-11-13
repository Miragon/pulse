import { readFile } from "node:fs/promises"
import { basename } from "node:path"
import { BpmnProcessId, DefinitionId, InstanceId } from "@miragon/pulse-engine-core"
import {
  DefinitionPanel,
  EnginePanel,
  InstancePanel,
  MigrationPanel,
  type DefinitionTarget,
  type MigrationTarget,
} from "@miragon/pulse-runtime-view/core"
import type { ViewSpec } from "../protocol.js"
import type { PanelFactory } from "./cockpit-view.js"

type DefinitionSpec = Extract<ViewSpec, { view: "definition" }>

export class PanelFactories {
  static async of(
    spec: ViewSpec,
    migration: MigrationTarget | undefined,
  ): Promise<PanelFactory | string> {
    switch (spec.view) {
      case "engine":
        return (context) => new EnginePanel(context)
      case "instance":
        return (context) => new InstancePanel(context, InstanceId(spec.instanceId))
      case "definition":
        return (context) => new DefinitionPanel(context, PanelFactories.definitionTarget(spec))
      case "migration":
        return migration === undefined
          ? "This migration is no longer open. Start it again from the process definition."
          : (context) => new MigrationPanel(context, migration)
      case "model":
        return PanelFactories.model(spec.bpmnProcessId, spec.modelPath)
    }
  }

  private static async model(
    bpmnProcessId: string,
    modelPath: string,
  ): Promise<PanelFactory | string> {
    const xml = await readFile(modelPath, "utf8").catch(() => undefined)
    if (xml === undefined) {
      return `Pulse can't read ${modelPath}.`
    }
    const localModel = { fileName: basename(modelPath), xml }
    return (context) =>
      new DefinitionPanel(context, { bpmnProcessId: BpmnProcessId(bpmnProcessId), localModel })
  }

  private static definitionTarget(spec: DefinitionSpec): DefinitionTarget {
    return {
      bpmnProcessId: BpmnProcessId(spec.bpmnProcessId),
      ...(spec.definitionId === undefined ? {} : { definitionId: DefinitionId(spec.definitionId) }),
      ...(spec.filter === undefined ? {} : { filter: spec.filter }),
    }
  }
}
