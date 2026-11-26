import type { EngineHealthData } from "../view-models.js"

/** The overview's fixtures, its verdict's tests and its top failures' alike. */

const RULE =
  "From the engine's open root incidents (a copy at a call activity never counts), read live: critical at >=50 open root incidents or >=25 of one cause, warning with any, else ok."

/** A degraded engine with two failure clusters, one of them across two processes. */
export const DEGRADED: EngineHealthData = {
  status: "warning",
  statusRule: RULE,
  summary: {
    totalIncidents: 51,
    lastHourIncidents: 9,
    affectedActivities: 3,
    affectedDefinitions: 2,
    runningInstances: 312,
    totalDefinitions: 8,
    started24h: 1240,
    completed24h: 1180,
  },
  clusters: [
    {
      id: "callWMS::failedExternalTask",
      activityId: "callWMS",
      activityName: null,
      incidentType: "failedExternalTask",
      messageSignature: "connection timeout to wms",
      incidentCount: 40,
      scannedIncidentCount: 40,
      processDefinitionKeys: ["shipping"],
      processDefinitionName: null,
      representativeMessage: "Connection timeout to WMS",
      representativeIncidentId: "inc-1",
      latestIncident: "2026-06-11T14:00:00.000Z",
    },
    {
      id: "checkCustomer::failedJob",
      activityId: "checkCustomer",
      activityName: null,
      incidentType: "failedJob",
      messageSignature: "customerid is null",
      incidentCount: 8,
      scannedIncidentCount: 8,
      processDefinitionKeys: ["onboarding", "shipping"],
      processDefinitionName: null,
      representativeMessage: "customerId is null",
      representativeIncidentId: "inc-2",
      latestIncident: "2026-06-11T13:00:00.000Z",
    },
  ],
  fetchedAt: "2026-06-11T14:05:00.000Z",
  engineId: "default",
}

/** A stable engine without an open incident. */
export const HEALTHY: EngineHealthData = {
  status: "ok",
  statusRule: RULE,
  summary: {
    totalIncidents: 0,
    lastHourIncidents: 0,
    affectedActivities: 0,
    affectedDefinitions: 0,
    runningInstances: 312,
    totalDefinitions: 8,
    started24h: 1240,
    completed24h: 1180,
  },
  clusters: [],
  fetchedAt: "2026-06-11T14:05:00.000Z",
  engineId: "default",
}
