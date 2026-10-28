import { z } from "zod"
import {
  parseModuleSlice,
  withoutDefaults,
  type ProfileRecord,
} from "@miragon/pulse-widget-shell/server"

export const CAMUNDA7_MODULE_KEY = "camunda7"

/** The cross-module `language` lives on the record itself and belongs to the shell. */
export const camunda7SettingsSchema = z.object({
  defaultEngineId: z
    .string()
    .optional()
    .describe(
      "Default engine: operations tools route here when no per-call `engine` override is given, and the cockpit lands on it. Saved via the settings page or camunda7_select_engine.",
    ),
  allowedEngineIds: z
    .array(z.string())
    .optional()
    .describe(
      "Engine ids the user may pick from. Omitted or empty = all configured engines. Curation, not a security boundary — an explicit per-call `engine` override still reaches any configured engine.",
    ),
  pinnedDashboardIds: z
    .array(z.string())
    .default([])
    .describe("Saved-dashboard ids the user pinned, shown first in dashboard pickers."),
  defaultDashboardId: z
    .string()
    .optional()
    .describe(
      "Saved-dashboard id suggested as the user's default — surfaced to the model (open via load-dashboard) and to pickers; the cockpit has no dashboards surface yet.",
    ),
})

export type Camunda7Settings = z.infer<typeof camunda7SettingsSchema>

/** Fail-soft per FIELD: one bad value a newer build wrote can't reset its neighbours; retired keys stay inert. */
export function parseCamunda7Settings(
  record: { modules?: Record<string, unknown> } | undefined,
): Camunda7Settings {
  return parseModuleSlice(camunda7SettingsSchema, record?.modules?.[CAMUNDA7_MODULE_KEY])
}

/** Read-side projection; the stored shape is the shell's `ProfileRecord`. */
export interface UserProfile extends Camunda7Settings {
  /** The widget's baseline-resync key after a save. */
  updatedAt: string
}

export function toUserProfile(record: ProfileRecord): UserProfile {
  return { updatedAt: record.updatedAt, ...parseCamunda7Settings(record) }
}

export function defaultUserProfile(): UserProfile {
  return { updatedAt: new Date().toISOString(), ...camunda7SettingsSchema.parse({}) }
}

/** Default-free: zod 4 re-applies `.default()`s through `.partial()` as silent resets. No `modules` passthrough: foreign slices save through their own module. */
export const userProfileToolSaveInput = z
  .object(withoutDefaults(camunda7SettingsSchema.shape))
  .partial()

/** Carries the FULL engine list: `camunda7_list_engines` is already filtered by `allowedEngineIds`. */
export interface UserProfileView {
  profile: UserProfile
  availableEngines: Array<{ id: string; environment: string }>
  canSave: boolean
  /** `noSignIn`: no OAuth caller to save for; `toolset`: no profile writes on this toolset (#322 U25). */
  readOnlyReason: ProfileReadOnlyReason | null
}

/** Why the settings section cannot save — see {@link UserProfileView.readOnlyReason}. */
export type ProfileReadOnlyReason = "noSignIn" | "toolset"
