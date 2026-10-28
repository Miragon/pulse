/**
 * Static on purpose (#338): `askAiPrompt` adds ids, data and tools. Posted in the
 * user's name, so plain words and the "Change nothing." guardrail.
 */
export const enAskAi = {
  "askAi.clusterCompare":
    "Interpret this comparison before and after a deployment in three or four sentences. Is it a real regression or noise? Which metric, and which element, drives it? Recommend one action: roll back, stop further rollouts, or accept.",
  "askAi.engineCompare":
    "Interpret this comparison of one process on two engines in three or four sentences. Does the second engine really run it worse, or is it noise? Which metric drives the gap? Recommend one action.",
  "askAi.versionCompare":
    "Interpret this version comparison in three or four sentences. Is the new version really worse, or is it noise? Which element drives it? Recommend one action: move running instances back, stop the rollout, or accept.",
  "askAi.landscapeCompare":
    "Compare this process between the two engines. Show the comparison side by side, say on which engine it runs better and whether the gap is significant, and recommend one action. Recommend only.",
  "askAi.executionSummary":
    "Assess the process analytics on screen. Is it healthy or getting worse? What most likely causes the incidents, and which next step helps most? Keep it short.",
  "askAi.activityBottleneck":
    "Explain why this activity is a bottleneck: long executions or sheer volume, waiting or working for its type. Tell me what to look at next. Change nothing.",
  "askAi.failureSummary":
    "Sort the open incidents by urgency. Group them by their likely common cause, tell a systemic outage from isolated bugs in single processes, and rank what I should fix first. Check it against the live state. Analysis only.",
  "askAi.failureRate":
    "Explain what drives the open incidents of this process. Is it a regression (recent periods, or the periods around a deployment), and which activity fails most? Change nothing.",
  "askAi.errorPattern":
    "Find the cause of this group of open incidents. Read their messages and the failing activity, then name the likely cause, whether it is temporary or systemic, and the fix you recommend. Change nothing.",
} satisfies Record<string, string>

export type AnalyticsAskAiKey = keyof typeof enAskAi
