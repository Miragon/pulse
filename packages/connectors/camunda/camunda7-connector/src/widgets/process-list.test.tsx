// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import type { ComponentType } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { ProcessListWidget } from "./process-list.js"
import type { ProcessListData } from "../view-models.js"
import { TestViewHost } from "@miragon/pulse-widget-shell/widgets"

afterEach(cleanup)

const PROCESS_LIST: ProcessListData = {
  definitions: [
    {
      id: "d1",
      key: "invoice",
      name: "Invoice Process",
      version: 3,
      deploymentId: "dep-1",
      suspended: false,
      versionTag: null,
      tenantId: null,
    },
    {
      id: "d2",
      key: "onboarding",
      name: null,
      version: 1,
      deploymentId: "dep-2",
      suspended: true,
      versionTag: "v1",
      tenantId: null,
    },
  ],
  totalCount: 2,
  filters: { latestVersion: true },
  engineId: "default",
}

const Widget = ProcessListWidget as unknown as ComponentType<Record<string, unknown>>

describe("ProcessListWidget (fixture render)", () => {
  // The view's data only: the self-fetch is covered by paged-lists.test.tsx.
  it("renders process definitions, version, and active/suspended status from data", () => {
    render(
      <TestViewHost>
        <Widget data={PROCESS_LIST as never} />
      </TestViewHost>,
    )

    expect(screen.getByText("Process definitions")).toBeTruthy()

    expect(
      screen.getByRole("table", { name: "Deployed process definitions with version and status" }),
    ).toBeTruthy()

    expect(screen.getByText("Invoice Process")).toBeTruthy()
    expect(screen.getByText("invoice")).toBeTruthy()
    expect(screen.getByText("Active")).toBeTruthy()

    expect(screen.getByText("Suspended")).toBeTruthy()
  })
})
