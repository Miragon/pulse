// The published page's entry (dist/app.js): the dashboard as a Claude artifact over the viewer's
// Pulse connector, which widget-shell's caller alone speaks to. Its stylesheet is pulse-ui's own
// (dist/pulse-ui.css, linked by src/page.html).
import { mountClaudeArtifact } from "@miragon/pulse-widget-shell/claude-artifact"
import { App } from "./app.tsx"
import { CONNECTOR_NAME } from "./page.config.ts"

mountClaudeArtifact(App, { connector: CONNECTOR_NAME })
