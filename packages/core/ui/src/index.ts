// Pure React, no host, no tool call, no schema library (`ui-is-a-leaf` in .dependency-cruiser.cjs).
// Every name comes from its leaf module; the root never imports `./testing`.

// shadcn base primitives
export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
} from "./primitives/card.js"
export { Badge, badgeVariants } from "./primitives/badge.js"
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "./primitives/table.js"
export { Skeleton } from "./primitives/skeleton.js"
export { Tabs, TabsList, TabsTrigger, TabsContent, TabCount } from "./primitives/tabs.js"
export { Button, buttonVariants } from "./primitives/button.js"
export { Input } from "./primitives/input.js"
export { Textarea } from "./primitives/textarea.js"
export { Label } from "./primitives/label.js"
export { Checkbox } from "./primitives/checkbox.js"
export { Progress, type ProgressProps } from "./primitives/progress.js"
export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "./primitives/dialog.js"
export { Alert, AlertDescription, AlertTitle } from "./primitives/alert.js"
export { Switch } from "./primitives/switch.js"

// The tone model: the vocabulary, the situation table, an engine's verdict and its failed read,
// and the count ladder (the framework-free
// `./tones` entry, the same names), then the kit's class maps (three roles per tone: colour,
// tint, ink); the type scale, the focus ring, cn.
export {
  TONE_VARIANTS,
  TONE_ALIASES,
  resolveTone,
  isToneVariant,
  SITUATION_TONES,
  VERDICT_TONES,
  READ_FAILURE_TONES,
  countTone,
  severityTone,
  type ToneVariant,
  type ToneAlias,
  type ToneName,
  type Situation,
  type Verdict,
  type ReadFailure,
} from "./tones/index.js"
export {
  TONE_SOFT,
  TONE_TINT,
  TONE_DOT,
  TONE_INK,
  TONE_BORDER,
  TONE_ICON,
} from "./lib/tone-utils.js"
export {
  TYPE_SCALE,
  TYPE_STEPS,
  TYPE_FLOOR_PX,
  MICRO_LABEL,
  FIELD_TEXT,
  type TypeStep,
} from "./lib/typography.js"
export { FOCUS_RING, FOCUS_RING_INSET } from "./lib/focus-ring.js"
export { cn } from "./lib/utils.js"

// Composed components
export {
  KpiGrid,
  KpiGridSkeleton,
  type KpiGridProps,
  type KpiGridHeader,
  type KpiCell,
  type KpiGridSkeletonProps,
} from "./components/KpiGrid.js"
export {
  CountPill,
  StatusBadge,
  type CountPillProps,
  type StatusBadgeProps,
  type StatusBadgeText,
} from "./components/Pills.js"
export { SectionHeading, type SectionHeadingProps } from "./components/SectionHeading.js"
export {
  WidgetHeader,
  type WidgetHeaderProps,
  type WidgetHeadingLevel,
} from "./components/WidgetHeader.js"
export { GROUP_CARD_INSET, GroupCard, type GroupCardProps } from "./components/GroupCard.js"
export { FilterBar, type FilterBarProps, type FilterChip } from "./components/FilterBar.js"
export { DrillButton, type DrillButtonProps } from "./components/DrillButton.js"
export { ListFooter, type ListFooterProps } from "./components/ListFooter.js"
export {
  PagedListFooter,
  type PagedListFooterProps,
  type PagedListState,
} from "./components/PagedListFooter.js"
export {
  ToastProvider,
  useToast,
  type ToastApi,
  type ToastOptions,
  type ToastTone,
} from "./components/Toast.js"
export {
  EmptyState,
  type EmptyStateProps,
  type StateHeadingLevel,
} from "./components/EmptyState.js"
export { ErrorState, type ErrorStateProps, type ErrorStateTone } from "./components/ErrorState.js"

// The shared building blocks lifted from the VS Code webview (D9): props and callbacks only, no
// host inside; the cockpit and, after the switch, the webview compose them.
export {
  ViewBar,
  ViewBarSlots,
  type ViewBarAccess,
  type ViewBarHeadingLevel,
  type ViewBarProps,
  type ViewBarSlotsProps,
} from "./components/ViewBar.js"
export {
  StatusStrip,
  type StatusStripAction,
  type StatusStripProps,
  type StatusStripTone,
} from "./components/StatusStrip.js"
export { Facts, type Fact, type FactsProps } from "./components/Facts.js"
export { StateLabel, type StateLabelProps, type StateLabelState } from "./components/StateLabel.js"
export { CountBadge, type CountBadgeProps } from "./components/CountBadge.js"
export { CountFigure, type CountFigureProps } from "./components/CountFigure.js"
export { Toolbar, type ToolbarProps } from "./components/Toolbar.js"
export { CopyableId, type CopyableIdProps } from "./components/CopyableId.js"
export { ConditionChip, type ConditionChipProps } from "./components/ConditionChip.js"
export { LoadingState, type LoadingStateProps } from "./components/LoadingState.js"
export { NavTab, NavTabs, type NavTabProps, type NavTabsProps } from "./components/NavTabs.js"
export {
  SideNav,
  SideNavGroup,
  SideNavItem,
  SideNavList,
  type SideNavGroupProps,
  type SideNavItemProps,
  type SideNavListProps,
  type SideNavProps,
} from "./components/SideNav.js"

// Charts: React and SVG, no chart library; the blue ramp (--chart-1, --chart-2) and red for
// incidents only, a tooltip, a legend for two series and a table for a screen reader each.
export { BarChart, type BarChartProps } from "./components/charts/BarChart.js"
export { LineChart, type LineChartProps } from "./components/charts/LineChart.js"
export {
  Sparkline,
  type SparklinePoint,
  type SparklineProps,
} from "./components/charts/Sparkline.js"
export { MeterRows, type MeterRow, type MeterRowsProps } from "./components/charts/MeterRows.js"
export type { ChartPoint, ChartSeries, ChartUnit } from "./components/charts/chart-types.js"

