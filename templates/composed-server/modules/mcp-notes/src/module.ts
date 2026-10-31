import { z } from "zod"
import type { ModulePlugin, ProfileSource } from "@miragon/pulse-widget-shell/server"
import { createNotesStore } from "./notes-store.js"
import { registerTools } from "./tools.js"
import { registerWidgetTools } from "./widget-tools.js"

/**
 * Self-contained module definition: everything the server needs to mount the
 * notes module. Conforms structurally to the server's `ModuleDefinition` port
 * (`server/src/setup.ts`) — no import of the server.
 */

const notesConfigSchema = z.object({
  title: z.string().default("Team Notes"),
})

export interface NotesPluginConfig {
  /** Heading shown in the notes widget. */
  title: string
}

/**
 * Cross-module resources the server threads in. This simple module uses none
 * of them; modules that persist per-user settings consume `profileStore`
 * (compare the analytics module).
 */
interface NotesModuleShared {
  profileStore?: ProfileSource
}

/** Constructs the data source once and hands it to both tool registrations. */
export function createPlugin(config: NotesPluginConfig): ModulePlugin {
  const store = createNotesStore()
  return {
    name: "notes",
    register(server) {
      registerTools(server, store)
      registerWidgetTools(server, store, config.title)
    },
  }
}

export const notesModule = {
  name: "notes",

  /** Pure env → raw-config mapping; validation happens in `createPlugin`. */
  configFromEnv(env: NodeJS.ProcessEnv): Record<string, unknown> {
    return { title: env.NOTES_TITLE?.trim() || undefined }
  },

  /** This module's slice of the app's unknown-env-var typo warner. */
  knownEnvVars: ["NOTES_TITLE"] as const,

  // No `toolsets`: every notes tool is a read, so there is nothing to narrow —
  // the server ignores a `notes:<toolset>` suffix with a warning. A module
  // with writes declares `toolsets: createToolsetVocabulary(...)` instead.

  createPlugin(config: Record<string, unknown>, _shared: NotesModuleShared): ModulePlugin {
    return createPlugin(notesConfigSchema.parse(config))
  },
}
