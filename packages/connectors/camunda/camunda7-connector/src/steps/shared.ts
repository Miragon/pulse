import type {
  OptionalKeyDeclaration,
  PipelineContext,
  PipelineStepDefinition,
} from "@miragon/mcp-toolkit-core"
import { resolveStepEngine, type Camunda7StepAppConfig } from "../lib/resolve-engine.js"
import { builderText } from "../builder-texts.js"

/** Declared so render-view can discover it. */
const ENGINE_KEY: OptionalKeyDeclaration = {
  key: "camunda7:engine",
  description:
    "Engine id to read from (one of camunda7_list_engines). Omitted → the caller's saved default engine, or the only configured engine; required when several are configured and none is saved.",
}

type StepEngine = Awaited<ReturnType<typeof resolveStepEngine>>

interface AdapterStep<TData> {
  name: string
  description: string
  dataType: string
  requires?: string[]
  optionalKeys?: OptionalKeyDeclaration[]
  produces: Record<string, (data: NoInfer<TData>) => unknown>
  read: (context: PipelineContext, engine: StepEngine) => Promise<TData>
}

/** A builder error propagates, so a step never returns a success-shaped empty payload. */
export function adapterStep<TData>(
  step: AdapterStep<TData>,
): PipelineStepDefinition<Camunda7StepAppConfig> {
  return {
    id: `camunda7:${step.name}`,
    ...builderText(`step.${step.name}`),
    description: step.description,
    dataType: step.dataType,
    requires: step.requires ?? [],
    optionalKeys: [ENGINE_KEY, ...(step.optionalKeys ?? [])],
    produces: Object.keys(step.produces),
    execute: async (context, appConfig) => {
      const engineOverride = context.keys["camunda7:engine"] as string | undefined
      const data = await step.read(context, await resolveStepEngine(appConfig, engineOverride))
      const keys = Object.fromEntries(
        Object.entries(step.produces).map(([key, select]) => [key, select(data)]),
      )
      return { data, keys, _app: "camunda7", _step: step.name }
    },
  }
}

export function stringKey(context: PipelineContext, key: string): string | undefined {
  const value = context.keys[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/** `requires` gates the step; this keeps the type honest. */
export function requiredKey(context: PipelineContext, key: string): string {
  const value = stringKey(context, key)
  if (value === undefined) throw new Error(`Missing required view key \`${key}\`.`)
  return value
}
