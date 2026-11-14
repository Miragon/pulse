import { mountPage, type ToolCaller, type ToolResult } from "@miragon/pulse-widget-shell/widgets"
import { viewRegistry } from "../../src/ui/view-registry.js"

/**
 * A plain page outside a chat (the web app's shape, page-root.spec.ts): this server's views under
 * widget-shell's page root, without ext-apps. The page hands in its caller, a fetch to the host
 * backend that forwards each tool call to the server, and sets its own language and theme on the
 * document as a page does. The query names the view, its tool's arguments and what a hand-off does.
 */

interface CallOutcome {
  result?: ToolResult
  error?: { message: string }
}

const callTool: ToolCaller = async (name, args) => {
  const response = await fetch("/host/call", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, arguments: args }),
  })
  const outcome = (await response.json()) as CallOutcome
  if (outcome.result === undefined) throw new Error(outcome.error?.message ?? "No result.")
  return outcome.result
}

const query = new URLSearchParams(location.search)
const lang = query.get("lang")
if (lang) document.documentElement.lang = lang
const theme = query.get("theme")
if (theme) document.documentElement.setAttribute("data-cd-theme", theme)

mountPage(viewRegistry, {
  view: query.get("view") ?? "",
  args: JSON.parse(query.get("args") ?? "{}") as Record<string, unknown>,
  callTool,
  followUp: query.get("followUp") === "copy" ? "copy" : "none",
})
