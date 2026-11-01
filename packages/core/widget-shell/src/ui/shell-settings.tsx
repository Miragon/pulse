import { useState } from "react"
import {
  Button,
  ErrorState,
  Skeleton,
  WidgetHeader,
  useLocale,
  NativeSelect,
  SettingsCard,
  SettingsField,
  useResetOnChange,
} from "@miragon/pulse-ui"
import { Lock } from "lucide-react"
import { LANGUAGES, explicitLocale, type LanguagePref } from "../profile-constants.js"
import {
  SHELL_SAVE_SETTINGS,
  SHELL_SETTINGS_DATA,
  SHELL_SHOW_SETTINGS,
  type ShellSettingsView,
} from "../shell-settings-contract.js"
import { useActionFeedback } from "./action-feedback.js"
import { modelContextText, type ModelContextSpec } from "./ask-ai-prompt.js"
import { classifyError } from "./describe-error.js"
import { HostWidgetSlot, settingsSections, useHostWidgets } from "./host-widgets.js"
import { QueryFallback } from "./query-fallback.js"
import { LANGUAGE_NAMES, settingsLabels } from "./settings-labels.js"
import { useToolMutation, useToolQuery } from "./tool-query.js"
import { HostModelContext } from "./view-host.js"
import type { ViewMap } from "./views.js"
import { WidgetShell } from "./widget-shell.js"

/** Shared with `ProfileGate`, so a saved language re-fetches ONE entry and every view switches live. */
export const SHELL_SETTINGS_KEY = ["shell:settings"] as const

/**
 * The settings page: the UI language, then every module's `<module>:settings` section from the
 * host widgets, in registration order. A crashing section never takes the page down (each slot
 * has its own error boundary). Every section fetches its own feed, the cockpit's settings route
 * included, so the page takes no view data.
 */
export function SettingsPage() {
  const labels = settingsLabels(useLocale())
  const sections = settingsSections(useHostWidgets())
  return (
    <WidgetShell>
      <WidgetHeader title={labels.pageTitle} sub={<span>{labels.pageSubtitle}</span>} />
      <div className="flex flex-col gap-4">
        <ShellSettingsWidget />
        {sections.map(([id]) => (
          <HostWidgetSlot key={id} id={id} />
        ))}
      </div>
    </WidgetShell>
  )
}

/** The shell's views: `shell_show_settings` renders the settings page. */
export const shellViews = { [SHELL_SHOW_SETTINGS]: SettingsPage } satisfies ViewMap

/** Hides itself when the feed TOOL is missing (a root that persists nothing); other failures stay with a retry. */
export function ShellSettingsWidget() {
  const labels = settingsLabels(useLocale())
  const query = useToolQuery<ShellSettingsView>([...SHELL_SETTINGS_KEY], SHELL_SETTINGS_DATA, {})
  const view = query.data ?? null
  if (view) return <LanguageSection view={view} />
  if (query.isError && classifyError(query.error).kind === "notOnServer") return null
  return (
    <WidgetShell>
      <QueryFallback
        isError={query.isError}
        error={query.error}
        errorTitle={labels.loadError}
        onRetry={() => void query.refetch()}
        skeleton={<Skeleton className="h-24 w-full rounded-md" />}
      />
    </WidgetShell>
  )
}

export function describeShellSettings(
  view: ShellSettingsView,
  language: LanguagePref,
): Omit<ModelContextSpec, "surface"> {
  return {
    summary: view.canSave
      ? "The user is on the settings page; the UI language can be changed here or via the save tool."
      : "The user is on the settings page; the UI language is read-only on this server.",
    facts: { language },
    // A literal list, so the app's hand-off guard can check every name.
    tools: ["shell_save_settings"],
  }
}

function LanguageSection({ view }: { view: ShellSettingsView }) {
  const labels = settingsLabels(useLocale())
  const feedback = useActionFeedback()
  const [language, setLanguage] = useState<LanguagePref>(view.language)
  // Server truth wins whenever it changes.
  useResetOnChange(view.language, () => setLanguage(view.language))
  const save = useToolMutation(SHELL_SAVE_SETTINGS, { invalidateKeys: [[...SHELL_SETTINGS_KEY]] })
  const dirty = language !== view.language

  function handleSave() {
    save.mutate(
      { language },
      {
        onSuccess: () => feedback.succeeded(labels.savedToast),
        onError: (error) => feedback.failed(labels.saveFailedToast, error),
      },
    )
  }

  const spec = describeShellSettings(view, language)
  return (
    <HostModelContext
      content={modelContextText({
        ...spec,
        surface: { has: (tool) => tool === SHELL_SAVE_SETTINGS && view.canSave },
      })}
    >
      <WidgetShell>
        <div className="flex flex-col gap-4">
          {!view.canSave && view.readOnlyReason && (
            <ErrorState
              variant="inline"
              tone="info"
              role="none"
              icon={Lock}
              title={labels.readOnlyTitle}
              description={labels.readOnly[view.readOnlyReason]}
            />
          )}
          <SettingsCard title={labels.languageSection} titleAs="h2">
            <SettingsField label={labels.language} help={labels.languageHelp}>
              <NativeSelect
                value={language}
                disabled={!view.canSave}
                onChange={(e) => {
                  const next = LANGUAGES.find((l) => l === e.target.value)
                  if (next) setLanguage(next)
                }}
              >
                {LANGUAGES.map((l) => {
                  const named = explicitLocale(l)
                  return (
                    <option key={l} value={l}>
                      {named ? LANGUAGE_NAMES[named] : labels.languageSystem}
                    </option>
                  )
                })}
              </NativeSelect>
            </SettingsField>
            {view.canSave && (
              <div>
                <Button size="sm" onClick={handleSave} disabled={!dirty || save.isPending}>
                  {save.isPending ? labels.saving : labels.save}
                </Button>
              </div>
            )}
          </SettingsCard>
        </div>
      </WidgetShell>
    </HostModelContext>
  )
}
