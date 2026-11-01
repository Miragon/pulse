import { mountViews } from "@miragon/pulse-widget-shell/widgets"
import { hostWidgets, viewRegistry } from "./view-registry.js"
import "./globals.css"

// The one bundle every view document loads: the document's prelude names its view, and
// `mountViews` mounts that view under the shared providers (StrictMode included).
mountViews({ views: viewRegistry, hostWidgets })
