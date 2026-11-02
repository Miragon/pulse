import { z } from "zod"
import {
  firstResultParam,
  flagParam,
  likeParam,
  maxResultsParam,
  sortOrderParam,
  variableSchema,
  variableValueInfo,
  wholeVariableParam,
} from "./shared.js"

export const startProcessInstanceInput = z.object({
  processDefinitionKey: z.string(),
  businessKey: z.string().optional(),
  variables: variableSchema.optional(),
})

export const listProcessInstancesInput = z.object({
  processDefinitionKey: z.string().optional(),
  businessKey: z.string().optional(),
  businessKeyLike: likeParam(),
  active: flagParam(),
  suspended: flagParam(),
  withIncidents: flagParam("true = only instances with an open incident"),
  firstResult: firstResultParam,
  maxResults: maxResultsParam(),
  sortBy: z
    .enum(["instanceId", "definitionKey", "definitionId", "tenantId", "businessKey"])
    .optional(),
  sortOrder: sortOrderParam,
})

export const getProcessInstanceInput = z.object({
  processInstanceId: z.string(),
})

export const getActivityInstanceTreeInput = z.object({
  processInstanceId: z.string(),
})

export const deleteProcessInstanceInput = z.object({
  processInstanceId: z.string(),
  skipSubprocesses: z
    .boolean()
    .optional()
    .describe("Keep the instances its call activities started (default: deleted too)"),
  skipCustomListeners: z
    .boolean()
    .optional()
    .describe("Skip custom execution listeners (e.g. when one fails the delete)"),
  skipIoMappings: z.boolean().optional(),
})

export const modifyProcessInstanceInput = z.object({
  processInstanceId: z.string(),
  skipCustomListeners: z.boolean().optional(),
  skipIoMappings: z.boolean().optional(),
  instructions: z.array(
    z.object({
      type: z.enum(["cancel", "startBeforeActivity", "startAfterActivity", "startTransition"]),
      activityId: z.string().optional().describe("Activity ID to start before/after or cancel"),
      transitionId: z.string().optional().describe("Transition ID for startTransition"),
      activityInstanceId: z.string().optional().describe("Activity instance ID to cancel"),
      transitionInstanceId: z.string().optional().describe("Transition instance ID to cancel"),
      ancestorActivityInstanceId: z.string().optional(),
    }),
  ),
})

export const getProcessInstanceVariablesInput = z.object({
  processInstanceId: z.string(),
  variableName: wholeVariableParam,
})

export const setProcessInstanceVariableInput = z.object({
  processInstanceId: z.string(),
  variableName: z.string(),
  value: z.unknown(),
  type: z.string().optional(),
  valueInfo: variableValueInfo,
})

export const setProcessInstanceSuspensionInput = z.object({
  processInstanceId: z.string(),
  suspended: z.boolean(),
})
