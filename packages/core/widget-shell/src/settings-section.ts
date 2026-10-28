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

/**
 * Whether the caller can save: the module's write gate AND a caller identity.
 * `readOnlyReason` names the way out, the missing sign-in first; a section
 * that declares no reason reports none.
 */
export interface SettingsGate<TReason extends string> {
  canSave: boolean
  readOnlyReason?: "noSignIn" | TReason | null
}

/** A section's view, and the profile language its show tool words the result in. */
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
  /** Why a signed-in caller cannot save; omitted, the view carries no `readOnlyReason`. */
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
  /** The save tool, given only where the module's write gate allows it. */
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

/**
 * A module's `<module>:settings` section as its tool triple: the show tool,
 * its app-only feed and the save tool, which exists only where the module's
 * write gate allows it. The two view tools report that same decision as
 * `canSave`, so a section never offers a Save that would resolve to an unknown
 * tool. The save refuses a caller without identity and stamps the OAuth
 * caller as the record's owner.
 */
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
