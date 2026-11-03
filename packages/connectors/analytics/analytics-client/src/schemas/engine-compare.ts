import { z } from "zod"

export const engineCompareInput = z.object({
  processDefinitionKey: z
    .string()
    .min(1)
    .describe(
      "The process definition key to compare on both engines, REQUIRED: engines run different process mixes, so comparing their whole workloads measures the mix, not the engines. Keys deployed on several engines are the `sharedProcessKeys` of analytics_show_engine_landscape.",
    ),
  engineA: z.string().min(1),
  engineB: z.string().min(1),
  windowDays: z.number().int().min(1).max(30).default(14),
  activityId: z
    .string()
    .optional()
    .describe("Also count the incidents at this BPMN element (elementIncident*)."),
  minBucketSize: z.number().int().min(1).default(10),
})
