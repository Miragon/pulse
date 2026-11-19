// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { createElement, type ComponentType } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { LocaleProvider } from "@miragon/pulse-ui"
import type {
  ClusterDetailData,
  CockpitDashboardData,
  IncidentsDashboardData,
  ProcessInstancesData,
} from "../view-models.js"
import { catalogs } from "../messages/index.js"
import { ClusterDetailWidget } from "./cluster-detail.js"
import { ProcessDefinitionsTable } from "./cockpit-dashboard/definitions-table.js"
import { IncidentProcessList } from "./incidents-dashboard/process-list.js"
import { ProcessInstancesWidget } from "./process-instances/list.js"
import { TestViewHost } from "@miragon/pulse-widget-shell/widgets"

// WCAG 2.5.3: named by the placeholder's words, never the FilterBar's generic "Filter"; a placeholder
// vanishes while typing and voice users say the words they see. The name starts with them and may
// go on to say what the box searches where a short placeholder fits a narrow field.

/** The label is the placeholder's words, or goes on after them with a space: never a cut word. */
function startsWithWholeWords(label: string, placeholder: string): boolean {
  if (!/\S…$/.test(placeholder)) return false
  const words = placeholder.slice(0, -1)
  return label === words || label.startsWith(`${words} `)
}

afterEach(() => {
  cleanup()
})

const INSTANCES: ProcessInstancesData = {
  processDefinitionKey: "invoice",
  processDefinitionName: "Invoice",
  totalCount: 1,
  returnedCount: 1,
  allCount: 1,
  withIncidentCount: 0,
  suspendedCount: 0,
  instances: [
    {
      id: "pi-1",
      businessKey: "BK-1",
      processDefinitionKey: "invoice",
      processDefinitionName: null,
      version: 1,
      suspended: false,
      hasIncident: false,
    },
  ],
  filters: {},
  engineId: "prod-a",
}

const CLUSTER: ClusterDetailData = {
  activityId: "callWMS",
  activityName: null,
  incidentType: "failedExternalTask",
  messageSignature: "connection timeout",
  incidentCount: 1,
  scannedIncidentCount: 1,
  lastHourCount: 1,
  last24hCount: 1,
  firstSeen: "2026-06-11T08:00:00.000Z",
  latestIncident: "2026-06-11T14:00:00.000Z",
  processDefinitionKeys: ["shipping"],
  representativeMessage: "Connection timeout",
  incidents: [
    {
      incidentId: "inc-1",
      processInstanceId: "pi-1",
      businessKey: "ORDER-4711",
      processDefinitionKey: "shipping",
      processDefinitionName: null,
      incidentTimestamp: "2026-06-11T14:00:00.000Z",
    },
  ],
  totalMatching: 1,
  fetchedAt: "2026-06-11T14:05:00.000Z",
  engineId: "prod-a",
}

const LANDSCAPE: CockpitDashboardData = {
  summary: { totalDefinitions: 1, totalRunningInstances: 4, totalFailedJobs: 0, totalIncidents: 0 },
  definitions: [
    {
      id: "invoice:1:d",
      key: "invoice",
      name: "Invoice Process",
      latestVersion: 1,
      instances: 4,
      failedJobs: 0,
      incidents: [],
    },
  ],
  engineId: "prod-a",
}

const INCIDENTS: IncidentsDashboardData = {
  totalCount: 2,
  processCount: 1,
  affectedActivityCount: 1,
  last24hCount: 1,
  latestIncident: "2026-10-10T12:00:00.000+0000",
  filters: {},
  engineVendor: "CIB seven",
  engineId: "prod-a",
  processes: [
    {
      processDefinitionKey: "shipping",
      processDefinitionName: "Shipping",
      latestVersion: 1,
      runningInstances: 3,
      incidentCount: 2,
      scannedIncidentCount: 2,
      affectedActivityCount: 1,
      last24hCount: 1,
      latestIncident: "2026-10-10T12:00:00.000+0000",
      cockpitUrl: null,
      activities: [],
    },
  ],
}

type Locale = "en" | "de"

interface SearchSite {
  widget: ComponentType<Record<string, unknown>>
  search: Record<Locale, string>
  /** A scope picked in segments: a radio group of its own name. */
  scope?: Record<Locale, string>
}

const SITES: Record<string, SearchSite> = {
  "process instances": {
    widget: () => (
      <ProcessInstancesWidget data={INSTANCES} processDefinitionKey="invoice" engine="prod-a" />
    ),
    search: {
      en: "Search instances by business key or ID",
      de: "Instanzen suchen nach Geschäftsschlüssel oder ID",
    },
    scope: { en: "Show instances", de: "Instanzen zeigen" },
  },
  "cluster detail": {
    widget: () => (
      <ClusterDetailWidget
        data={CLUSTER}
        engine="prod-a"
        activityId={CLUSTER.activityId}
        incidentType={CLUSTER.incidentType}
        messageSignature={CLUSTER.messageSignature ?? undefined}
      />
    ),
    search: { en: "Filter by business key", de: "Nach Geschäftsschlüssel filtern" },
  },
  "cockpit definitions": {
    widget: () => <ProcessDefinitionsTable data={LANDSCAPE} engine="prod-a" />,
    search: { en: "Filter by name or key", de: "Nach Name oder Key filtern" },
  },
  "incidents list": {
    widget: () => <IncidentProcessList data={INCIDENTS} engine="prod-a" />,
    search: {
      en: "Filter incidents by process, activity or error message",
      de: "Incidents filtern nach Prozess, Aktivität oder Fehlermeldung",
    },
    scope: { en: "Show incidents", de: "Incidents zeigen" },
  },
}

const CASES = Object.keys(SITES).flatMap((site) =>
  (["en", "de"] as const).map((locale) => [site, locale] as const),
)

describe("every search box is named by what it searches", () => {
  it.each(CASES)("%s (%s)", (site, locale) => {
    const { widget, search, scope } = SITES[site]
    render(
      <LocaleProvider locale={locale}>
        <TestViewHost>{createElement(widget)}</TestViewHost>
      </LocaleProvider>,
    )

    const box = screen.getByRole("searchbox", { name: search[locale] })
    expect(startsWithWholeWords(search[locale], box.getAttribute("placeholder") ?? "")).toBe(true)
    if (scope) expect(screen.getByRole("radiogroup", { name: scope[locale] })).toBeTruthy()
  })
})

describe("the catalogs start each search label with its placeholder's words", () => {
  it.each(["en", "de"] as const)("%s", (locale) => {
    const catalog = catalogs[locale]
    const labels = Object.keys(catalog).filter((key) => key.endsWith(".searchLabel"))
    expect(labels).toHaveLength(Object.keys(SITES).length)
    for (const key of labels) {
      const placeholder = catalog[key.replace(/searchLabel$/, "searchPlaceholder")]
      expect(startsWithWholeWords(String(catalog[key]), String(placeholder)), key).toBe(true)
    }
  })
})
