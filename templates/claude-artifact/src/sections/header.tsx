import { Button, Icon, StatusStrip, VersionChip, WidgetHeader, useLocale } from "@miragon/pulse-ui"
import { FreshnessStamp } from "@miragon/pulse-widget-shell/widgets"
import { RefreshCw } from "lucide-react"
import { readHeader } from "../data/process-dashboard.ts"
import { describeEngineError } from "../engine/errors.ts"
import { useEngine, useSection } from "../engine/use-engine.tsx"
import { useT } from "../messages.ts"
import { processNameOf } from "./names.ts"

/**
 * The page's bar: the process's name from its diagram (else its key) with its latest version, the
 * key and the engine as facts, the Refresh, and when the numbers on the page were read (the oldest
 * read of the sections that show data). A degraded read (the process missing, the header's read
 * failing) is its strip under the bar. A plain wrapper, since the bar is the page's one banner.
 */
export function HeaderSection({ processKey }: { readonly processKey: string }) {
  const t = useT()
  const locale = useLocale()
  const { readAt, refresh } = useEngine()
  const section = useSection((engine) => readHeader(engine, processKey), [processKey])
  const process = section.data
  const failure =
    section.error === undefined ? undefined : describeEngineError(section.error, locale)
  return (
    <div className="bg-card">
      <WidgetHeader
        title={processNameOf(process?.xml, processKey)}
        titleSuffix={process?.latest ? <VersionChip version={process.latest.version} /> : undefined}
        sub={
          <>
            <span className="font-mono">{processKey}</span>
            {process && (
              <>
                <span className="text-muted-foreground">·</span>
                <span>
                  {t("page.engine")} <span className="font-mono">{process.engineId}</span>
                </span>
              </>
            )}
          </>
        }
        actions={
          <Button
            type="button"
            variant="toolbar"
            size="sm"
            aria-disabled={section.refreshing || undefined}
            onClick={section.refreshing ? undefined : refresh}
          >
            <Icon
              icon={RefreshCw}
              className={section.refreshing ? "motion-safe:animate-spin" : undefined}
            />
            {t("page.refresh")}
          </Button>
        }
        freshness={readAt && <FreshnessStamp at={readAt.toISOString()} />}
      />
      {failure && (
        <StatusStrip
          tone="danger"
          title={failure.title}
          detail={failure.hint}
          details={failure.details ?? undefined}
          actions={
            failure.retry
              ? [{ label: t("page.refresh"), icon: RefreshCw, onClick: section.retry }]
              : undefined
          }
        />
      )}
      {process && process.latest === null && (
        <StatusStrip
          tone="warning"
          title={t("page.missing", { key: processKey })}
          detail={t("page.missingDetail")}
        />
      )}
    </div>
  )
}
