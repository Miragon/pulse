import type { z } from "zod"
import type { MCPServer } from "mcp-use"
import { withToolErrors } from "@miragon/mcp-toolkit-core/tools"
import type { LanguagePref } from "./profile-constants.js"
import { requireProfileKey } from "./profile-slice.js"
import { resolveAuthUserId, resolveProfileKey } from "./profile.js"
import { buildDataFeedResult, buildSingleWidgetView } from "./view-results.js"
import { appOnly, showToolBinding, strictToolInput } from "./widget-tool-bindings.js"

interface SettingsTool {
  name: string
  title: string
  description: string
}

export interface SettingsGate<TReason extends string> {
  canSave: boolean
  readOnlyReason?: "noSignIn" | TReason | null
}

interface LoadedSettings<TView extends object> {
  view: TView
  language?: LanguagePref
}

interface ViewText {
  title: string | undefined
  summary: string
}

interface SettingsSection<
  TView extends object,
  TShape extends z.ZodRawShape,
  TReason extends string,
> {
  app: string
  widget: string
  openWorldHint: boolean
  readOnlyReason?: TReason
  load: (
    ctx: unknown,
    key: string | undefined,
    gate: SettingsGate<TReason>,
  ) => Promise<LoadedSettings<TView>>
  show: SettingsTool & {
    render: (loaded: LoadedSettings<TView>, ctx: unknown) => ViewText | Promise<ViewText>
  }
  feed: SettingsTool
  save?: SettingsTool & {
    input: TShape
    annotations?: Record<string, boolean>
    write: (
      params: z.output<z.ZodObject<TShape>>,
      owner: { key: string; userId: string | undefined },
      ctx: unknown,
    ) => Promise<{ text: string; saved: object }>
  }
}

const SAVE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

/** The view tools report the save tool's presence as `canSave`, so no Save resolves to an unknown tool. */
export function registerSettingsSection<
  TView extends object,
  TShape extends z.ZodRawShape,
  TReason extends string = never,
>(server: MCPServer, section: SettingsSection<TView, TShape, TReason>): void {
  const { save } = section
  const gateFor = (key: string | undefined): SettingsGate<TReason> => {
    const canSave = save !== undefined && key !== undefined
    if (section.readOnlyReason === undefined) return { canSave }
    if (key === undefined) return { canSave, readOnlyReason: "noSignIn" }
    return { canSave, readOnlyReason: save ? null : section.readOnlyReason }
  }
  const load = (ctx: unknown) => {
    const key = resolveProfileKey(ctx)
    return section.load(ctx, key, gateFor(key))
  }
  const annotations = {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: section.openWorldHint,
  }
  const { render, ...show } = section.show

  server.tool(
    {
      ...show,
      annotations,
      inputSchema: strictToolInput({}),
      ...showToolBinding(show.name, show.title),
    },
    withToolErrors(async (_params, ctx) => {
      const loaded = await load(ctx)
      return buildSingleWidgetView({
        widget: section.widget,
        app: section.app,
        dataType: `${section.app}:settings`,
        data: { ...loaded.view },
        ...(await render(loaded, ctx)),
      })
    }),
  )

  server.tool(
    { ...section.feed, annotations, inputSchema: strictToolInput({}), ...appOnly },
    withToolErrors(async (_params, ctx) => {
      const view: object = (await load(ctx)).view
      return buildDataFeedResult({ ...view })
    }),
  )

  if (!save) return
  const { input, annotations: saveAnnotations = SAVE_ANNOTATIONS, write, ...saveTool } = save

  server.tool(
    { ...saveTool, annotations: saveAnnotations, inputSchema: strictToolInput(input) },
    withToolErrors(async (params, ctx) => {
      const owner = { key: requireProfileKey(ctx), userId: resolveAuthUserId(ctx) }
      const { text, saved } = await write(params as z.output<z.ZodObject<TShape>>, owner, ctx)
      return { content: [{ type: "text" as const, text }], structuredContent: { ...saved } }
    }),
  )
}
