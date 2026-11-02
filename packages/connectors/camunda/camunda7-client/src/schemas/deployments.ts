import { z } from "zod"
import { firstResultParam, likeParam, maxResultsParam, sortOrderParam } from "./shared.js"

export const getDeploymentInput = z.object({
  deploymentId: z.string().min(1),
})

export const listDeploymentsInput = z.object({
  name: z.string().optional(),
  nameLike: likeParam(),
  firstResult: firstResultParam,
  maxResults: maxResultsParam(),
  sortBy: z.enum(["id", "name", "deploymentTime", "tenantId"]).optional(),
  sortOrder: sortOrderParam,
})

/**
 * A deployment resource's name, refused unless it reaches the engine UNCHANGED.
 * The engine names the deployed resource after the multipart filename and keys
 * the deployment's resources by it, so a name rewritten in transit is deployed
 * under another name, and two distinct names can collapse into one that the
 * engine keeps only once (past the uniqueness check below). Each rule closes
 * one rewrite:
 * - `"` and line breaks: fetch percent-escapes them in the filename, so
 *   `a"b` arrives as `a%22b`, the same as a literal `a%22b`;
 * - leading or trailing whitespace: the engine's multipart parser
 *   (commons-fileupload) trims the filename, and a blank name arrives empty;
 * - `=?`: that parser decodes RFC 2047 encoded words in the filename;
 * - `\`: the quoted-string escape, which multipart parsers disagree on;
 * - control characters: never part of a file name (a NUL fails the upload).
 * Non-ASCII names travel as raw UTF-8, which the engine decodes with its JVM
 * default charset (UTF-8 since Java 18).
 */
const resourceName = z
  .string()
  .min(1)
  .refine((name) => name.trim() === name, "Resource names must not start or end with whitespace")
  .refine((name) => !/["\\]/.test(name), 'Resource names must not contain " or \\')
  .refine((name) => !/\p{Cc}/u.test(name), "Resource names must not contain control characters")
  .refine((name) => !name.includes("=?"), 'Resource names must not contain "=?"')
  .describe(
    'Resource file name (e.g. "process.bpmn"); the resource is deployed under it, so it must ' +
      'not contain a double quote, a backslash, "=?" or control characters, nor start or end ' +
      "with whitespace",
  )

export const createDeploymentInput = z.object({
  deploymentName: z.string(),
  enableDuplicateFiltering: z
    .boolean()
    .optional()
    .describe("Skip deployment if identical resources already deployed"),
  deployChangedOnly: z.boolean().optional(),
  deploymentSource: z.string().optional(),
  tenantId: z.string().optional(),
  resources: z
    .array(
      z.object({
        name: resourceName,
        content: z.string().describe("Resource content (BPMN XML, DMN XML, etc.)"),
      }),
    )
    .min(1)
    // The engine keys a deployment's resources by file name: a repeated name
    // would silently replace the earlier resource instead of failing. Comparing
    // the names as given is sound only because `resourceName` refuses every
    // name that would be rewritten on its way to the engine.
    .refine((resources) => new Set(resources.map((r) => r.name)).size === resources.length, {
      message: "Resource names must be unique within one deployment",
    })
    .describe("Each name must be unique within the deployment"),
})
