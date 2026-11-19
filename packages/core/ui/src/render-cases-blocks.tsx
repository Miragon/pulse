import { RotateCcw } from "lucide-react"
import {
  ConditionChip,
  CopyableId,
  CountBadge,
  Facts,
  LoadingState,
  NavTab,
  NavTabs,
  StateLabel,
  StatusStrip,
  Toolbar,
  ViewBar,
} from "./index.js"
import type { RenderCase } from "./render-cases-primitives.js"

/**
 * SSR render cases for the building blocks lifted from the VS Code webview (D9), aggregated by
 * `render-cases.tsx`: each with its default words, so the render half of the i18n guard sees
 * every word a block brings.
 */

const noop = (): void => {}

export const BLOCK_RENDER_CASES: RenderCase[] = [
  {
    name: "ViewBar",
    marker: "RC:ViewBar",
    render: () => (
      <ViewBar
        title="RC:ViewBar"
        onBack={noop}
        facts="order · v3"
        access={{ writable: false }}
        freshness="14:32"
      />
    ),
  },
  {
    name: "StatusStrip",
    marker: "RC:StatusStrip",
    render: () => (
      <StatusStrip
        tone="danger"
        title="RC:StatusStrip"
        detail="The engine refused the retry."
        actions={[{ label: "Retry now", icon: RotateCcw, onClick: noop }]}
      />
    ),
  },
  {
    name: "Facts",
    marker: "RC:Facts",
    render: () => <Facts facts={[{ label: "Root cause", value: "RC:Facts", mono: true }]} />,
  },
  {
    name: "StateLabel",
    marker: "RC:StateLabel",
    render: () => (
      <>
        <StateLabel state="running" />
        <StateLabel state="incident">RC:StateLabel</StateLabel>
      </>
    ),
  },
  {
    name: "CountBadge",
    marker: "RC:CountBadge",
    render: () => (
      <CountBadge count={3} situation="openIncident" label="RC:CountBadge" onClick={noop} />
    ),
  },
  {
    name: "Toolbar",
    marker: "RC:Toolbar",
    render: () => (
      <Toolbar ariaLabel="Filter the orders" summary="RC:Toolbar">
        <span>Running orders</span>
      </Toolbar>
    ),
  },
  {
    name: "CopyableId",
    marker: "RC:CopyableId",
    render: () => <CopyableId id="RC:CopyableId" label="order ID" display="full" onCopy={noop} />,
  },
  {
    name: "ConditionChip",
    marker: "RC:ConditionChip",
    render: () => <ConditionChip label="RC:ConditionChip" onEdit={noop} onRemove={noop} />,
  },
  {
    name: "LoadingState",
    render: () => <LoadingState />,
  },
  {
    name: "NavTabs",
    marker: "RC:NavTabs",
    render: () => (
      <NavTabs ariaLabel="Sections">
        <NavTab current>RC:NavTabs</NavTab>
        <NavTab count={{ atLeast: 2000 }}>Jobs</NavTab>
        <NavTab asChild count={null}>
          <a href="#/history">History</a>
        </NavTab>
      </NavTabs>
    ),
  },
]
