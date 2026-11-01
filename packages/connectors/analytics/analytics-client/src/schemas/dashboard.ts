import { z } from "zod"
import { engineFilterShape, periodField } from "./shared.js"

export const dashboardInput = z.object({
  processDefinitionKey: z
    .string()
    .optional()
    .describe("Restrict to a single process definition (optional)"),
  period: periodField,
  ...engineFilterShape,
})

export const heatmapInput = z.object({
  processDefinitionKey: z.string().describe("Process definition key to analyze"),
  period: periodField,
  ...engineFilterShape,
})