// Hooks
export { useDebouncedValue } from "./hooks/use-debounced-value.js"
export { useResetOnChange } from "./kit/use-reset-on-change.js"

// Theme and fonts: the defaults are the Miragon theme (theme.css over the vendored --cd-*
// tokens); a brand overrides the ROLE_TOKENS only.
export { ROLE_TOKENS } from "./theme/role-tokens.js"
export { usePortalContainer } from "./theme/portal-container.js"
export { CD_TOKENS, CD_TOKENS_VERSION, type CdTokenName } from "./theme/cd-tokens.js"
export { fontFaces, GEIST_FONT_FILES, type FontFacesOptions } from "./theme/fonts.js"
export { BPMN_LABEL_STYLE } from "./theme/bpmn-labels.js"
export {
  adoptHostFontVariables,
  HOST_FONT_VARIABLES,
  type InlineStyleTarget,
} from "./theme/host-fonts.js"

// Locale
export {
  LocaleProvider,
  useLocale,
  useTranslate,
  useUiMessages,
  type LocaleContextValue,
  type LocaleProviderProps,
  type BoundTranslate,
  type Translate,
} from "./locale/locale-provider.js"
export {
  UI_MESSAGES,
  resolveUiMessages,
  type BpmnMessages,
  type CommonMessages,
  type ConditionChipMessages,
  type CopyableIdMessages,
  type CountNoun,
  type CountMessages,
  type DataTableMessages,
  type FilterBarMessages,
  type ListFooterMessages,
  type SearchFieldMessages,
  type StateLabelMessages,
  type UiLocale,
  type UiMessages,
  type UiMessagesOverride,
  type ViewBarMessages,
} from "./locale/ui-messages.js"
export { createUseT, type T } from "./kit/create-use-t.js"

// The pieces every list and form shares
export { Icon, ICON_STROKE, type LucideIcon } from "./kit/icon.js"
export {
  Th,
  Td,
  TableEmptyState,
  VersionChip,
  type ColumnSort,
  type EmptyVariant,
} from "./kit/table.js"
export { DataTable } from "./kit/data-table.js"
export { DataTableRow } from "./kit/data-table-target.js"
export type {
  DataTableColumn,
  DataTableProps,
  DataTableRowProps,
  DataTableSelection,
  RowActivation,
  SelectionBoxProps,
} from "./kit/data-table-types.js"
export { rowSelection } from "./kit/row-selection.js"
export { useColumnSizing } from "./kit/use-column-sizing.js"
export type {
  ColumnSizing,
  ColumnSizingOptions,
  ColumnSizingParts,
  ColumnWidths,
  SizedHeadProps,
} from "./kit/column-sizing.js"
export { Section, type SectionHeadingLevel } from "./kit/section.js"
export { NativeSelect } from "./kit/native-select.js"
export { Field, type FieldProps } from "./kit/field.js"
export type { FieldControlProps } from "./lib/field-control.js"
export { SearchField, type SearchFieldProps } from "./kit/search-field.js"
export {
  SegmentedControl,
  type SegmentedControlOption,
  type SegmentedControlProps,
  type SegmentedCountTone,
} from "./kit/segmented-control.js"
export { RowCard } from "./kit/row-card.js"
export { NamedId, type NamedIdLayout } from "./kit/named-id.js"
export {
  LogText,
  LOG_TEXT_PREVIEW,
  TEXT_BLOCK_FRAME,
  type LogTextKind,
  type LogTextSize,
} from "./kit/log-text.js"
// The Komet belongs on app-level surfaces only (a landing, a first start), never in a widget.
export { KometMark, AppEmptyState } from "./kit/brand-mark.js"
export { NavigationFocus } from "./kit/navigation-focus.js"
export { MENU_ITEM } from "./kit/menu-item.js"
// The formatters (the framework-free `./format` entry, the same names) render in the locale set
// once with `setFormatLocale` (the browser's until then); a test resets it with
// `setFormatLocale(undefined)`.
export {
  formatClock,
  formatCompactCount,
  formatCount,
  formatDate,
  formatDuration,
  formatInstant,
  formatNumber,
  formatPercent,
  formatPercentPoints,
  formatPeriod,
  formatRelativeTime,
  formatTime,
  formatTimestamp,
  shortId,
  truncate,
  setFormatLocale,
  getFormatLocale,
  subscribeFormatLocale,
  type ClockOptions,
  type Count,
  type PercentFormatOptions,
  type FormatLocale,
  type TimeOptions,
} from "./format/index.js"

// Dashboard blocks (Miragon/pulse#664): a section's read in its states, the panels of a page and
// their grid, when the numbers were read, and the page error vocabulary a page outside a host
// maps its transport's failures to once.
export {
  SectionState,
  SectionStateGroup,
  type SectionStateGroupProps,
  type SectionStateProps,
  type SectionStateValue,
} from "./components/SectionState.js"
export { SKELETON_DELAY_MS } from "./hooks/use-elapsed.js"
export { Panel, PanelGrid, type PanelGridProps, type PanelProps } from "./components/PanelGrid.js"
export { FreshnessStamp, type FreshnessStampProps } from "./components/FreshnessStamp.js"
export {
  PAGE_ERROR_CODES,
  describePageError,
  type DescribePageErrorOptions,
  type PageError,
  type PageErrorCode,
  type SectionFailure,
} from "./locale/page-errors.js"
export type {
  FreshnessMessages,
  PageErrorMessages,
  PageErrorParams,
  SectionStateMessages,
} from "./locale/ui-messages.js"
