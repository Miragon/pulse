import { z } from "zod"

/**
 * The status triage of one engine, optionally for some process definition keys only. Only the
 * `…In` form, without the single `processDefinitionKey` other filters take beside it
 * (`listIncidentsInput`): the model-visible char budget had no room for it (owner decision
 * 2026-11-02, cut 11); the strict input error names `processDefinitionKeyIn` to a model that
 * tries the single form.
 */
export const engineStatusInput = z.object({
  processDefinitionKeyIn: z.array(z.string()).optional(),
})
