import { useState } from "react"
import { useToolQuery } from "@miragon/mcp-toolkit-ui"
import {
  SettingsCard,
  WidgetShell,
  classifyError,
  useDetailView,
  useResetOnChange,
} from "@miragon/pulse-widget-shell/widgets"

import { CAMUNDA7_SAVE_SETTINGS, CAMUNDA7_SETTINGS_DATA } from "../tool-names.js"
import type { UserProfileView } from "../lib/profile-schema.js"
import { useT } from "../messages/use-t.js"
import { useEngineAction } from "./lib/engine-action.js"
import { writeFeedback } from "./lib/write-feedback.js"
import { ProfileModelContext } from "./user-profile-context.js"
import {
  allowedIn,
  changedPreferences,
  fromProfile,
  isDirty,
  pickableDashboards,
  type DashboardSummary,
  type FormState,
} from "./user-profile-form.js"
import {
  DashboardsCardBody,
  EnginesCard,
  ReadOnlyNotice,
  SaveBar,
} from "./user-profile-sections.js"

// Bundled but not active, the feed's tool is missing and the section hides itself.
export function UserProfileWidget({ data: initialData = null }: { data?: UserProfileView | null }) {
  const t = useT()
  const {
    data: view,
    guard,
    loadError,
  } = useDetailView<UserProfileView>({
    initialData,
    key: ["camunda7:settings"],
    tool: CAMUNDA7_SETTINGS_DATA,
    args: {},
    ready: true,
    loadingText: t("profile.loading"),
    emptyText: t("profile.none"),
    retryText: t("viewState.retry"),
  })

  if (!view) return loadError && classifyError(loadError).kind === "notOnServer" ? null : guard

  return (
    <WidgetShell>
      <ProfilePanel view={view} />
    </WidgetShell>
  )
}

// #322 U27: the page's one title is the shell's; this section heads itself with h2, its cards h3.
function ProfilePanel({ view }: { view: UserProfileView }) {
  const t = useT()
  const dashboardsQuery = useToolQuery<{ items: DashboardSummary[] }>(
    ["dashboards"],
    "list-dashboards",
    {},
  )
  const dashboards = pickableDashboards(
    dashboardsQuery.data?.items ?? [],
    view.profile.pinnedDashboardIds ?? [],
  )

  // Read-only deployments never register camunda7_save_settings; the view knows the caller, so
  // `canSave` gates the save, not the engine-write feed.
  const canSave = view.canSave
  const save = useEngineAction<Record<string, unknown>>({
    tool: CAMUNDA7_SAVE_SETTINGS,
    allowed: canSave,
  })
  const engineIds = view.availableEngines.map((e) => e.id)
  const viewForm = () => fromProfile(view.profile, engineIds)
  // Advanced after each save, so reverting a saved change is a change even before the refetch.
  const [baseline, setBaseline] = useState<FormState>(viewForm)
  const [form, setForm] = useState<FormState>(baseline)

  useResetOnChange(view.profile.updatedAt, () => {
    const next = viewForm()
    setBaseline(next)
    setForm(next)
  })

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  function toggleEngine(id: string, on: boolean) {
    setForm((f) => {
      const next = on
        ? Array.from(new Set([...f.allowedEngineIds, id]))
        : f.allowedEngineIds.filter((e) => e !== id)
      // Never persist an unreachable default.
      const defaultEngineId = next.includes(f.defaultEngineId) ? f.defaultEngineId : ""
      return { ...f, allowedEngineIds: next, defaultEngineId }
    })
  }

  function setAllEngines(on: boolean) {
    setForm((f) => {
      // Switched off with nothing curated yet: start from every engine checked.
      const allowedEngineIds = on || f.allowedEngineIds.length > 0 ? f.allowedEngineIds : engineIds
      return { ...f, allEngines: on, allowedEngineIds }
    })
  }

  function togglePinned(id: string, on: boolean) {
    setForm((f) => {
      const next = on
        ? Array.from(new Set([...f.pinnedDashboardIds, id]))
        : f.pinnedDashboardIds.filter((d) => d !== id)
      return { ...f, pinnedDashboardIds: next }
    })
  }

  function handleSave() {
    const submitted = form
    save.run(changedPreferences(submitted, baseline, engineIds), {
      feedback: writeFeedback.settings(t),
      onSuccess: () => setBaseline(submitted),
    })
  }

  const allowed = allowedIn(form, engineIds)
  const allEnginesAllowed = form.allEngines || allowed.length >= engineIds.length
  const invalid = !form.allEngines && form.allowedEngineIds.length === 0
  const dirty = isDirty(form, baseline, engineIds)

  return (
    <>
      <ProfileModelContext
        form={{ ...form, allowedEngineIds: allowed }}
        canSave={canSave}
        allEnginesAllowed={allEnginesAllowed}
        dashboardsAnswered={dashboardsQuery.isSuccess}
      />

      <div>
        <h2 className="text-section">{t("profile.heading")}</h2>
        <p className="text-muted-foreground text-small mt-1">{t("profile.subtitle")}</p>
      </div>

      {!canSave && view.readOnlyReason && <ReadOnlyNotice reason={view.readOnlyReason} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <EnginesCard
          view={view}
          form={form}
          canSave={canSave}
          onAllEngines={setAllEngines}
          onToggleEngine={toggleEngine}
          onDefaultEngine={(id) => set("defaultEngineId", id)}
        />

        <SettingsCard title={t("profile.section.dashboards")}>
          <DashboardsCardBody
            unavailable={dashboardsQuery.isError}
            dashboards={dashboards}
            form={form}
            canSave={canSave}
            onSetDefault={(id) => set("defaultDashboardId", id)}
            onTogglePinned={togglePinned}
          />
        </SettingsCard>
      </div>

      {save.allowed && (
        <SaveBar
          dirty={dirty}
          pending={save.pending()}
          invalid={invalid}
          error={save.error()}
          onSave={handleSave}
          onDiscard={() => setForm(baseline)}
        />
      )}
    </>
  )
}
