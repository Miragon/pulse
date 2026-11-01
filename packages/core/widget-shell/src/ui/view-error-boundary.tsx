import { Component, type ErrorInfo, type ReactNode } from "react"
import { ErrorState, useLocale } from "@miragon/pulse-ui"
import { kitLabels } from "./kit-labels.js"

interface BoundaryState {
  error: Error | null
  resetKey: unknown
}

/**
 * Keeps one crashing widget from blanking the view: it says the element couldn't be displayed,
 * the raw text under Details, with a retry that renders it again. A new `resetKey` (the next
 * route) clears it.
 */
export class ViewErrorBoundary extends Component<
  { resetKey?: unknown; children: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  static getDerivedStateFromProps(
    props: { resetKey?: unknown },
    state: BoundaryState,
  ): Partial<BoundaryState> | null {
    return Object.is(props.resetKey, state.resetKey)
      ? null
      : { error: null, resetKey: props.resetKey }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[pulse] a view element crashed:", error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return <Crashed error={this.state.error} onRetry={() => this.setState({ error: null })} />
  }
}

function Crashed({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const labels = kitLabels(useLocale())
  return (
    <ErrorState
      variant="inline"
      title={labels.viewCrashed}
      details={error.message || undefined}
      onRetry={onRetry}
      retryLabel={labels.retry}
    />
  )
}
