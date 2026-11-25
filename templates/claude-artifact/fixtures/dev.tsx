// The dev and screenshot entry (`pnpm dev`, `pnpm shot`): the page on the recorded fixtures of
// PROCESS_KEY, through a mock `window.claude`, on the recording's clock and time zone. Never part
// of dist/app.js. `?fail=engine_process_stats,engine_activity_counts` fails those tools with an
// engine error, `?fail=needs_reauth` refuses every call with that code of the runtime's
// (`?fail=engine_process_stats:server_unavailable` one tool), `?delay=800` slows every answer,
// `?lang=de` renders German.
import { mount } from "../src/app.tsx"
import { claudeConnector } from "../src/engine/claude-connector.ts"
import { PROCESS_KEY } from "../src/page.config.ts"
import { installMockClaude, type Fixture } from "./mock-claude.ts"

const recorded = import.meta.glob<Fixture>("./*.json", { eager: true, import: "default" })
const fixture = recorded[`./${PROCESS_KEY}.json`]
if (fixture === undefined) {
  throw new Error(
    `No fixtures for ${PROCESS_KEY}: record them (pnpm record -- --process ${PROCESS_KEY}).`,
  )
}

const params = new URLSearchParams(location.search)
installMockClaude(fixture, {
  fail: params.get("fail")?.split(",").filter(Boolean),
  delayMs: Number(params.get("delay") ?? 0),
})
const asOf = new Date(fixture.asOf)
mount({
  connector: claudeConnector(),
  language: params.get("lang") ?? undefined,
  now: () => asOf,
  timeZone: fixture.timeZone,
})
