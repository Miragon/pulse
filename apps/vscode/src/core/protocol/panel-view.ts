import type { MigrationView } from "./migration-views.js"
import type { DefinitionView, EngineView, InstanceView } from "./view-models.js"

export type PanelView = DefinitionView | InstanceView | EngineView | MigrationView
