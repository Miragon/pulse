// The dev and screenshot entry (`pnpm dev`, `pnpm shot`): the page on the recorded fixtures of
// PROCESS_KEY, replayed by widget-shell's `playRecording` in place of the artifact runtime's
// caller, on the recording's clock and time zone. Never part of dist/app.js.
// `?fail=engine_process_stats,engine_activity_counts` fails those tools with a server's error,
// `?fail=needs_reauth` refuses every call with that code (`?fail=engine_process_stats:unavailable`
// one tool; the codes are pulse-ui's page error codes, onto which widget-shell's README maps the
// runtime's),
// `?delay=800` slows every answer, `?lang=de` renders German.
import { mountClaudeArtifact } from "@miragon/pulse-widget-shell/claude-artifact"
import { playRecording } from "@miragon/pulse-widget-shell/widgets"
import { App } from "../src/app.tsx"
import { CONNECTOR_NAME, PAGE_TOOLS, PROCESS_KEY } from "../src/page.config.ts"
import type { Fixture } from "./fixture.ts"

const recorded = import.meta.glob<Fixture>("./*.json", { eager: true, import: "default" })
const fixture = recorded[`./${PROCESS_KEY}.json`]
if (fixture === undefined) {
  throw new Error(
    `No fixtures for ${PROCESS_KEY}: record them (pnpm record -- --process ${PROCESS_KEY}).`,
  )
}

const params = new URLSearchParams(location.search)
mountClaudeArtifact(App, {
  connector: CONNECTOR_NAME,
  locale: params.get("lang") ?? undefined,
  ...playRecording(fixture, {
    fail: params.get("fail")?.split(",").filter(Boolean),
    delayMs: Number(params.get("delay") ?? 0),
    tools: PAGE_TOOLS,
    connector: CONNECTOR_NAME,
  }),
})
