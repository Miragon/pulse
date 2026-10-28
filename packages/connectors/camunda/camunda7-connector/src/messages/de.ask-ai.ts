import type { Camunda7AskAiKey } from "./en.ask-ai.js"

/** Steht als Nachricht der Person im Chat, die klickt; die Schlussformel („Ändere nichts.“) bleibt. */
export const deAskAi: Record<Camunda7AskAiKey, string> = {
  "askAi.jobs.triage":
    "Ordne die Jobs ohne Versuche nach Ursache: Gruppier sie, nenn je Gruppe die wahrscheinliche Ursache und empfiehl je Gruppe eine Maßnahme. Nur empfehlen, ändere nichts.",
  "askAi.jobs.explainFailure":
    "Erklär, warum dieser Job fehlgeschlagen ist: Was ist kaputt, ist der Fehler vorübergehend oder kommt er wieder, und hilft ein neuer Versuch oder schlägt er wieder fehl? Ändere nichts.",
  "askAi.jobs.draftTicket":
    "Entwirf ein Incident-Ticket für diesen fehlgeschlagenen Job: Finde den zugehörigen Incident, schreib den Entwurf und zeig ihn mir zur Prüfung. Reich ihn nirgends ein.",
  "askAi.health.triage":
    "Bewerte den Zustand dieser Engine: Ordne die Incident-Cluster nach Auswirkung, nenn das dringendste Problem fachlich, seine wahrscheinliche Ursache und den ersten Schritt zur Behebung. Ändere nichts ohne meine Bestätigung.",
  "askAi.health.diagnoseUnreachable":
    "Die Zustandsprüfung der Engine ist fehlgeschlagen. Finde heraus, warum die Engine nicht erreichbar ist (ausgefallen, falsche Basis-URL, Anmeldung oder Netzwerk), und nenn den nächsten Schritt. Ändere nichts.",
  "askAi.cluster.fix":
    "Hilf mir, diesen Incident-Cluster zu beheben: Bestätige die Ursache und schlag dann eine Behebung genau für diesen Cluster vor. Zeig mir den Plan und wie viele Instanzen betroffen sind, und führ nichts aus, bevor ich bestätige.",
  "askAi.cluster.diagnose":
    "Erklär diesen Incident-Cluster in einfachen Worten: Bestätige die Ursache und sag, ob ein neuer Versuch hilft. Diese Verbindung kann die Engine nicht ändern, also entwirf ein Ticket, falls eine Behebung nötig ist.",
  "askAi.history.explainInstance":
    "Erklär, wo diese Prozessinstanz ihre Zeit verbracht hat: der längste Schritt, Warten oder Arbeiten, und ob dieser Durchlauf auffällig ist.",
  "askAi.history.explainActivity":
    "Erklär, warum dieser Schritt so lange gedauert hat: Warten oder Arbeiten, und ob die Dauer für ihn normal ist. Ändere nichts.",
  "askAi.fleet.overview":
    "Gib mir einen Überblick über diese Engines: Wo liegt die meiste Arbeit, wo liegen die meisten Probleme, gibt es einen Job-Rückstau oder eine stille Engine, und wo fange ich an? Nur empfehlen.",
  "askAi.fleet.failures":
    "Analysier die Fehler über diese Engines: der häufigste Fehler-Cluster, ob er einzeln oder systematisch auftritt, und die Behebung mit der größten Wirkung.",
  "askAi.fleet.performance":
    "Gib mir einen Überblick über die Prozess-Performance dieser Engines: die langsamsten Prozesse und der größte Engpass. Vergleich Prozesse, nicht Engines.",
  "askAi.instances.rootCause":
    "Finde die Ursache des Incidents dieser Instanz, prüf, ob andere Instanzen des Prozesses genauso fehlschlagen, und empfiehl eine Behebung für diese Instanz oder den ganzen Cluster.",
  "askAi.instances.triageProcess":
    "Ordne die laufenden Instanzen dieses Prozesses nach Dringlichkeit: Gruppier die Incidents nach fehlschlagender Aktivität und Typ, nenn den häufigsten Fehler und sag, wie viele Instanzen ein neuer Versuch behebt und wie viele eine Daten- oder Modellkorrektur brauchen. Nur empfehlen.",
  "askAi.instances.triageEngine":
    "Ordne die laufenden Instanzen dieser Engine über alle Prozesse nach Dringlichkeit: Gruppier die Fehler nach Prozess, Aktivität und Typ und gib mir je Prozess eine Liste nach Priorität. Nur empfehlen.",
  "askAi.instance.explainTimeline":
    "Erklär den Ablauf dieser Instanz: Wo hat der Token die meiste Zeit verbracht, wo hängt er, und folgt der Pfad dem normalen Ablauf? Ändere nichts.",
  "askAi.instance.checkVariables":
    "Erklär und prüf die Variablen dieser Instanz: Markier Werte, die fehlen, kaputt oder widersprüchlich wirken und ihre Incidents erklären könnten. Schlag Korrekturen vor und setz nichts ohne meine Bestätigung.",
  "askAi.instance.diagnose":
    "Finde heraus, warum diese Prozessinstanz hängt: die Ursache jedes offenen Incidents, ob andere Instanzen genauso fehlschlagen, und die beste Behebung. Zeig mir den Plan und führ nichts aus.",
  "askAi.incident.diagnose":
    "Finde die Ursache dieses Incidents: die wahrscheinliche Ursache, ob ein einfacher neuer Versuch gelingt, und die Behebung, die du empfiehlst (neuer Versuch, Datenkorrektur, Änderung der Instanz oder Eskalation).",
  "askAi.incident.explainError":
    "Erklär den Fehler dieses Incidents in einfachen Worten: was er bedeutet, die wahrscheinliche Ursache, und ob er vorübergehend ist (ein neuer Versuch ist sicher) oder wiederkommt (ein neuer Versuch schlägt wieder fehl). Ändere nichts.",
  "askAi.incident.draftTicket":
    "Entwirf ein Incident-Ticket für diesen Incident und zeig mir Titel, Text und Labels zur Prüfung. Reich es nirgends ein.",
  "askAi.process.triage":
    "Ordne die Incidents dieser Prozessdefinition nach Ursache, trenn Symptome von Quellen und empfiehl je Cluster eine Behebung. Nur Diagnose.",
  "askAi.process.healthCheck":
    "Prüf den Zustand dieser Prozessdefinition: gesund oder beeinträchtigt, die schlechtesten Aktivitäten, die häufigste Incident-Meldung, die wahrscheinlichste Ursache und einen nächsten Schritt. Ändere nichts.",
  "askAi.bpmn.explainState":
    "Erklär den Zustand dieser Instanz im Diagramm: welche Elemente den Fortschritt blockieren, was jeder Incident bedeutet, ob die Häufungen von Jobs ohne Versuche auf einen systematischen Fehler deuten, und die nächsten Schritte nach Priorität.",
  "askAi.landscape.triage":
    "Ordne die betroffenen Prozesse dieser Engine nach Schwere: Nenn den dringendsten, seine wahrscheinliche Ursache und den ersten Schritt zur Behebung.",
  "askAi.incidents.processRootCause":
    "Finde die Ursache der offenen Incidents dieses Prozesses: Haben die fehlschlagenden Aktivitäten eine gemeinsame Ursache, ist sie vorübergehend, ein Daten- oder Konfigurationsproblem oder ein fehlerhaftes Modell, und welche Behebung empfiehlst du? Ändere nichts ohne meine Bestätigung.",
  "askAi.incidents.triage":
    "Ordne alle offenen Incidents dieser Engine: Clustere sie nach Fehler und fehlschlagender Aktivität, sortier die Cluster nach Auswirkung und nenn die wahrscheinlichste systematische Ursache und den nächsten Schritt je Top-Cluster. Ändere noch nichts.",
  "askAi.incidents.triageFiltered":
    "Ordne die offenen Incidents, auf die diese Ansicht gefiltert ist: Clustere sie nach Fehler und fehlschlagender Aktivität, sortier die Cluster nach Auswirkung und nenn die wahrscheinlichste Ursache und den nächsten Schritt je Top-Cluster. Ändere noch nichts.",
}
