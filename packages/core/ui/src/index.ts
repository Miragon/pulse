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
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./primitives/tabs.js"
export { Button, buttonVariants } from "./primitives/button.js"
export { Input } from "./primitives/input.js"
export {
  Dialog,
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

// The tone model: the vocabulary, the situation table and the count ladder (the framework-free
// `./tones` entry, the same names), then the kit's class maps (three roles per tone: colour,
// tint, ink); the type scale, the focus ring, cn.
export {
  TONE_VARIANTS,
  TONE_ALIASES,
  resolveTone,
  isToneVariant,
  SITUATION_TONES,
  countTone,
  severityTone,
  type ToneVariant,
  type ToneAlias,
  type ToneName,
  type Situation,
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
  LivePill,
  CountPill,
  StatusBadge,
  type LivePillProps,
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
export { GroupCard, type GroupCardProps } from "./components/GroupCard.js"
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

// Hooks
export { useDebouncedValue } from "./hooks/use-debounced-value.js"
export { useResetOnChange } from "./kit/use-reset-on-change.js"

// Theme and fonts: the defaults are the Miragon theme (theme.css over the vendored --cd-*
// tokens); a brand overrides the ROLE_TOKENS only.
export { ROLE_TOKENS } from "./theme/role-tokens.js"
export { usePortalContainer } from "./theme/portal-container.js"
export { CD_TOKENS, CD_TOKENS_VERSION, type CdTokenName } from "./theme/cd-tokens.js"
export { fontFaces, GEIST_FONT_FILES, type FontFacesOptions } from "./theme/fonts.js"
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
  type CommonMessages,
  type FilterBarMessages,
  type ListFooterMessages,
  type UiLocale,
  type UiMessages,
  type UiMessagesOverride,
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
export { Section } from "./kit/section.js"
export { NativeSelect } from "./kit/native-select.js"
export { SegmentedControl, type SegmentedControlOption } from "./kit/segmented-control.js"
export { RowCard } from "./kit/row-card.js"
export { NamedId } from "./kit/named-id.js"
export { LogText, LOG_TEXT_PREVIEW, TEXT_BLOCK_FRAME } from "./kit/log-text.js"
// The Komet belongs on app-level surfaces only (a landing, a first start), never in a widget.
export { KometMark, AppEmptyState } from "./kit/brand-mark.js"
export { NavigationFocus } from "./kit/navigation-focus.js"
export { MENU_ITEM } from "./kit/menu-item.js"
// The formatters render in the locale set once with `setFormatLocale` (the browser's until then);
// a test resets it with `setFormatLocale(undefined)`.
export {
  formatDate,
  formatDuration,
  formatNumber,
  formatPercent,
  formatPercentPoints,
  formatPeriod,
  formatTime,
  formatTimestamp,
  truncate,
  setFormatLocale,
  getFormatLocale,
  subscribeFormatLocale,
  type PercentFormatOptions,
  type FormatLocale,
} from "./kit/format.js"
