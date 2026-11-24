// The published page's entry (dist/app.js): the dashboard over the viewer's Pulse connector.
import "./app.css"
import { mount } from "./app.tsx"
import { claudeConnector } from "./engine/claude-connector.ts"

mount({ connector: claudeConnector() })
