/**
 * Static on purpose (#338): no data or tool names; `askAiPrompt` adds them. Posted as the
 * user's message, so written in the operator's voice, guardrail ending ("Change nothing.") kept.
 */
export const enAskAi = {
  "askAi.jobs.triage":
    "Sort the jobs without retries by cause: group them, name the likely root cause of each group and recommend one action per group. Recommend only and change nothing.",
  "askAi.jobs.explainFailure":
    "Explain why this job failed: what broke, whether the failure is temporary or will repeat, and whether a retry is safe or will fail again. Change nothing.",
  "askAi.jobs.draftTicket":
    "Draft an incident ticket for this failed job: find its incident, write the draft and show it to me for review. Don't file it anywhere.",
  "askAi.health.triage":
    "Assess this engine's health: rank the incident clusters by impact, name the most urgent problem in business terms, its likely root cause and the first step to fix it. Change nothing without my confirmation.",
  "askAi.health.diagnoseUnreachable":
    "The engine health check failed. Find out why the engine is not reachable (down, wrong base URL, authentication or network) and name the next step. Change nothing.",
  "askAi.cluster.fix":
    "Help me fix this incident cluster: confirm the root cause, then propose a fix for exactly this cluster. Show me the plan and how many instances it affects, and run nothing until I confirm.",
  "askAi.cluster.diagnose":
    "Explain this incident cluster in plain language: confirm the root cause and whether a retry would help. This connection cannot change the engine, so draft a ticket if it needs a fix.",
  "askAi.history.explainInstance":
    "Explain where this process instance spent its time: the longest step, waiting versus working, and whether this run is unusual.",
  "askAi.history.explainActivity":
    "Explain why this step took so long: waiting or working, and whether the duration is typical for it. Change nothing.",
  "askAi.fleet.overview":
    "Give me an overview of these engines: where most of the work and most of the trouble are, any job backlog or silent engine, and where to start. Recommend only.",
  "askAi.fleet.failures":
    "Analyze the failures across these engines: the dominant failure cluster, whether it is isolated or systemic, and the fix that helps most.",
  "askAi.fleet.performance":
    "Give me an overview of process performance across these engines: the slowest processes and the main bottleneck. Compare processes, not engines.",
  "askAi.instances.rootCause":
    "Find the root cause of this instance's incident, check whether other instances of the process fail the same way, and recommend a fix for this instance or the whole cluster.",
  "askAi.instances.triageProcess":
    "Sort this process's running instances by urgency: group the incidents by failing activity and type, name the dominant failure, and say how many instances a retry would fix and how many need a data or model fix. Recommend only.",
  "askAi.instances.triageEngine":
    "Sort the running instances on this engine by urgency across all processes: group the failures by process, activity and type, and give me a prioritized list per process. Recommend only.",
  "askAi.instance.explainTimeline":
    "Explain this instance's execution timeline: where the token spent the most time, where it is stuck, and whether the path matches the normal flow. Change nothing.",
  "askAi.instance.checkVariables":
    "Explain and check this instance's variables: flag values that look missing, malformed or contradictory and could explain its incidents. Propose corrections and set nothing without my confirmation.",
  "askAi.instance.diagnose":
    "Find out why this process instance is stuck: the root cause of each open incident, whether other instances fail the same way, and the best fix. Show me the plan and run nothing.",
  "askAi.incident.diagnose":
    "Find the root cause of this incident: the likely cause, whether a plain retry will succeed, and the fix you recommend (retry, data correction, instance modification or escalation).",
  "askAi.incident.explainError":
    "Explain this incident's error in plain language: what it means, the likely cause, and whether it is temporary (a retry is safe) or will repeat (a retry fails again). Change nothing.",
  "askAi.incident.draftTicket":
    "Draft an incident ticket for this incident and show me its title, body and labels for review. Don't file it anywhere.",
  "askAi.process.triage":
    "Sort this process definition's incidents by root cause, separate symptoms from sources and recommend a fix per cluster. Diagnosis only.",
  "askAi.process.healthCheck":
    "Check the health of this process definition: healthy or degraded, the worst activities, the most common incident message, the most likely root cause and one next step. Change nothing.",
  "askAi.bpmn.explainState":
    "Explain this instance's state on the diagram: which elements block progress, what each incident means, whether the hotspots of jobs without retries point to a systemic fault, and the next steps by priority.",
  "askAi.landscape.triage":
    "Rank the affected processes on this engine by severity: name the most urgent one, its likely root cause and the first step to fix it.",
  "askAi.incidents.processRootCause":
    "Find the root cause of this process's open incidents: do the failing activities share one cause, is it temporary, a data or configuration problem or a broken model, and which fix do you recommend? Change nothing without my confirmation.",
  "askAi.incidents.triage":
    "Sort all open incidents on this engine: cluster them by error and failing activity, rank the clusters by impact, and name the most likely systemic root cause and the next step for each top cluster. Change nothing yet.",
  "askAi.incidents.triageFiltered":
    "Sort the open incidents this view is filtered to: cluster them by error and failing activity, rank the clusters by impact, and name the most likely root cause and the next step for each top cluster. Change nothing yet.",
} satisfies Record<string, string>

export type Camunda7AskAiKey = keyof typeof enAskAi
