import type { MessageCatalog } from "@miragon/mcp-toolkit-core"

/** Namen im Ansichts-Editor; die `description` der Definitionen bleibt der Text für das Modell. */
export const deBuilder: MessageCatalog = {
  "builder.app.title": "Analyse",

  "builder.widget.execution-summary-kpi.title": "Ausführungskennzahlen",
  "builder.widget.execution-summary-kpi.summary":
    "Gestartete und beendete Instanzen und neue Incidents im Zeitraum, dazu was gerade läuft.",
  "builder.widget.execution-performance-kpi.title": "Ausführungsleistung",
  "builder.widget.execution-performance-kpi.summary":
    "Durchschnitt, Median und P95 der Dauer der im Zeitraum beendeten Instanzen und Incidents je 100 Starts.",
  "builder.widget.process-definition-breakdown.title": "Nach Prozessdefinition",
  "builder.widget.process-definition-breakdown.summary":
    "Starts, Abschlüsse, Incidents, laufende Instanzen und durchschnittliche Dauer je Prozessdefinition.",
  "builder.widget.activity-bottleneck-table.title": "Aktivitäten nach Gesamtzeit",
  "builder.widget.activity-bottleneck-table.summary":
    "Die Aktivitäten, die im Zeitraum am meisten Zeit brauchen, über alle Prozesse.",
  "builder.widget.failure-summary-kpi.title": "Fehleranalyse",
  "builder.widget.failure-summary-kpi.summary":
    "Die gerade offenen Incidents, ihre Gruppen nach Typ und Prozess und der am stärksten betroffene Prozess.",
  "builder.widget.error-patterns-table.title": "Offene Incidents nach Typ",
  "builder.widget.error-patterns-table.summary":
    "Die gerade offenen Incidents, gruppiert nach Typ und Prozessdefinition.",
  "builder.widget.failure-rate-table.title": "Offene Incidents nach Prozess",
  "builder.widget.failure-rate-table.summary":
    "Je Prozess: laufende Instanzen, Jobs ohne Versuche, offene Incidents und Incidents je 100 laufende Instanzen.",
  "builder.widget.cluster-compare.title": "Vor und nach dem Deployment",
  "builder.widget.cluster-compare.summary":
    "Die Kennzahlen der Instanzen vor und nach einem Deployment, nebeneinander.",
  "builder.widget.version-compare.title": "Versionsvergleich",
  "builder.widget.version-compare.summary":
    "Die Kennzahlen zweier Versionen eines Prozesses nebeneinander.",
  "builder.widget.engine-compare.title": "Engine-Vergleich",
  "builder.widget.engine-compare.summary":
    "Die Kennzahlen eines Prozesses auf zwei Engines nebeneinander.",
  "builder.widget.engine-landscape.title": "Engine-übergreifende Übersicht",
  "builder.widget.engine-landscape.summary":
    "Was wo läuft, die Last je Engine und der Rückstau der Jobs, als Zahlen über alle Engines.",
  "builder.widget.bpmn-heatmap.title": "BPMN-Heatmap",
  "builder.widget.bpmn-heatmap.summary":
    "Das Diagramm mit der Häufigkeit oder der Dauer je Element.",
  "builder.widget.settings.title": "Analyse-Einstellungen",
  "builder.widget.settings.summary":
    "Dein Standard-Zeitraum und die Mindestgröße eines Vergleichs.",

  "builder.step.load-dashboard.title": "Prozessanalyse",
  "builder.step.load-dashboard.summary":
    "Liest die Ausführungskennzahlen des Zeitraums und den aktuellen Stand aus Prometheus.",
  "builder.step.load-failure-dashboard.title": "Fehleranalyse",
  "builder.step.load-failure-dashboard.summary":
    "Liest die gerade offenen Incidents und die Jobs ohne Versuche aus Prometheus.",

  "builder.field.dashboard.processDefinitionKey.title": "Schlüssel der Prozessdefinition",
  "builder.field.dashboard.processDefinitionKey.summary":
    "Beschränkt die Kennzahlen auf eine Prozessdefinition. Ohne Angabe alle Prozesse.",
  "builder.field.dashboard.period.title": "Zeitraum",
  "builder.field.dashboard.period.summary":
    "Der Zeitraum, den das Widget lädt, wenn keine Datenquelle ihn liefert.",
  "builder.field.dashboard.engine.title": "Engines",
  "builder.field.dashboard.engine.summary":
    "Die Engines, aus denen gelesen wird. Ohne Angabe alle eingerichteten Engines.",
  "builder.field.failure.engine.title": "Engines",
  "builder.field.failure.engine.summary":
    "Die Engines, aus denen gelesen wird. Ohne Angabe alle eingerichteten Engines.",
  "builder.field.engineLandscape.engine.title": "Engines",
  "builder.field.engineLandscape.engine.summary":
    "Die Engines in der Übersicht. Ohne Angabe alle eingerichteten Engines.",
}
