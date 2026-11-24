import { BarChart, LineChart, MeterRows, Sparkline, type ChartPoint } from "./index.js"
import type { RenderCase } from "./render-cases-primitives.js"

/**
 * SSR render cases for the charts, aggregated by `render-cases.tsx`. A server render measures no
 * width, so it draws the frame, the legend and the table, the words a reader meets first; the
 * drawing at a width is `components/charts/charts.test.tsx`'s.
 */

const DAYS: ChartPoint[] = [
  { key: "d1", label: "Nov 22", values: { started: 12, ended: 9 } },
  { key: "d2", label: "Nov 23", values: { started: { atLeast: 2000 }, ended: null } },
  { key: "d3", label: "Nov 24", values: { started: 7, ended: 11, incidents: 2 } },
]

export const CHART_RENDER_CASES: RenderCase[] = [
  {
    name: "BarChart",
    marker: "RC:BarChart",
    render: () => (
      <BarChart
        label="RC:BarChart"
        categoryLabel="Day"
        series={[
          { key: "started", label: "Started" },
          { key: "ended", label: "Ended" },
          { key: "incidents", label: "Incidents", kind: "incident" },
        ]}
        points={DAYS}
      />
    ),
  },
  {
    name: "LineChart",
    marker: "RC:LineChart",
    render: () => (
      <LineChart
        label="RC:LineChart"
        categoryLabel="Day"
        series={[
          { key: "started", label: "Started" },
          { key: "ended", label: "Ended" },
        ]}
        points={DAYS}
      />
    ),
  },
  {
    name: "Sparkline",
    marker: "RC:Sparkline",
    render: () => (
      <Sparkline
        label="RC:Sparkline"
        categoryLabel="Day"
        points={[
          { key: "d1", label: "Nov 22", value: 12 },
          { key: "d2", label: "Nov 23", value: null },
          { key: "d3", label: "Nov 24", value: 7 },
        ]}
      />
    ),
  },
  {
    name: "MeterRows",
    marker: "RC:MeterRows",
    render: () => (
      <MeterRows
        label="Outcomes of the last 14 days"
        rows={[
          { key: "approved", label: "RC:MeterRows", value: 312 },
          { key: "rejected", label: "Rejected", value: { atLeast: 40 } },
          { key: "escalated", label: "Escalated", value: null },
          { key: "incidents", label: "Open incidents", value: 3, kind: "incident" },
        ]}
      />
    ),
  },
]
