import { createBuilderTexts } from "@miragon/pulse-widget-shell/server"
import { catalogs } from "./messages/index.js"

/** People's names for the view builder; `description`s stay the model's text. */
const texts = createBuilderTexts(catalogs, "analytics")

export const builderAppTitle = texts.appTitle
export const builderText = texts.text
export const fieldText = texts.field
