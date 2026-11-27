import { z } from "zod"
import { BOARD_ID } from "../board-files.js"

/** The screens of the web app whose JSON form `engine_get_screen` returns. */
const SCREEN_KINDS = ["engine", "process", "instance"] as const

export type ScreenKind = (typeof SCREEN_KINDS)[number]

/**
 * One screen and the ids it takes, as the cockpit's `view` names them: a process by its key and its
 * tenant (every version's counts, the badges of one version, the latest without `version`; without
 * `tenantId` the process its key names alone, engine-core's `ProcessTenants`), an instance by its
 * id. Which screen takes which id is the tool's rule (tools/screens.ts), since the registrar takes
 * a flat shape.
 */
export const getScreenInput = z.object({
  screen: z.enum(SCREEN_KINDS),
  processDefinitionKey: z.string().min(1).optional().describe("process (required)."),
  tenantId: z.string().min(1).optional().describe("process."),
  version: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("process: the version's number; the latest without it."),
  processInstanceId: z.string().min(1).optional().describe("instance (required)."),
})

/** A board of the server's board files, by its id, as the cockpit's `board` takes it. */
export const getBoardInput = z.object({
  board: z.string().regex(BOARD_ID).describe("Its id, as engine_list_engines lists the boards."),
})
