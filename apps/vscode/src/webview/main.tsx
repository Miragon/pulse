import "./theme/cd-tokens.generated.css"
import "@fontsource-variable/geist/wght.css"
import "@fontsource-variable/geist-mono/wght.css"
import "diagram-js/assets/diagram-js.css"
import "bpmn-js/dist/assets/bpmn-js.css"
import "./theme/cd-canvas.css"
import "@miragon/modeler-shell/shell.css"
import "./styles/base.css"
import "./styles/components.css"
import "./styles/screens.css"
import "./styles/migration.css"
import "./styles/tables.css"
import "./styles/diagram.css"
import "./styles/boards.css"
import { render } from "preact"
import { App } from "./app.js"
import { HostBridge } from "./host/host-bridge.js"
import type { VsCodeApi } from "./host/host-bridge.js"

interface VsCodeGlobal {
  readonly acquireVsCodeApi: () => VsCodeApi
}

const bridge = new HostBridge((globalThis as unknown as VsCodeGlobal).acquireVsCodeApi())
const mountPoint =
  document.getElementById("pulse") ?? document.body.appendChild(document.createElement("div"))
mountPoint.id = "pulse"
render(<App bridge={bridge} />, mountPoint)
bridge.post({ type: "ready" })
