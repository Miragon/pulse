import { z } from "zod"
import { engineFilterShape, isoDatetimeString } from "./shared.js"

export const periodCompareInput = z.object({
  processDefinitionKey: z.string().optional(),
  activityId: z
    .string()
    .optional()
    .describe("Also count the incidents at this BPMN element (elementIncident*)."),
  periodAFrom: isoDatetimeString,
  periodATo: isoDatetimeString,
  periodBFrom: isoDatetimeString,
  periodBTo: isoDatetimeString,
  minBucketSize: z.number().int().min(1).default(10),
  ...engineFilterShape,
})
