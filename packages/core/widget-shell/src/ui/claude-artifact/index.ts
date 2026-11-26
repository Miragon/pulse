// A Claude artifact on the page reads of `/widgets`: its caller over the artifact runtime's `mcp`
// capability, the one place that knows `window.claude`, its words in claude.ai's places and its
// mount. Its own entry (`./claude-artifact`), so nothing of claude.ai reaches `/widgets`, a view
// bundle or the web app (dependency-cruiser's widget-shell-claude-artifact-alone).
export { ARTIFACT_PAGE_HINTS } from "./artifact-hints.js"
export {
  CLAUDE_RUNTIME_CODES,
  claudeToolCaller,
  type ClaudeCacheOptions,
  type ClaudeMcp,
  type ClaudeMcpAnswer,
  type ClaudeRuntime,
  type ClaudeToolCallerOptions,
} from "./claude-tool-caller.js"
export { mountClaudeArtifact, type MountClaudeArtifactOptions } from "./mount-claude-artifact.js"
