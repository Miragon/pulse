import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type FocusEvent,
  type ReactNode,
} from "react"
import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from "lucide-react"
import { useUiMessages } from "../locale/locale-provider.js"
import { FOCUS_RING } from "../lib/focus-ring.js"
import { TONE_ICON } from "../lib/tone-utils.js"
import { cn } from "../lib/utils.js"
import {
  createToast,
  createToastTimer,
  toastReducer,
  type ToastItem,
  type ToastOptions,
  type ToastTimer,
  type ToastTone,
} from "../lib/toast-model.js"

export type { ToastOptions, ToastTone } from "../lib/toast-model.js"

/** What {@link useToast} returns. */
export interface ToastApi {
  /** Show a toast; returns its id (for an early {@link ToastApi.dismiss}). */
  show: (options: ToastOptions) => number
  /** Remove a toast before its timer runs out. */
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastApi | null>(null)

/** Outside a provider `useToast()` degrades to a no-op instead of throwing. */
const NOOP_TOASTS: ToastApi = { show: () => -1, dismiss: () => {} }

/**
 * Raise toasts from anywhere below a {@link ToastProvider}: `show({ tone,
 * title })` after a write succeeded or failed, never a silent `console` line.
 * Outside a provider it returns a no-op API, so a widget rendered in a bare
 * fixture never crashes on feedback.
 */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP_TOASTS
}

/**
 * Status edge per tone — the status colour as border, never as text. Repeated
 * under `dark:` so the card's dark 3:1 rim (`dark:border-input`, a later rule)
 * does not paint over it.
 */
const TONE_EDGE: Record<ToastTone, string> = {
  success: "border-l-success dark:border-l-success",
  warning: "border-l-warning dark:border-l-warning",
  danger: "border-l-danger dark:border-l-danger",
  info: "border-l-info dark:border-l-info",
}

/**
 * Lucide icon per tone, drawn in the tone colour (`TONE_ICON`, CI §3.3: status
 * as edge and icon). The title next to it carries the message, so success and
 * warning stay CI-exempt from 3:1 on light like every other status icon.
 */
const TOAST_ICON: Record<ToastTone, LucideIcon> = {
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
  info: Info,
}

/**
 * The stack of toasts — a presentational view over a list (the provider owns
 * the state). The container is ONE persistent live region
 * (`aria-live="polite"`, mounted before the first toast so that toast is
 * announced, each new toast on its own: `aria-atomic="false"`), without
 * stealing focus. Its attributes never change: a role or name that switched
 * on with the first toast would make the browser rebuild the region in the
 * same commit that inserts the toast, and a region created with its content
 * already in it is not announced. So it carries no role (a generic element
 * takes no name either): an idle stack is no second "status" next to a view's
 * own loading status. Bottom centre, above dialogs (z 60), per CI §5/§8.
 */
export function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: readonly ToastItem[]
  onDismiss: (id: number) => void
}) {
  const messages = useUiMessages()
  return (
    <div
      data-slot="toast-viewport"
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-60 flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((toast) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          dismissLabel={messages.common.dismiss}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  )
}

function ToastCard({
  toast,
  dismissLabel,
  onDismiss,
}: {
  toast: ToastItem
  dismissLabel: string
  onDismiss: (id: number) => void
}) {
  // Hover or keyboard focus holds the toast; on leave it resumes with the
  // time that was LEFT (createToastTimer), never a fresh full duration.
  const timer = useRef<ToastTimer | null>(null)
  useEffect(() => {
    const countdown = createToastTimer(toast.duration, () => onDismiss(toast.id))
    timer.current = countdown
    return () => {
      countdown.cancel()
      timer.current = null
    }
  }, [onDismiss, toast.id, toast.duration])
  const releaseFocus = (event: FocusEvent<HTMLDivElement>) => {
    // Focus moving inside the toast (card → close button) keeps the hold.
    if (!event.currentTarget.contains(event.relatedTarget)) {
      timer.current?.release("focus")
    }
  }
  const Icon = TOAST_ICON[toast.tone]
  return (
    <div
      data-slot="toast"
      data-tone={toast.tone}
      onMouseEnter={() => timer.current?.hold("pointer")}
      onMouseLeave={() => timer.current?.release("pointer")}
      onFocus={() => timer.current?.hold("focus")}
      onBlur={releaseFocus}
      className={cn(
        // An overlay like Dialog/Sheet: shadow-2 on light, the 3:1 input rim on
        // dark (shadows vanish on the ground). Its words are running text (16 px).
        "bg-popover text-popover-foreground dark:border-input shadow-2 text-body pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border border-l-4 px-4 py-3",
        "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-(--motion-base) motion-safe:ease-(--ease)",
        TONE_EDGE[toast.tone],
      )}
    >
      {/* mt-1 centres the 16 px icon on the first 16/1.6 line. */}
      <Icon aria-hidden="true" className={cn("mt-1 size-4 shrink-0", TONE_ICON[toast.tone])} />
      <div className="min-w-0 flex-1">
        <p className="font-medium break-words">{toast.title}</p>
        {toast.description && (
          <p className="text-muted-foreground mt-0.5 break-words">{toast.description}</p>
        )}
      </div>
      <button
        type="button"
        aria-label={dismissLabel}
        onClick={() => onDismiss(toast.id)}
        className={`text-muted-foreground hover:text-foreground -mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-sm ${FOCUS_RING}`}
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  )
}

function ToastRoot({ children }: { children: ReactNode }) {
  const [toasts, dispatch] = useReducer(toastReducer, [])
  const nextId = useRef(0)
  const dismiss = useCallback((id: number) => dispatch({ type: "dismiss", id }), [])
  const show = useCallback((options: ToastOptions) => {
    nextId.current += 1
    const id = nextId.current
    dispatch({ type: "add", toast: createToast(id, options) })
    return id
  }, [])
  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss])
  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

/**
 * Provide toasts to a subtree and render their stack. Idempotent: nested
 * inside another `ToastProvider` it adds nothing, so an app shell and an
 * embedded view share one stack and one live region (a Pulse view, for
 * example, gets one from widget-shell's view root).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const parent = useContext(ToastContext)
  return parent ? children : <ToastRoot>{children}</ToastRoot>
}
