import { z } from "zod"
import { engineFilterShape, periodField } from "./shared.js"

export const dashboardInput = z.object({
  processDefinitionKey: z.string().optional(),
  period: periodField,
  ...engineFilterShape,
})

export const heatmapInput = z.object({
  processDefinitionKey: z.string(),
  period: periodField,
  ...engineFilterShape,
})
