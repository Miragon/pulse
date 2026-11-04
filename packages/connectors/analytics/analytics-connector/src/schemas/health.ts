import { z } from "zod"
import { engineFilterShape } from "./shared.js"

export const engineHealthInput = z.object({
  ...engineFilterShape,
})
