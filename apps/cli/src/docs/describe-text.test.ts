/** renderDescribeText: the text form of `describe` (describe.ts). */

import { describe, expect, it } from "vitest"
import { catalog, view } from "../../test/support/docs-describe.js"
import { type DescribeView, describeOperation, renderDescribeText } from "./describe.js"

describe("renderDescribeText", () => {
  const sample: DescribeView = {
    command: "operate sample run <id> --mode <value>",
    operationId: "runSample",
    method: "POST",
    path: "/sample/{id}/run",
    summary: "Run a sample",
    description: "Runs the **sample**.\n\n* first\n* second",
    effect: "bulk",
    deprecated: true,
    arguments: [{ name: "id", description: "The id." }],
    options: [
      {
        flag: "--mode <value>",
        type: "string",
        required: true,
        enum: ["fast", "slow"],
        description: "Mandatory. The mode.",
      },
      {
        flag: "--var <name=value>",
        type: "variables",
        required: false,
        repeatable: true,
        description: "A variable.",
      },
      { flag: "--quiet", type: "boolean", required: false, description: "" },
      {
        flag: "--level <n>",
        type: "integer",
        required: true,
        description: "The level. Mandatory. Below 10.",
      },
    ],
    body: {
      contentType: "application/json",
      schemaName: "SampleDto",
      schema: {
        title: "SampleDto",
        type: "object",
        required: ["mode"],
        properties: {
          mode: { type: "string", enum: ["fast", "slow"] },
          variables: { type: "object", additionalProperties: { $ref: "VariableValueDto" } },
        },
      },
      variableFlags: { "--var": "variables", "--local-var": "localVariables" },
    },
    responses: [
      {
        status: 200,
        kind: "json",
        contentTypes: ["application/json"],
        schema: { type: "array", items: { title: "ResultDto", properties: { id: {}, state: {} } } },
      },
      { status: 200, kind: "binary", contentTypes: ["application/octet-stream", "*/*"] },
      {
        status: 200,
        kind: "json",
        contentTypes: ["application/json"],
        schema: { type: "object", additionalProperties: {} },
      },
      { status: 204, kind: "none", contentTypes: [] },
    ],
    examples: ["operate sample run abc --mode fast --yes"],
  }

  it("renders every section", () => {
    expect(renderDescribeText(sample)).toBe(
      [
        "USAGE",
        "  operate sample run <id> --mode <value> [options]",
        "",
        "DESCRIPTION",
        "  Run a sample",
        "  POST /sample/{id}/run (effect: bulk, operationId: runSample)",
        "  Deprecated: avoid in new scripts.",
        "",
        "  Runs the sample.",
        "",
        "  * first",
        "  * second",
        "",
        "ARGUMENTS",
        "  <id>  The id.",
        "",
        "OPTIONS",
        "  --mode <value>      Required. The mode. One of: fast, slow.",
        "  --var <name=value>  A variable.",
        "  --quiet",
        "  --level <n>         Required. The level. Mandatory. Below 10.",
        "",
        "BODY",
        "  application/json, SampleDto",
        "  Variable options: --var (variables), --local-var (localVariables)",
        "  mode: string, required, one of fast|slow",
        "  variables: map<VariableValueDto>",
        "",
        "RESPONSES",
        "  200 json (application/json): array<ResultDto>",
        "    Fields: id, state",
        "  200 binary (application/octet-stream, */*)",
        "  200 json (application/json): map<any>",
        "  204 no content",
        "",
        "EXAMPLES",
        "  operate sample run abc --mode fast --yes",
        "",
      ].join("\n"),
    )
  })

  it("leaves out empty sections and optional lines", () => {
    const minimal: DescribeView = {
      ...sample,
      command: "operate sample get",
      description: "  ",
      deprecated: false,
      arguments: [],
      options: [],
      responses: [],
      examples: [],
      body: { contentType: "multipart/form-data", schema: { type: "object" } },
    }
    expect(renderDescribeText(minimal)).toBe(
      [
        "USAGE",
        "  operate sample get [options]",
        "",
        "DESCRIPTION",
        "  Run a sample",
        "  POST /sample/{id}/run (effect: bulk, operationId: runSample)",
        "",
        "BODY",
        "  multipart/form-data",
        "",
      ].join("\n"),
    )
    const { body: _body, ...withoutBody } = minimal
    expect(renderDescribeText(withoutBody)).not.toContain("BODY")
  })

  it("keeps every catalog operation within 100 columns, except single overlong words", () => {
    for (const operation of catalog.operations) {
      const text = renderDescribeText(describeOperation(operation, catalog))
      expect(text.endsWith("\n")).toBe(true)
      for (const line of text.slice(0, -1).split("\n")) {
        if (line.length <= 100) continue
        const words = line.trim().replace(/ \\$/, "").split(" ")
        expect(words.length, line).toBe(1)
      }
    }
  })

  it("renders a real operation with wrapped examples that still paste into a shell", () => {
    const text = renderDescribeText(view("process-instance", "modify"))
    expect(text).toContain(
      [
        "EXAMPLES",
        "  operate process-instance modify 6f2b8c3e-0f4a-11ef-a1b2-0242ac120002 --body @modification.json \\",
        "      --dry-run",
      ].join("\n"),
    )
    expect(text).toContain("\nRESPONSES\n  204 no content\n")
  })

  it("wraps the facts line, the variable options and the response fields", () => {
    const long = renderDescribeText({ ...sample, operationId: `run${"Sample".repeat(12)}` })
    expect(long).toContain(
      [
        "  POST /sample/{id}/run (effect: bulk, operationId:",
        `    run${"Sample".repeat(12)})`,
      ].join("\n"),
    )
    const correlate = renderDescribeText(view("message", "correlate"))
    expect(correlate).toContain(
      [
        "  Variable options: --correlation-key (correlationKeys), --local-correlation-key",
        "    (localCorrelationKeys), --var (processVariables), --local-var (processVariablesLocal),",
        "    --triggered-scope-var (processVariablesToTriggeredScope)",
      ].join("\n"),
    )
    const fetch = renderDescribeText(view("external-task", "fetch-and-lock"))
    expect(fetch).toContain(
      [
        "RESPONSES",
        "  200 json (application/json): array<LockedExternalTaskDto>",
        "    Fields: activityId, activityInstanceId, errorMessage, errorDetails, executionId, id,",
        "      lockExpirationTime, processDefinitionId, processDefinitionKey, processDefinitionVersionTag,",
        "      processInstanceId, tenantId, retries, suspended, workerId, priority, topicName, businessKey,",
        "      variables, extensionProperties, createTime",
        "",
      ].join("\n"),
    )
    expect(fetch).toContain(
      "  --max-tasks <n>               Required. The maximum number of tasks to return.\n",
    )
  })
})
