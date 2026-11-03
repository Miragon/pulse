import { z } from "zod"

export const engineLandscapeInput = z.object({
  engine: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Engines to list; omitted: every configured one."),
})
