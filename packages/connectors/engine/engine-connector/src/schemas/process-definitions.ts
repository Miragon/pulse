import { z } from "zod"
import {
  firstResultParam,
  flagParam,
  likeParam,
  maxResultsParam,
  sortOrderParam,
} from "./shared.js"

export const listProcessDefinitionsInput = z.object({
  processDefinitionKey: z.string().optional(),
  nameLike: likeParam(),
  latestVersion: flagParam(),
  firstResult: firstResultParam,
  maxResults: maxResultsParam(),
  sortBy: z
    .enum(["category", "key", "id", "name", "version", "deploymentId", "deployTime", "versionTag"])
    .optional(),
  sortOrder: sortOrderParam,
})

export const getProcessDefinitionXmlInput = z.object({
  processDefinitionId: z.string(),
})
