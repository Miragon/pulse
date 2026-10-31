import { useLocale } from "@miragon/mcp-toolkit-ui"
import { McpAppView, type DescribeViewError, type ViewTitleMode } from "@miragon/mcp-toolkit-ui/app"
import { useMemo, type ComponentProps } from "react"
import { classifyError, describeError, type ErrorKind, type ErrorSource } from "./describe-error.js"
import { useShellHost } from "./shell-host.js"

/**
 * ONE title per view: a module's view renders its widget heading, so the toolbar hides it. Where
 * the host names no tool, the toolbar keeps it, so no view ends up untitled.
 */
export function viewTitleMode(toolName: string | undefined): ViewTitleMode {
  return toolName === undefined ? "show" : "hide"
}

/** Every other kit hint says "try again", which a view can only keep where it offers Retry. */
export function hintNeedsNoRetry(kind: ErrorKind, source: ErrorSource["type"]): boolean {
  if (kind === "unreachable") return source !== "unknown"
  return kind === "notOnServer" || kind === "unauthorized" || kind === "forbidden"
}

/**
 * The kit's hint replaces the toolkit's only where it promises no retry, since
 * the toolkit offers Retry only when the host named the tool. Unclassified
 * reasons keep the toolkit's words.
 */
export function viewErrorDescriber(locale: string | undefined): DescribeViewError {
  return (reason, info) => {
    if (info?.kind === "blocked" || !reason) return undefined
    const described = describeError(reason, locale)
    if (described.kind === "unknown") return undefined
    return hintNeedsNoRetry(described.kind, classifyError(reason).source.type)
      ? { title: described.title, description: described.hint }
      : { title: described.title }
  }
}

// The toolkit's chrome localizes itself and shows Fullscreen only where the host offers it.
export function LocalizedAppView(
  props: Omit<ComponentProps<typeof McpAppView>, "titleMode" | "describeError">,
) {
  const { toolName } = useShellHost()
  const locale = useLocale()
  const describe = useMemo(() => viewErrorDescriber(locale), [locale])
  return <McpAppView {...props} titleMode={viewTitleMode(toolName)} describeError={describe} />
}
