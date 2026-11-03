/**
 * Static on purpose (#338): no data and no tool names; `askAiPrompt` adds the ids, facts and
 * fenced engine text, and a hand-off names no tool. Posted in the user's name, so plain words
 * and the "Change nothing." guardrail.
 */
export const enAskAi = {
  "askAi.periodCompare":
    "Interpret this comparison of two periods in three or four sentences. Is it a real regression or noise? Which metric drives it? Recommend one action.",
  "askAi.engineCompare":
    "Interpret this comparison of one process on two engines in three or four sentences. Does the second engine really run it worse, or is it noise? Which metric drives the gap? Recommend one action.",
  "askAi.versionCompare":
    "Interpret this version comparison in three or four sentences. Is the new version really worse, or is it noise? Which metric drives it? Recommend one action: move running instances back, stop the rollout, or accept.",
  "askAi.landscapeCompare":
    "Compare this process between the two engines. Show the comparison side by side, say on which engine it runs better and whether the gap is significant, and recommend one action. Recommend only.",
  "askAi.executionSummary":
    "Assess the process analytics on screen. Is it healthy or getting worse? What most likely causes the incidents, and which next step helps most? Keep it short.",
  "askAi.activityBottleneck":
    "Explain why this activity is a bottleneck: long executions or sheer volume, waiting or working for its type. Tell me what to look at next. Change nothing.",
} satisfies Record<string, string>

export type AnalyticsAskAiKey = keyof typeof enAskAi
