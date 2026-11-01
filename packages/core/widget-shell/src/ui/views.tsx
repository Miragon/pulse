import { Children, isValidElement, type ReactNode } from "react"
import { ViewErrorBoundary } from "./view-error-boundary.js"

/** A view gets its show tool's `structuredContent` as `data`; it composes its own widgets. */
export interface ViewProps<TData> {
  data: TData
}

/** A function type (contravariant in `data`), so every `ViewComponent<X>` is a `ViewComponent`. */
export type ViewComponent<TData = never> = (props: ViewProps<TData>) => ReactNode

/** Key = view name = show tool name (`showToolBinding`). */
export type ViewMap = Readonly<Record<string, ViewComponent>>

/**
 * The static-layout helper: full-width rows, each widget in its own shell. Every row sits in its
 * own error boundary, so one crashing widget shows its fallback while its siblings stay up.
 */
export function ViewStack({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {Children.toArray(children).map((child, index) => (
        <ViewErrorBoundary key={isValidElement(child) ? child.key : index}>
          {child}
        </ViewErrorBoundary>
      ))}
    </div>
  )
}
