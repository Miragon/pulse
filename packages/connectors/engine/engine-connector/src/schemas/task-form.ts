import { z } from "zod"

export const getTaskFormInput = z.object({
  taskId: z.string(),
})
