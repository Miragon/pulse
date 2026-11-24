import { Button, FreshnessStamp, Icon, VersionChip, WidgetHeader } from "@miragon/pulse-ui"
import { RefreshCw } from "lucide-react"
import { readActivities } from "../data/process-dashboard.ts"
import { useEngine, useSection } from "../engine/use-engine.tsx"
import { useT } from "../messages.ts"

/**
 * The page's bar: the process's name (else its key) with the version its diagram shows, the key
 * and the engine as facts, the Refresh, and when the numbers on the page were read (the oldest
 * read of the sections that show data). It shares the diagram's call and says no failure of its
 * own: the sections below say theirs. A plain wrapper, since the bar is the page's one banner.
 */
export function HeaderSection({ processKey }: { readonly processKey: string }) {
  const t = useT()
  const { readAt, refresh } = useEngine()
  const section = useSection(
    (engine) => readActivities(engine, processKey),
    [processKey],
    (counts) => counts.asOf,
  )
  const process = section.data
  return (
    <div className="bg-card">
      <WidgetHeader
        title={process?.processDefinitionName ?? processKey}
        titleSuffix={process ? <VersionChip version={process.version} /> : undefined}
        sub={
          <>
            <span className="font-mono">{processKey}</span>
            {process && (
              <>
                <span className="text-muted-foreground">·</span>
                <span>
                  {t("page.engine")} <span className="font-mono">{process.engine}</span>
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
            aria-disabled={section.loading || undefined}
            onClick={section.loading ? undefined : refresh}
          >
            <Icon
              icon={RefreshCw}
              className={section.loading ? "motion-safe:animate-spin" : undefined}
            />
            {t("page.refresh")}
          </Button>
        }
        freshness={readAt && <FreshnessStamp at={readAt} />}
      />
    </div>
  )
}
