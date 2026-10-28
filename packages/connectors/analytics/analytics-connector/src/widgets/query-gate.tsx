import type { ReactNode } from "react"
import { QueryFallback, WidgetShell } from "@miragon/pulse-widget-shell/widgets"
import { useT } from "../messages/use-t.js"

interface GateQuery<T> {
  data: T | null | undefined
  isError: boolean
  error?: unknown
  refetch: () => unknown
}

/** `children` is a render prop so the happy path only runs with resolved data. */
export function QueryGate<T>({
  initialData,
  query,
  skeleton,
  header,
  children,
}: {
  initialData: T | null
  query: GateQuery<T>
  skeleton: ReactNode
  header?: ReactNode
  children: (data: T) => ReactNode
}) {
  const t = useT()
  const data = initialData ?? query.data ?? null
  if (!data) {
    return (
      <WidgetShell>
        {header}
        <QueryFallback
          isError={query.isError}
          error={query.error}
          errorTitle={t("aCommon.loadError")}
          onRetry={() => void query.refetch()}
          skeleton={skeleton}
        />
      </WidgetShell>
    )
  }
  return <>{children(data)}</>
}
