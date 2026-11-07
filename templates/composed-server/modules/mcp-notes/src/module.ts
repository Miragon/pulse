import { z } from "zod"
import type { ModulePlugin } from "@miragon/pulse-widget-shell/server"
import { createNotesStore } from "./notes-store.js"
import { registerTools } from "./tools.js"
import { registerWidgetTools } from "./widget-tools.js"

/**
 * Self-contained module definition: everything the server needs to mount the
 * notes module. Conforms structurally to the server's `ModuleDefinition` port
 * (`server/src/setup.ts`), with no import of the server.
 */

const notesConfigSchema = z.object({
  title: z.string().default("Team Notes"),
})

export interface NotesPluginConfig {
  /** Heading shown in the notes widget. */
  title: string
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

  /**
   * Pure env → raw-config mapping, which `createPlugin` parses. A setting that can be wrong is
   * also checked here, with one Error that names the variable, so the boot fails before its log.
   */
  configFromEnv(env: NodeJS.ProcessEnv): Record<string, unknown> {
    return { title: env.NOTES_TITLE?.trim() || undefined }
  },

  /** This module's slice of the app's unknown-env-var typo warner. */
  knownEnvVars: ["NOTES_TITLE"] as const,

  // No `toolsets`: every notes tool is a read, so there is nothing to narrow;
  // the server ignores a `notes:<toolset>` suffix with a warning. A module
  // with writes declares `toolsets: createToolsetVocabulary(...)` instead.

  // The server's shared resources are not needed: this module takes the config alone.
  createPlugin(config: Record<string, unknown>): ModulePlugin {
    return createPlugin(notesConfigSchema.parse(config))
  },
}
