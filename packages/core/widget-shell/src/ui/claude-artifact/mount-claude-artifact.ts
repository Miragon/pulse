import type { ComponentType } from "react"
import { mountApp, type MountAppOptions } from "../app-root.js"
import type { ToolCaller } from "../browser-view-host.js"
import { ARTIFACT_PAGE_HINTS } from "./artifact-hints.js"
import { claudeToolCaller, type ClaudeRuntime } from "./claude-tool-caller.js"

export interface MountClaudeArtifactOptions extends Omit<
  MountAppOptions,
  "callTool" | "documentTheme" | "followUp"
> {
  /**
   * The page's own connector, by the name the runtime knows it under (the `mcp` declaration's
   * `server`); a read names another with its `connector` option.
   */
  readonly connector: string
  /** The artifact runtime; default the artifact's `window.claude`, read at the first call. */
  readonly runtime?: ClaudeRuntime
  /**
   * The page's caller in place of the runtime's: a recording a dev build or a test replays
   * (`playRecording`).
   */
  readonly callTool?: ToolCaller
}

/**
 * Mounts the page's app `App` as a Claude artifact: `mountApp` with the runtime's caller on the
 * page's `connector` (`claudeToolCaller`), the theme claude.ai states on the document, read and
 * never written (`documentTheme`), no hand-off, the artifact's words of what to do
 * (`ARTIFACT_PAGE_HINTS`, unless the page brings its own) and the viewer's language, the
 * browser's unless the page names one: claude.ai's frame names no language of the viewer's.
 * Returns the unmount.
 */
export function mountClaudeArtifact(
  App: ComponentType,
  options: MountClaudeArtifactOptions,
): () => void {
  const { connector, runtime, callTool, ...page } = options
  const { pageHints = ARTIFACT_PAGE_HINTS, locale = navigator.language } = page
  return mountApp(App, {
    ...page,
    pageHints,
    locale,
    documentTheme: true,
    followUp: "none",
    callTool: callTool ?? claudeToolCaller({ connector, runtime }),
  })
}
