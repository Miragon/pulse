// Pulse's building blocks: React on @miragon/pulse-ui, props and callbacks only, no host and no
// React context of their own. The surface brings its table, its id and its diagram as slots.
export {
  BoardGrid,
  BoardTile,
  type BoardGridProps,
  type BoardTileProps,
} from "./board/board-grid.js"
export { useNoteLines, useProblemWords } from "./board/problem-words.js"
export { ProblemList, type ProblemLine, type ProblemListProps } from "./board/refused-tile.js"
export type {
  BoardCopy,
  BoardDiagramProps,
  BoardIdProps,
  BoardInstanceTarget,
  BoardInstancesTarget,
  BoardListFilter,
  BoardOpenHow,
  BoardScope,
  BoardSlots,
  BoardTableColumn,
  BoardTableProps,
  BoardTableSlot,
  BoardTarget,
} from "./board/slots.js"
// The engines side by side over the engine screens summed (`FleetSums` of @miragon/pulse-screens):
// a row per engine and what runs where; an engine's live state, which the server decides, in its
// screen's bar and in the table's column State.
export {
  EngineTable,
  type EngineRowData,
  type EngineTableProps,
} from "./screens/engines/engine-table.js"
export {
  EngineVerdictBadge,
  type EngineVerdict,
  type EngineVerdictFigures,
} from "./screens/engines/engine-verdict.js"
export { useFleetSums } from "./screens/engines/fleet-sums.js"
// An engine's open root incidents outside any process, a line of their own beside its processes',
// which the chat's overview shows as the web app's screens do (no screen block: verdict/).
export {
  OutsideAnyProcessNotice,
  type OutsideAnyProcessData,
  type OutsideAnyProcessNoticeProps,
} from "./verdict/outside-any-process.js"
export {
  ProcessesByEngine,
  type ProcessesByEngineProps,
} from "./screens/engines/processes-by-engine.js"
// What the search finds across engines, over the find screen's JSON form, and the notice of an
// engine whose history misses running instances.
export {
  FindHistoryNotice,
  type FindHistoryNoticeProps,
} from "./screens/find/find-history-notice.js"
export { FindResults, type FindResultsProps, type FoundRow } from "./screens/find/find-results.js"
// The screens' blocks over the JSON forms of @miragon/pulse-screens: an engine's process list.
export { ListFilterBar, type ListFilterBarProps } from "./screens/list-filter-bar.js"
export { useProcessList } from "./screens/process-list.js"
export { ProcessTable, type ProcessTableProps } from "./screens/process-table.js"
// An instance's blocks over the instance screen's JSON form: its facts, its head strip, its
// incident cards and their text, its tables of waits, path and variables, the menu of the
// instances it called and the legend of its markers. JsonText lays out a variable's value.
// A process's blocks over the process screen's and the instance list's JSON forms: its version
// picker, the notice that older versions still run, the filter bar of its instance list with its
// scopes, chips and variable condition dialog, the instance table and its next page, the notice of a
// history that misses running instances, the counts and call buttons on its diagram and their
// legend. InstanceFilters and VariableDraft are their rules.
export { BadgeCluster, type BadgeClusterProps } from "./screens/process/badge-cluster.js"
export { BadgeLegend, type BadgeLegendProps } from "./screens/process/badge-legend.js"
export { CallButton, useCallLabel, type CallButtonProps } from "./screens/process/call-button.js"
export {
  InstanceFilterBar,
  type InstanceFilterBarProps,
} from "./screens/process/instance-filter-bar.js"
export { InstanceFilters } from "./screens/process/instance-filters.js"
export {
  InstanceTable,
  type InstanceMoreSlot,
  type InstanceSelectSlot,
  type InstanceTableProps,
} from "./screens/process/instance-table.js"
export { LoadMore, type LoadMoreProps } from "./screens/process/load-more.js"
export { useDiagramDecorations, useInstanceRows } from "./screens/process/process-hooks.js"
export {
  MissingHistoryNotice,
  type MissingHistoryNoticeProps,
} from "./screens/process/missing-history-notice.js"
export {
  OlderVersionsNotice,
  type OlderVersionsNoticeData,
  type OlderVersionsNoticeProps,
} from "./screens/process/older-versions-notice.js"
export {
  ScopeSegments,
  type ScopeOption,
  type ScopeSegmentsProps,
} from "./screens/scope-segments.js"
export type { VariableFilterProps } from "./screens/process/variable-chips.js"
export {
  VariableDraft,
  type CompareAs,
  type VariableDraftData,
  type VariableDraftErrors,
} from "./screens/process/variable-draft.js"
export {
  VersionPicker,
  type VersionOptionData,
  type VersionPickerProps,
} from "./screens/process/version-picker.js"
export {
  CalledInstanceMenu,
  type CalledInstanceMenuProps,
} from "./screens/instance/called-instance-menu.js"
export { HeadlineStrip, type HeadlineStripProps } from "./screens/instance/headline-strip.js"
export { HistoryTable, type HistoryTableProps } from "./screens/instance/history-table.js"
export {
  IncidentCard,
  type IncidentCardFields,
  type IncidentCardProps,
} from "./screens/instance/incident-card.js"
export {
  IncidentText,
  type IncidentTextProps,
  type IncidentTextRead,
} from "./screens/instance/incident-text.js"
export {
  InstanceFacts,
  type InstanceFactsData,
  type InstanceFactsProps,
} from "./screens/instance/instance-facts.js"
export { JsonText } from "./screens/instance/json-text.js"
export {
  MarkerLegend,
  type MarkerLegendProps,
  type MarkerSwatchProps,
} from "./screens/instance/marker-legend.js"
export {
  VariablesTable,
  type VariableEditorSlot,
  type VariablesTableProps,
} from "./screens/instance/variables-table.js"
export {
  WaitingTable,
  type ElementLinkProps,
  type WaitingTableProps,
} from "./screens/instance/waiting-table.js"
export type {
  CountBadgeProps,
  InstanceSlots,
  ScreenColumnWidth,
  ScreenCopy,
  ScreenEmptyAction,
  ScreenIdProps,
  ScreenLinkProps,
  ScreenLinkRel,
  ScreenOpenHow,
  ScreenPlainTableProps,
  ScreenPlainTableSlot,
  ScreenSlots,
  ScreenTableColumn,
  ScreenTableProps,
  ScreenTableSlot,
} from "./screens/slots.js"
