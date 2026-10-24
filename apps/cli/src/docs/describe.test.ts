import { describe, expect, it } from "vitest"
import { catalog, view } from "../../test/support/docs-describe.js"
import { findByOperationId } from "../catalog/catalog.js"
import { expandSchema } from "../catalog/schema.js"
import type { OperationSpec } from "../catalog/types.js"
import { type DescribeView, describeOperation } from "./describe.js"
import { examplesFor } from "./examples.js"
import { operationOptions } from "./options.js"

function option(described: DescribeView, flag: string) {
  return described.options.find((entry) => entry.flag === flag)
}

describe("describeOperation", () => {
  it("describes a JSON body operation with exactly the documented fields", () => {
    const start = view("process-definition", "start")
    const operation = findByOperationId(catalog, "startProcessInstanceByKey")!
    expect(Object.keys(start)).toEqual([
      "command",
      "operationId",
      "method",
      "path",
      "summary",
      "description",
      "effect",
      "deprecated",
      "arguments",
      "options",
      "body",
      "responses",
      "examples",
    ])
    expect(start).toMatchObject({
      command: "operate process-definition start <key>",
      operationId: "startProcessInstanceByKey",
      method: "POST",
      path: "/process-definition/key/{key}/start",
      summary: operation.summary,
      description: operation.description,
      effect: "write",
      deprecated: false,
      arguments: [
        {
          name: "key",
          description:
            "The key of the process definition (the latest version thereof) to be retrieved.",
        },
      ],
    })
    expect(start.examples).toEqual(examplesFor(operation))
  })

  it("lists the options with syntax, type, required, enum, format and repeatable", () => {
    const start = view("process-definition", "start")
    expect(start.options.map((entry) => entry.flag)).toEqual(
      operationOptions(findByOperationId(catalog, "startProcessInstanceByKey")!).map(
        (o) => o.syntax,
      ),
    )
    expect(option(start, "--business-key <value>")).toEqual({
      flag: "--business-key <value>",
      type: "string",
      required: false,
      description: "The business key of the process instance.",
    })
    expect(option(start, "--var <name=value>")).toMatchObject({
      type: "variables",
      required: false,
      repeatable: true,
    })
    const instances = view("process-instance", "list")
    expect(option(instances, "--sort-order <value>")).toMatchObject({ enum: ["asc", "desc"] })
    expect(option(instances, "--max-results <n>")).toEqual({
      flag: "--max-results <n>",
      type: "integer",
      format: "int32",
      required: false,
      description: expect.stringMatching(/^Pagination of results/),
    })
    expect(option(view("decision-definition", "list"), "--version <n>")).toMatchObject({
      type: "integer",
      format: "int32",
    })
    expect(option(instances, "--all")).toEqual({
      flag: "--all",
      type: "boolean",
      required: false,
      description:
        "Fetch all pages and print one combined list (page size --max-results, default 500).",
    })
    const history = view("historic-process-instance", "list")
    expect(option(history, "--started-after <date-time>")).toMatchObject({
      type: "date-time",
      format: "date-time",
    })
  })

  it("adds required options to the command", () => {
    const fetch = view("external-task", "fetch-and-lock")
    expect(fetch.command).toBe(
      "operate external-task fetch-and-lock --worker-id <value> --max-tasks <n>",
    )
    expect(option(fetch, "--max-tasks <n>")).toEqual({
      flag: "--max-tasks <n>",
      type: "integer",
      required: true,
      format: "int32",
      description: "Mandatory. The maximum number of tasks to return.",
    })
  })

  it("describes the JSON body with its expanded schema and variable options", () => {
    const start = view("process-definition", "start")
    expect(start.body).toEqual({
      contentType: "application/json",
      schemaName: "StartProcessInstanceDto",
      schema: expandSchema(
        { $ref: "#/components/schemas/StartProcessInstanceDto" },
        catalog.schemas,
        3,
      ),
      variableFlags: { "--var": "variables" },
    })
    expect(start.body?.schema).toMatchObject({ title: "StartProcessInstanceDto", type: "object" })
    expect(view("message", "correlate").body?.variableFlags).toEqual({
      "--correlation-key": "correlationKeys",
      "--local-correlation-key": "localCorrelationKeys",
      "--var": "processVariables",
      "--local-var": "processVariablesLocal",
      "--triggered-scope-var": "processVariablesToTriggeredScope",
    })
    expect(view("process-instance", "set-variable").body).not.toHaveProperty("variableFlags")
  })

  it("describes multipart bodies and resource file arguments", () => {
    const deploy = view("deployment", "create")
    expect(deploy.command).toBe("operate deployment create <files...>")
    expect(deploy.arguments).toEqual([
      { name: "files", description: "Resource files to deploy (BPMN, DMN, forms, scripts, ...)." },
    ])
    expect(deploy.body).toEqual({
      contentType: "multipart/form-data",
      schemaName: "MultiFormDeploymentDto",
      schema: expandSchema(
        { $ref: "#/components/schemas/MultiFormDeploymentDto" },
        catalog.schemas,
        3,
      ),
    })
    expect(option(deploy, "--deployment-activation-time <date-time>")).toMatchObject({
      format: "date-time",
    })
    expect(option(view("task-variable", "set-binary"), "--data <path>")).toEqual({
      flag: "--data <path>",
      type: "file",
      required: false,
      description: expect.any(String),
    })
  })

  it("builds the multipart schema from the fields when the schema is unknown", () => {
    const base = findByOperationId(catalog, "createDeployment")!
    const spec: OperationSpec = {
      ...base,
      body: {
        kind: "multipart",
        resources: false,
        fields: [
          { name: "file", flag: "file", type: "binary", description: "The file." },
          { name: "flag", flag: "flag", type: "boolean", description: "A flag." },
          { name: "when", flag: "when", type: "string", format: "date-time", description: "When." },
        ],
      },
    }
    const expected = {
      contentType: "multipart/form-data",
      schema: {
        type: "object",
        properties: {
          file: { type: "string", format: "binary", description: "The file." },
          flag: { type: "boolean", description: "A flag." },
          when: { type: "string", format: "date-time", description: "When." },
        },
      },
    }
    expect(describeOperation(spec, catalog).body).toEqual(expected)
    const named = { ...catalog, schemas: { ...catalog.schemas, undefined: { type: "string" } } }
    expect(describeOperation(spec, named).body).toEqual(expected)
    const unknown = {
      ...spec,
      body: { ...spec.body!, schemaName: "NoSuchSchema" },
    } as OperationSpec
    expect(describeOperation(unknown, catalog).body).toEqual({
      ...expected,
      schemaName: "NoSuchSchema",
    })
  })

  it("has no body for operations without one and no schema for empty responses", () => {
    const get = view("process-instance", "get")
    expect(get).not.toHaveProperty("body")
    expect(get.options).toEqual([])
    expect(get.responses).toEqual([
      {
        status: 200,
        kind: "json",
        contentTypes: ["application/json"],
        schema: expandSchema(
          { $ref: "#/components/schemas/ProcessInstanceDto" },
          catalog.schemas,
          2,
        ),
      },
    ])
    const deleted = view("process-instance", "delete").responses
    expect(deleted).toEqual([{ status: 204, kind: "none", contentTypes: [] }])
    expect(deleted[0]).not.toHaveProperty("schema")
  })

  it("expands response schemas two levels deep", () => {
    const tasks = view("task", "list").responses[0]!.schema as { items: Record<string, unknown> }
    expect(tasks.items.title).toBe("TaskWithAttachmentAndCommentDto")
    const json = JSON.stringify(view("process-instance", "get").responses)
    expect(json).toContain('"title":"LinkableDto"')
    expect(json).toContain('"$ref":"AtomLink"')
  })

  it("describes every operation of the catalog as JSON", () => {
    for (const operation of catalog.operations) {
      const described = describeOperation(operation, catalog)
      expect(JSON.parse(JSON.stringify(described))).toEqual(described)
      expect(described.options).toHaveLength(operationOptions(operation).length)
      expect(described.responses).toHaveLength(operation.responses.length)
      expect(described.command.startsWith(`operate ${operation.group} ${operation.name}`)).toBe(
        true,
      )
    }
  })
})
