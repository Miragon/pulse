// The published page's entry (dist/app.js): the dashboard over the viewer's Pulse connector. Its
// stylesheet is pulse-ui's own (dist/pulse-ui.css, linked by src/page.html).
import { mount } from "./app.tsx"
import { claudeConnector } from "./engine/claude-connector.ts"

mount({ connector: claudeConnector() })
