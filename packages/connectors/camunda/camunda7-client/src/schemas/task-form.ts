import { z } from "zod"

export const getTaskFormInput = z.object({
  taskId: z.string(),
})

export const taskFormFieldSourceSchema = z.enum(["form-data", "manual"])

export const taskFormFieldSchema = z.object({
  name: z.string(),
  type: z.string().optional(),
  label: z.string().optional(),
  defaultValue: z.unknown().optional(),
  suggestedValues: z.array(z.unknown()).optional(),
  required: z.boolean().optional(),
  readonly: z.boolean().optional(),
  source: taskFormFieldSourceSchema,
})

export const taskFormSchema = z.object({
  taskId: z.string(),
  fields: z.array(taskFormFieldSchema),
  /** Set when the task uses its own form (embedded/external/Camunda Form). */
  formKey: z.string().optional(),
})

export type TaskFormFieldSource = z.infer<typeof taskFormFieldSourceSchema>
export type TaskFormField = z.infer<typeof taskFormFieldSchema>
export type TaskFormSchema = z.infer<typeof taskFormSchema>
