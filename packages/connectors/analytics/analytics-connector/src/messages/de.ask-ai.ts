import type { AnalyticsAskAiKey } from "./en.ask-ai.js"

/**
 * Same keys as `en.ask-ai.ts` (the type enforces parity). Posted in the user's name, so plain du-
 * German, and the guardrail ending ("Ändere nichts.") stays.
 */
export const deAskAi: Record<AnalyticsAskAiKey, string> = {
  "askAi.clusterCompare":
    "Deute diesen Vergleich vor und nach einem Deployment in drei bis vier Sätzen. Ist es eine echte Verschlechterung oder Rauschen? Welche Kennzahl und welches Element treiben sie? Empfiehl eine Maßnahme: zurückrollen, weitere Rollouts stoppen oder akzeptieren.",
  "askAi.engineCompare":
    "Deute diesen Vergleich eines Prozesses auf zwei Engines in drei bis vier Sätzen. Läuft er auf der zweiten Engine wirklich schlechter, oder ist es Rauschen? Welche Kennzahl treibt den Abstand? Empfiehl eine Maßnahme.",
  "askAi.versionCompare":
    "Deute diesen Versionsvergleich in drei bis vier Sätzen. Ist die neue Version wirklich schlechter, oder ist es Rauschen? Welches Element treibt den Unterschied? Empfiehl eine Maßnahme: laufende Instanzen zurückmigrieren, den Rollout stoppen oder akzeptieren.",
  "askAi.landscapeCompare":
    "Vergleich diesen Prozess zwischen den beiden Engines. Zeig den Vergleich nebeneinander, sag, auf welcher Engine er besser läuft und ob der Abstand signifikant ist, und empfiehl eine Maßnahme. Nur empfehlen.",
  "askAi.executionSummary":
    "Bewerte die Prozessanalyse auf dem Bildschirm. Ist alles gesund, oder wird es schlechter? Was verursacht die Incidents am wahrscheinlichsten, und welcher nächste Schritt bringt am meisten? Fass dich kurz.",
  "askAi.activityBottleneck":
    "Erklär, warum diese Aktivität ein Engpass ist: lange Ausführungen oder schiere Menge, Warten oder Arbeiten je nach Typ. Sag mir, was ich mir als Nächstes ansehen sollte. Ändere nichts.",
  "askAi.failureSummary":
    "Ordne die offenen Incidents nach Dringlichkeit. Gruppier sie nach ihrer wahrscheinlichen gemeinsamen Ursache, unterscheide einen systemischen Ausfall von einzelnen Fehlern in einzelnen Prozessen und sag mir, was ich zuerst beheben sollte. Prüf das gegen den Live-Zustand. Nur analysieren.",
  "askAi.failureRate":
    "Erklär, was die offenen Incidents dieses Prozesses treibt. Ist es eine Verschlechterung (jüngste Zeiträume oder die Zeiträume um ein Deployment), und welche Aktivität schlägt am häufigsten fehl? Ändere nichts.",
  "askAi.errorPattern":
    "Finde die Ursache dieser Gruppe offener Incidents. Lies ihre Meldungen und die fehlschlagende Aktivität, dann nenn die wahrscheinliche Ursache, ob sie vorübergehend oder systemisch ist, und die Behebung, die du empfiehlst. Ändere nichts.",
}
