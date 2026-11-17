const STARTED_AT = "2026-11-05T10:00:00.000Z"

export function definition(key: string, id: string, version: number, extra: object = {}) {
  return {
    processDefinitionKey: key,
    processDefinitionId: id,
    version,
    name: `${id} name`,
    state: "ACTIVE",
    ...extra,
  }
}

export function instance(key: string, extra: object = {}) {
  return {
    processInstanceKey: key,
    processDefinitionKey: "100",
    processDefinitionId: "order",
    processDefinitionVersion: 1,
    processDefinitionName: "Order",
    state: "ACTIVE",
    hasIncident: false,
    startDate: STARTED_AT,
    ...extra,
  }
}

export function incident(key: string, extra: object = {}) {
  return {
    incidentKey: key,
    processInstanceKey: "200",
    processDefinitionKey: "100",
    elementId: "Charge",
    errorType: "JOB_NO_RETRIES",
    errorMessage: "Card expired",
    creationTime: STARTED_AT,
    elementInstanceKey: "300",
    jobKey: "400",
    ...extra,
  }
}

export function variable(name: string, value: string, extra: object = {}) {
  return {
    name,
    value,
    isTruncated: false,
    scopeKey: "200",
    processInstanceKey: "200",
    ...extra,
  }
}
