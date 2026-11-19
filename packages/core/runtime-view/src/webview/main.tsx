import "./styles/webview.css"
import { createRoot } from "react-dom/client"
import { LocaleProvider } from "@miragon/pulse-ui"
import { App } from "./app.js"
import { LabelLocale } from "./format/label-locale.js"
import { HostBridge, type VsCodeApi } from "./host/host-bridge.js"

interface VsCodeGlobal {
  readonly acquireVsCodeApi: () => VsCodeApi
}

LabelLocale.apply()
document.documentElement.dataset.density = "compact"
const bridge = new HostBridge((globalThis as unknown as VsCodeGlobal).acquireVsCodeApi())
const mountPoint =
  document.getElementById("pulse") ?? document.body.appendChild(document.createElement("div"))
mountPoint.id = "pulse"
createRoot(mountPoint).render(
  <LocaleProvider locale="en">
    <App bridge={bridge} />
  </LocaleProvider>,
)
bridge.post({ type: "ready" })
