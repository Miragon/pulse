import { cn } from "@miragon/pulse-ui"
import { useToolQuery } from "@miragon/pulse-widget-shell/widgets"
import { ENGINE_LIST_ENGINES } from "../../tool-names.js"
import { DEFAULT_ENVIRONMENT_ID } from "../../lib/shared/environments.js"
import { useT, type T } from "../../messages/use-t.js"
import type { TargetLine } from "./engine-action.js"

/** #322 U4: prod and test must never look alike; an unknown environment is left out, never guessed. */

interface EnginesAnswer {
  engines: Array<{ id: string; environment?: string }>
}

export function useEngineEnvironment(engineId: string | null | undefined): string | null {
  const engines = useToolQuery<EnginesAnswer>(
    ["engine:engines"],
    ENGINE_LIST_ENGINES,
    {},
    {
      enabled: !!engineId,
    },
  )
  return environmentIn(engines.data?.engines, engineId)
}

/** Null for the implicit default one. */
export function environmentIn(
  engines: ReadonlyArray<{ id: string; environment?: string }> | undefined,
  engineId: string | null | undefined,
): string | null {
  const environment = engines?.find((e) => e.id === engineId)?.environment
  return environment && environment !== DEFAULT_ENVIRONMENT_ID ? environment : null
}

/** Words, never a colour, carry it (CI §3.7). */
export function EnvironmentChip({
  environment,
  className,
}: {
  environment: string
  className?: string
}) {
  const t = useT()
  return (
    <span
      data-slot="environment-chip"
      className={cn(
        "border-input text-foreground text-small inline-flex shrink-0 items-center rounded-sm border px-1.5 font-semibold tracking-wide uppercase",
        className,
      )}
    >
      <span className="sr-only">{t("engineContext.environment")} </span>
      {environment}
    </span>
  )
}

/** #322 U4: a write on prod says so before it runs. */
export function engineTargetLines(
  t: T,
  engineId: string | undefined,
  environment: string | null,
): TargetLine[] {
  if (!engineId) return []
  const lines: TargetLine[] = [[t("confirmDialog.engine"), engineId]]
  if (environment) lines.push([t("confirmDialog.environment"), environment.toUpperCase()])
  return lines
}
