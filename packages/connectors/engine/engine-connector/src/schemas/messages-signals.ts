import { z } from "zod"
import { variableSchema } from "./shared.js"

export const correlateMessageInput = z.object({
  messageName: z.string(),
  processInstanceId: z.string().optional(),
  businessKey: z.string().optional(),
  correlationKeys: variableSchema.optional(),
  processVariables: variableSchema
    .optional()
    .describe("Set on the instance the message reaches; only correlationKeys match"),
  all: z.boolean().optional(),
  resultEnabled: z.boolean().optional().default(true),
})

export const throwSignalInput = z.object({
  name: z.string(),
  variables: variableSchema.optional(),
})
