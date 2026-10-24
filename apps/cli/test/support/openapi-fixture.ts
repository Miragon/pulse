/**
 * A small OpenAPI document and its helpers, for the operation extraction tests
 * (scripts/catalog/operations*.test.ts). It lives here rather than under scripts/catalog, where
 * mutation testing and coverage would measure it.
 */

import type { Schema } from "../../src/catalog/types.js"
import type {
  OpenApiDocument,
  OpenApiOperation,
  OpenApiPathItem,
} from "../../scripts/catalog/openapi.js"
import { type UnnamedOperation, extractOperations } from "../../scripts/catalog/operations.js"

export const ref = (kind: string, name: string) => ({ $ref: `#/components/${kind}/${name}` })
export const json = (schema: Schema) => ({ content: { "application/json": { schema } } })

const TRUE_ONLY_TEXT =
  "Only include instances without tenant. Value may only be `true`, as `false` is the default behavior."

const COMPONENTS: NonNullable<OpenApiDocument["components"]> = {
  parameters: {
    Tenant: {
      name: "tenantId",
      in: "query",
      description: "path level",
      schema: { type: "string" },
    },
  },
  requestBodies: {
    Thing: json({
      type: "object",
      properties: { name: { type: "string" }, url: { type: "string" } },
    }),
  },
  responses: { Ok: { description: " OK ", ...json(ref("schemas", "XmlDto")) } },
  schemas: {
    XmlDto: {
      type: "object",
      properties: { id: { type: "string" }, bpmn20Xml: { type: "string" } },
    },
    ThreeProps: {
      type: "object",
      properties: { id: {}, aXml: {}, other: {} },
    },
    TwoXml: { type: "object", properties: { aXml: {}, bXml: {} } },
    NoId: { type: "object", properties: { key: {}, aXml: {} } },
  },
}

export function document(paths: Record<string, OpenApiPathItem>): OpenApiDocument {
  return { info: { title: "t", version: "1" }, paths, components: COMPONENTS }
}

export function single(
  operation: OpenApiOperation,
  path = "/thing",
  method = "get",
): UnnamedOperation {
  const [first] = extractOperations(document({ [path]: { [method]: operation } }))
  if (first === undefined) throw new Error("no operation extracted")
  return first
}

export const SPEC = document({
  "/thing/{a}/sub/{b}": {
    parameters: [
      { name: "b", in: "path", required: true, schema: { type: "string" } },
      ref("parameters", "Tenant"),
    ],
    get: {
      operationId: "getSub",
      tags: ["Thing", "Other"],
      summary: " Get a sub thing. ",
      description: "Line 1\r\nLine 2\n",
      parameters: [
        {
          name: "withoutTenant",
          in: "query",
          description: TRUE_ONLY_TEXT,
          schema: { type: "boolean" },
        },
        { name: "a", in: "path", required: true, schema: { type: "string" } },
        {
          name: "count",
          in: "query",
          required: true,
          schema: { type: "integer", format: "int32" },
        },
        { name: "state", in: "query", schema: { type: "string", enum: ["A", "B", 3] } },
        { name: "X-Trace", in: "header", schema: { type: "string" } },
        {
          name: "tenantId",
          in: "query",
          description: "operation level",
          schema: { type: "string" },
        },
        { name: "filter", in: "query", schema: { type: "object" } },
        {
          name: "active",
          in: "query",
          description: "Only active ones.",
          schema: { type: "boolean" },
        },
        { name: "label", in: "query", description: "Value may only be `true`." },
        { name: "ratio", in: "query", schema: { type: "number" } },
        { name: "session", in: "cookie", schema: { type: "string" } },
      ],
      responses: { "200": ref("responses", "Ok"), "404": { description: "Not found" } },
    },
    delete: {
      operationId: "deleteSub",
      tags: ["Thing"],
      deprecated: true,
      responses: { "204": { description: "No content" } },
    },
    options: { operationId: "availableSubOperations", tags: ["Thing"] },
    summary: "path item summary",
  },
  "/thing": {
    post: {
      operationId: "createThing",
      tags: ["Thing"],
      requestBody: ref("requestBodies", "Thing"),
      responses: { "200": json({ type: "object" }), "201": { description: "created" } },
    },
    put: {
      operationId: "uploadThing",
      tags: ["Thing"],
      requestBody: {
        content: {
          "multipart/form-data": {
            schema: { type: "object", properties: { data: { type: "string", format: "binary" } } },
          },
        },
      },
    },
  },
  "/engine": { get: { operationId: "getEngines", tags: ["Engine"] } },
  "/version": { get: { operationId: "getVersion", tags: ["Version"] } },
})

/** Extracts inside the calling test, so mutation testing attributes the coverage to it. */
export const byId = (id: string) => {
  const operation = extractOperations(SPEC).find((candidate) => candidate.operationId === id)
  if (operation === undefined) throw new Error(`missing ${id}`)
  return operation
}
