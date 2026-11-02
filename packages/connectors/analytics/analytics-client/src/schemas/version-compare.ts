import { z } from "zod"
import { engineFilterShape } from "./shared.js"

export const versionCompareInput = z.object({
  processDefinitionKey: z.string().min(1),
  versionA: z.number().int().min(1),
  versionB: z.number().int().min(1),
  windowDays: z.number().int().min(1).max(30).default(14),
  minBucketSize: z.number().int().min(1).default(10),
  ...engineFilterShape,
})
