import { z } from "zod"

export const getBatchInput = z.object({
  batchId: z.string().min(1),
})
