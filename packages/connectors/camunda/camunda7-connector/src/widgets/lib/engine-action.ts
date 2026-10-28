import { useState } from "react"
import { queryClient, useToolMutation } from "@miragon/mcp-toolkit-ui"
import {
  useActionFeedback,
  useResetOnChange,
  type ConfirmTarget,
} from "@miragon/pulse-widget-shell/widgets"

import type { CAMUNDA7_SAVE_SETTINGS, Camunda7WidgetAction } from "../../tool-names.js"
import { useCanRun } from "../widget-actions.js"
import { WRITE_POLICY, type WidgetWrite } from "./write-policy.js"

export type TargetLine = ConfirmTarget

/** Names the target and uses unconfusable buttons ("Keep instance", never a bare "Cancel"). */
export interface ActionConfirmation {
  title: string
  description: string
  /** A confirmation that names nothing is not one. */
  target: readonly [TargetLine, ...TargetLine[]]
  confirmLabel: string
  keepLabel: string
  destructive?: boolean
}

/** U9: toasts that name the object, never a silent row change. */
export interface WriteFeedback<TResult> {
  success: string | ((result: TResult) => string)
  /** Not raised for a confirmed write: its dialog shows the failure. */
  failure: string
}

export interface RunOptions<TResult> {
  confirm?: ActionConfirmation
  feedback: WriteFeedback<TResult>
  onSuccess?: (result: TResult) => void
  onError?: (error: Error) => void
}

/** Engine writes ask the toolset (`camunda7_widget_actions_data`); the profile save its view's `canSave`. */
type ActionGate =
  | { tool: Camunda7WidgetAction; allowed?: never }
  | { tool: typeof CAMUNDA7_SAVE_SETTINGS; allowed: boolean }

export type EngineActionOptions<TArgs> = ActionGate & {
  target?: (args: TArgs) => string
  /** The optimistic success marks drop when its identity changes. */
  resetOn?: unknown
  /** False for an ended, cancelled, unconfirmed or (for task completion) suspended subject. */
  available?: boolean
}

export interface EngineAction<TArgs, TResult> {
  /** Render the control only when true: hidden, never disabled. */
  readonly allowed: boolean
  run: (args: TArgs, options: RunOptions<TResult>) => void
  pending: (target?: string) => boolean
  /** Optimistic state until fresh server data (`resetOn`) replaces it. */
  readonly done: ReadonlyMap<string, { args: TArgs; result: TResult }>
  error: (target?: string) => string | null
  readonly confirmation: { target: string; spec: ActionConfirmation } | null
  confirm: () => void
  dismiss: () => void
}

interface Asked<TArgs, TResult> {
  args: TArgs
  options: RunOptions<TResult>
  /** Built once per question: a stable identity for the dialog. */
  confirmation: { target: string; spec: ActionConfirmation }
}

interface ActionState<TArgs, TResult> {
  pending: ReadonlySet<string>
  done: ReadonlyMap<string, { args: TArgs; result: TResult }>
  errors: ReadonlyMap<string, string>
  asked: Asked<TArgs, TResult> | null
}

const SINGLE = ""
const SINGLE_TARGET = () => SINGLE

function withEntry<K, V>(map: ReadonlyMap<K, V>, key: K, value: V): Map<K, V> {
  return new Map(map).set(key, value)
}

function without<K, V>(map: ReadonlyMap<K, V>, key: K): Map<K, V> {
  const next = new Map(map)
  next.delete(key)
  return next
}

function withoutMember<K>(set: ReadonlySet<K>, key: K): Set<K> {
  const next = new Set(set)
  next.delete(key)
  return next
}

/** By key namespace across every engine: a cheap over-approximation. */
function invalidateAfter(tool: WidgetWrite): void {
  for (const namespace of WRITE_POLICY[tool].invalidates) {
    void queryClient.invalidateQueries({ queryKey: [namespace] })
  }
}

/** The one in-widget write primitive (`src/widget-actions.test.ts`); fail-closed until the gate feed answered. */
export function useEngineAction<TArgs extends Record<string, unknown>, TResult = unknown>({
  tool,
  allowed: viewAllows,
  target = SINGLE_TARGET,
  resetOn,
  available = true,
}: EngineActionOptions<TArgs>): EngineAction<TArgs, TResult> {
  const canRun = useCanRun()
  const allowed = (viewAllows ?? canRun(tool)) && available
  const mutation = useToolMutation<TResult>(tool)
  const toasts = useActionFeedback()
  const [state, setState] = useState<ActionState<TArgs, TResult>>({
    pending: new Set(),
    done: new Map(),
    errors: new Map(),
    asked: null,
  })
  useResetOnChange(resetOn, () => setState((s) => ({ ...s, done: new Map() })))
  // The instance ended while the dialog was open; a write in flight still shows its outcome.
  useResetOnChange(allowed, () =>
    setState((s) =>
      !allowed && s.asked && !s.pending.has(target(s.asked.args)) ? { ...s, asked: null } : s,
    ),
  )

  function execute(args: TArgs, runOptions: RunOptions<TResult>) {
    const key = target(args)
    const { feedback } = runOptions
    setState((s) => ({
      ...s,
      pending: new Set(s.pending).add(key),
      errors: without(s.errors, key),
    }))
    mutation.mutateAsync(args).then(
      (result) => {
        setState((s) => ({
          ...s,
          pending: withoutMember(s.pending, key),
          done: withEntry(s.done, key, { args, result }),
          asked: s.asked && target(s.asked.args) === key ? null : s.asked,
        }))
        toasts.succeeded(
          typeof feedback.success === "function" ? feedback.success(result) : feedback.success,
        )
        runOptions.onSuccess?.(result)
        invalidateAfter(tool)
      },
      (err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err))
        setState((s) => ({
          ...s,
          pending: withoutMember(s.pending, key),
          errors: withEntry(s.errors, key, error.message),
        }))
        if (!runOptions.confirm) toasts.failed(feedback.failure, error)
        runOptions.onError?.(error)
      },
    )
  }

  function run(args: TArgs, runOptions: RunOptions<TResult>) {
    const key = target(args)
    if (!allowed || state.pending.has(key)) return
    if (WRITE_POLICY[tool].confirm) {
      const spec = runOptions.confirm
      if (!spec) {
        throw new Error(`${tool} asks first — run it with a confirmation that names its target`)
      }
      const asked = { args, options: runOptions, confirmation: { target: key, spec } }
      setState((s) => ({ ...s, asked, errors: without(s.errors, key) }))
      return
    }
    execute(args, runOptions)
  }

  const asked = state.asked
  // Dismissing would hide the outcome; confirming twice would write twice.
  const askedIdle = asked !== null && !state.pending.has(target(asked.args))
  return {
    allowed,
    run,
    pending: (key) => (key === undefined ? state.pending.size > 0 : state.pending.has(key)),
    done: state.done,
    error: (key = SINGLE) => state.errors.get(key) ?? null,
    confirmation: asked?.confirmation ?? null,
    confirm: () => {
      if (asked && askedIdle && allowed) execute(asked.args, asked.options)
    },
    dismiss: () => {
      if (askedIdle) setState((s) => ({ ...s, asked: null }))
    },
  }
}
