import { useRef, useState } from "react"
import {
  Alert,
  AlertDescription,
  Button,
  ErrorState,
  Skeleton,
  useToolMutation,
  useToolQuery,
} from "@miragon/mcp-toolkit-ui"
import { HostModelContext } from "@miragon/mcp-toolkit-ui/app"
import { Lock } from "lucide-react"
import {
  NativeSelect,
  QueryFallback,
  SettingsCard,
  SettingsField,
  SettingsInput,
  WidgetShell,
  formatPeriod,
  modelContextText,
  useActionFeedback,
  useResetOnChange,
} from "@miragon/pulse-widget-shell/widgets"
// The leaf, not the barrel: the barrel's value graph carries every tool's zod
// input schema, which a widget never needs (#344 K50).
import { PERIODS, type Period } from "@miragon/pulse-analytics-client/prometheus"
import { ANALYTICS_SAVE_SETTINGS, ANALYTICS_SETTINGS_DATA } from "../tool-names.js"
import { useT } from "../messages/use-t.js"
import { describeAnalyticsSettings } from "./model-descriptions.js"

/** Declared structurally so the widget bundle stays free of server-side imports. */
export interface AnalyticsSettingsViewData {
  settings: { defaultPeriod: Period; minBucketSize: number }
  canSave: boolean
}

/**
 * Hides itself when the feed tool is missing (module inactive, as `process-incidents/flow.tsx`);
 * any other failure stays visible.
 */
export function AnalyticsSettingsWidget({
  data: initialData = null,
}: {
  data?: AnalyticsSettingsViewData | null
}) {
  const t = useT()
  const query = useToolQuery<AnalyticsSettingsViewData>(
    ["analytics:settings"],
    ANALYTICS_SETTINGS_DATA,
    {},
    { enabled: !initialData },
  )
  const view = initialData ?? query.data ?? null

  if (!view) {
    if (query.isError) {
      const message = query.error instanceof Error ? query.error.message : String(query.error)
      // The unknown-tool rejection = module inactive → hide the section.
      if (message.includes(ANALYTICS_SETTINGS_DATA) && /not found/i.test(message)) return null
    }
    return (
      <WidgetShell>
        <QueryFallback
          isError={query.isError}
          error={query.error}
          errorTitle={t("aSettings.loadError")}
          onRetry={() => void query.refetch()}
          skeleton={<Skeleton className="h-24 w-full rounded-md" />}
        />
      </WidgetShell>
    )
  }

  return (
    <WidgetShell>
      <SettingsPanel view={view} />
    </WidgetShell>
  )
}

/** Raw form state — free typing, checked as you type and once more on save. */
interface FormState {
  defaultPeriod: Period
  minBucketSize: string
}

/** A whole number of 1 or more, else null: never clamped, an invalid entry is said to be wrong. */
export function parseMinBucketSize(raw: string): number | null {
  const text = raw.trim()
  if (!/^\d+$/.test(text)) return null
  const value = Number(text)
  return Number.isSafeInteger(value) && value >= 1 ? value : null
}

/** Above the fields (U25): the reader meets the reason before the fields it disables. */
function ReadOnlyNotice() {
  const t = useT()
  return (
    <ErrorState
      variant="inline"
      tone="info"
      role="none"
      icon={Lock}
      title={t("aSettings.readOnlyTitle")}
      description={t("aSettings.readOnly")}
    />
  )
}

function SettingsPanel({ view }: { view: AnalyticsSettingsViewData }) {
  const t = useT()
  // invalidateKeys: after a save the feed refetches, so a remounted section
  // seeds from the saved server truth instead of the stale cache entry.
  const save = useToolMutation(ANALYTICS_SAVE_SETTINGS, {
    invalidateKeys: [["analytics:settings"]],
  })
  const [form, setForm] = useState<FormState>({
    defaultPeriod: view.settings.defaultPeriod,
    minBucketSize: String(view.settings.minBucketSize),
  })
  const bucketRef = useRef<HTMLInputElement>(null)
  // The save confirms in a toast (the toolkit's polite live region), a
  // failure says why there too — and stays in the panel next to the entries.
  const feedback = useActionFeedback()
  const minBucketSize = parseMinBucketSize(form.minBucketSize)

  // Re-sync when server truth changes; the feed carries no updatedAt, so the values are the stamp.
  const settingsStamp = `${view.settings.defaultPeriod}|${view.settings.minBucketSize}`
  useResetOnChange(settingsStamp, () =>
    setForm({
      defaultPeriod: view.settings.defaultPeriod,
      minBucketSize: String(view.settings.minBucketSize),
    }),
  )

  function handleSave() {
    // An entry that is no valid size is never saved, and never corrected
    // behind your back: the field says what is wrong, the focus goes there.
    if (minBucketSize === null) {
      bucketRef.current?.focus()
      return
    }
    save.mutate(
      { defaultPeriod: form.defaultPeriod, minBucketSize },
      {
        onSuccess: () => feedback.succeeded(t("aSettings.savedToast")),
        onError: (error) => feedback.failed(t("aSettings.saveFailedToast"), error),
      },
    )
  }

  return (
    /* Inline (not via adaptDataWidget): the cockpit settings tab renders this
       widget without pipeline data, and only the mounted component knows the
       self-fetched view. HostModelContext renders its children unchanged. */
    <HostModelContext content={modelContextText(describeAnalyticsSettings(view))}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-section">{t("aSettings.heading")}</h2>
            <p className="text-muted-foreground text-small mt-1">{t("aSettings.subtitle")}</p>
          </div>
          {view.canSave && (
            <Button size="sm" onClick={handleSave} disabled={save.isPending}>
              {save.isPending ? t("aSettings.saving") : t("aSettings.save")}
            </Button>
          )}
        </div>

        {!view.canSave && <ReadOnlyNotice />}

        {save.isError && (
          <Alert variant="danger">
            <AlertDescription>
              {save.error?.message
                ? t("aSettings.saveFailed", { reason: save.error.message })
                : t("aSettings.saveError")}
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SettingsCard title={t("aSettings.section")}>
          <SettingsField label={t("aSettings.period")} help={t("aSettings.period.help")}>
            <NativeSelect
              value={form.defaultPeriod}
              disabled={!view.canSave}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  defaultPeriod: (PERIODS as readonly string[]).includes(e.target.value)
                    ? (e.target.value as Period)
                    : f.defaultPeriod,
                }))
              }
            >
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {formatPeriod(p)}
                </option>
              ))}
            </NativeSelect>
          </SettingsField>
          <SettingsField
            label={t("aSettings.minBucket")}
            help={t("aSettings.minBucket.help")}
            error={minBucketSize === null ? t("aSettings.minBucket.invalid") : undefined}
          >
            {/* Text, not `type="number"`: a browser empties a number field on a
                letter, and the entry you typed must stay to be corrected. */}
            <SettingsInput
              ref={bucketRef}
              type="text"
              inputMode="numeric"
              disabled={!view.canSave}
              value={form.minBucketSize}
              onChange={(e) => setForm((f) => ({ ...f, minBucketSize: e.target.value }))}
            />
          </SettingsField>
        </SettingsCard>
      </div>
    </HostModelContext>
  )
}
