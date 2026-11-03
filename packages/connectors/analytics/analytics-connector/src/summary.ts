import { createTranslator } from "@miragon/pulse-widget-shell/server"
import { enServer } from "./messages/en.server.js"

const translator = createTranslator({ en: enServer })

/** Model-facing text is English only; the widgets word the view in the host's language. */
export const summaryT = (key: string, params?: Record<string, unknown>): string =>
  translator("en", key, params)
