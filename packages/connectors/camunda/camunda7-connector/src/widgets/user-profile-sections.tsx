import { useId } from "react"
import { Button, ErrorState, Switch } from "@miragon/mcp-toolkit-ui"
import { NativeSelect, SettingsCard, SettingsField } from "@miragon/pulse-widget-shell/widgets"

import { groupEnginesByEnvironment } from "../lib/environments.js"
import type { ProfileReadOnlyReason, UserProfileView } from "../lib/profile-schema.js"
import { useT } from "../messages/use-t.js"
import { allowedIn, type DashboardSummary, type FormState } from "./user-profile-form.js"

const helpCls = "text-muted-foreground text-small"

// #322 U25: on top with the way out, not a line under fields that already look disabled.
export function ReadOnlyNotice({ reason }: { reason: ProfileReadOnlyReason }) {
  const t = useT()
  return (
    <ErrorState
      variant="inline"
      tone="info"
      role="status"
      title={t("profile.readOnly.title")}
      description={t(`profile.readOnly.${reason}`)}
    />
  )
}

// #322 U25: one save bar under all cards; a failure stays here. A read-only panel shows the notice instead.
export function SaveBar({
  dirty,
  pending,
  invalid,
  error,
  onSave,
  onDiscard,
}: {
  dirty: boolean
  pending: boolean
  invalid: boolean
  error: string | null
  onSave: () => void
  onDiscard: () => void
}) {
  const t = useT()
  return (
    <div
      role="region"
      aria-label={t("profile.saveBar.label")}
      className="border-border bg-card shadow-2 sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
    >
      <div className="flex min-w-0 flex-col" aria-live="polite">
        <span className="text-foreground text-dense font-semibold">
          {dirty ? t("profile.saveBar.unsaved") : t("profile.saveBar.clean")}
        </span>
        {dirty && error !== null && (
          <span role="alert" className="text-danger-ink text-small">
            {t("profile.saveError")}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {dirty && (
          <Button type="button" variant="outline" size="sm" onClick={onDiscard} disabled={pending}>
            {t("profile.discard")}
          </Button>
        )}
        <Button type="button" size="sm" onClick={onSave} disabled={!dirty || pending || invalid}>
          {pending ? t("profile.saving") : t("profile.save")}
        </Button>
      </div>
    </div>
  )
}

export function DashboardsCardBody({
  unavailable,
  dashboards,
  form,
  canSave,
  onSetDefault,
  onTogglePinned,
}: {
  unavailable: boolean
  dashboards: DashboardSummary[]
  form: Pick<FormState, "defaultDashboardId" | "pinnedDashboardIds">
  canSave: boolean
  onSetDefault: (id: string) => void
  onTogglePinned: (id: string, on: boolean) => void
}) {
  const t = useT()
  if (unavailable) {
    return <span className={helpCls}>{t("profile.dashboards.unavailable")}</span>
  }
  if (dashboards.length === 0) {
    return <span className={helpCls}>{t("profile.dashboards.empty")}</span>
  }
  return (
    <>
      <SettingsField
        label={t("profile.field.defaultDashboard")}
        help={t("profile.field.defaultDashboard.help")}
      >
        <NativeSelect
          value={form.defaultDashboardId}
          disabled={!canSave}
          onChange={(e) => onSetDefault(e.target.value)}
        >
          <option value="">{t("profile.dashboard.none")}</option>
          {dashboards.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title ?? d.name}
            </option>
          ))}
        </NativeSelect>
      </SettingsField>
      <SettingsField
        label={t("profile.field.pinnedDashboards")}
        help={t("profile.field.pinnedDashboards.help")}
        group
      >
        <div className="flex flex-col gap-1.5">
          {dashboards.map((d) => (
            <label key={d.id} className="text-dense flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.pinnedDashboardIds.includes(d.id)}
                disabled={!canSave}
                onChange={(ev) => onTogglePinned(d.id, ev.target.checked)}
              />
              <span>{d.title ?? d.name}</span>
            </label>
          ))}
        </div>
      </SettingsField>
    </>
  )
}

// #322 U25: a switch instead of the inverted "uncheck all to allow every engine".
export function EnginesCard({
  view,
  form,
  canSave,
  onAllEngines,
  onToggleEngine,
  onDefaultEngine,
}: {
  view: UserProfileView
  form: FormState
  canSave: boolean
  onAllEngines: (on: boolean) => void
  onToggleEngine: (id: string, on: boolean) => void
  onDefaultEngine: (id: string) => void
}) {
  const t = useT()
  const errorId = useId()
  const engines = view.availableEngines
  const engineIds = engines.map((e) => e.id)
  const engineGroups = groupEnginesByEnvironment(engines)
  const allowed = allowedIn(form, engineIds)
  const noneChosen = !form.allEngines && form.allowedEngineIds.length === 0
  return (
    <SettingsCard title={t("profile.section.engines")}>
      {engines.length === 0 ? (
        <span className={helpCls}>{t("profile.engines.none")}</span>
      ) : (
        <>
          <SettingsField
            label={t("profile.field.allEngines")}
            help={t("profile.field.allEngines.help")}
          >
            <Switch checked={form.allEngines} disabled={!canSave} onCheckedChange={onAllEngines} />
          </SettingsField>
          {!form.allEngines && (
            <SettingsField
              label={t("profile.field.allowedEngines")}
              help={t("profile.field.allowedEngines.help")}
              group
            >
              <div
                className="flex flex-col gap-1.5"
                aria-invalid={noneChosen || undefined}
                aria-describedby={noneChosen ? errorId : undefined}
              >
                {/* The environment→engine map: checkboxes group under their
                    environment (flat when only one environment is configured). */}
                {engineGroups.map((g) => (
                  <div key={g.id} className="flex flex-col gap-1.5">
                    {engineGroups.length > 1 && (
                      <span className="text-muted-foreground text-small font-semibold tracking-wide uppercase">
                        {g.id}
                      </span>
                    )}
                    {g.engines.map((e) => (
                      <label key={e.id} className="text-dense flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="accent-primary size-4"
                          checked={form.allowedEngineIds.includes(e.id)}
                          disabled={!canSave}
                          onChange={(ev) => onToggleEngine(e.id, ev.target.checked)}
                        />
                        <span className="font-mono">{e.id}</span>
                      </label>
                    ))}
                  </div>
                ))}
                {noneChosen && (
                  <span id={errorId} role="alert" className="text-danger-ink text-small">
                    {t("profile.engines.noneChosen")}
                  </span>
                )}
              </div>
            </SettingsField>
          )}
        </>
      )}
      <SettingsField
        label={t("profile.field.defaultEngine")}
        help={t("profile.field.defaultEngine.help")}
      >
        <NativeSelect
          value={form.defaultEngineId}
          disabled={!canSave}
          onChange={(e) => onDefaultEngine(e.target.value)}
        >
          <option value="">{t("profile.engine.auto")}</option>
          {engineGroups.map((g) => {
            const options = g.engines
              .filter((e) => allowed.includes(e.id))
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.id}
                </option>
              ))
            if (options.length === 0) return null
            return engineGroups.length > 1 ? (
              <optgroup key={g.id} label={g.id.toUpperCase()}>
                {options}
              </optgroup>
            ) : (
              options
            )
          })}
        </NativeSelect>
      </SettingsField>
    </SettingsCard>
  )
}
