import { z } from "zod"
import { engineFilterShape, isoDatetimeString } from "./shared.js"

export const periodCompareInput = z.object({
  processDefinitionKey: z
    .string()
    .optional()
    .describe("Restrict to a single process definition (optional)"),
  activityId: z
    .string()
    .optional()
    .describe("Also count the incidents at this BPMN element (elementIncident*; optional)"),
  periodAFrom: isoDatetimeString.describe("Period A (the baseline) start, ISO datetime"),
  periodATo: isoDatetimeString.describe("Period A end, ISO datetime"),
  periodBFrom: isoDatetimeString.describe("Period B start, ISO datetime"),
  periodBTo: isoDatetimeString.describe("Period B end, ISO datetime; clamped to now"),
  minBucketSize: z
    .number()
    .int()
    .min(1)
    .default(10)
    .describe("Minimum started and completed instances per period"),
  ...engineFilterShape,
})
