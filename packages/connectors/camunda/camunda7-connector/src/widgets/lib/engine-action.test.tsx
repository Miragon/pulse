// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { AppQueryProvider, queryClient, ToastProvider } from "@miragon/mcp-toolkit-ui"
import { CAMUNDA7_SAVE_SETTINGS, CAMUNDA7_WIDGET_ACTIONS_DATA } from "../../tool-names.js"
import { useEngineAction, type ActionConfirmation } from "./engine-action.js"
import { WRITE_POLICY } from "./write-policy.js"

let allowed: string[]
const write = vi.fn<(name: string, args: object) => unknown>()

function callTool(name: string, args: object) {
  if (name === CAMUNDA7_WIDGET_ACTIONS_DATA) {
    return Promise.resolve({ structuredContent: { allowedActions: allowed, modelTools: [] } })
  }
  return Promise.resolve(write(name, args)).then((result) => ({ structuredContent: result }))
}

function wrapper({ children }: { children: ReactNode }) {
  return <AppQueryProvider callTool={callTool}>{children}</AppQueryProvider>
}

interface RetryArgs extends Record<string, unknown> {
  jobId: string
  retries: number
}

function retryAction(resetOn?: unknown) {
  return renderHook(
    ({ reset }: { reset: unknown }) =>
      useEngineAction<RetryArgs>({
        tool: "camunda7_set_job_retries",
        target: (args) => args.jobId,
        resetOn: reset,
      }),
    { wrapper, initialProps: { reset: resetOn } },
  )
}

const FEEDBACK = { success: "Job retried", failure: "Couldn't retry the job" }

const CONFIRM: ActionConfirmation = {
  title: "Resolve this incident?",
  description: "Marks it resolved.",
  target: [["Incident", "inc-1"]],
  confirmLabel: "Resolve incident",
  keepLabel: "Keep open",
}

beforeEach(() => {
  allowed = ["camunda7_set_job_retries", "camunda7_resolve_incident"]
  write.mockReset()
  write.mockReturnValue({ success: true })
})

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
})

describe("useEngineAction — the gate", () => {
  it("is not allowed (and runs nothing) until the deployment's feed allows it", async () => {
    allowed = []
    const { result } = retryAction()
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(result.current.allowed).toBe(false)
    act(() => result.current.run({ jobId: "job-1", retries: 1 }, { feedback: FEEDBACK }))
    expect(write).not.toHaveBeenCalled()
  })

  it("takes a self-gated write's decision from the view", () => {
    const { result } = renderHook(
      () => useEngineAction({ tool: CAMUNDA7_SAVE_SETTINGS, allowed: true }),
      { wrapper },
    )
    expect(result.current.allowed).toBe(true)
  })

  it("is closed while the subject's state does not allow the write — the gate notwithstanding", async () => {
    const { result, rerender } = renderHook(
      ({ available }: { available: boolean }) =>
        useEngineAction<RetryArgs>({
          tool: "camunda7_set_job_retries",
          target: (args) => args.jobId,
          available,
        }),
      { wrapper, initialProps: { available: false } },
    )
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(result.current.allowed).toBe(false)
    act(() => result.current.run({ jobId: "job-1", retries: 1 }, { feedback: FEEDBACK }))
    expect(write).not.toHaveBeenCalled()

    rerender({ available: true })
    expect(result.current.allowed).toBe(true)
  })
})

describe("useEngineAction — the write", () => {
  it("runs per target: pending, then done with the result, then the targeted refresh", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
    write.mockReturnValue({ success: true, retries: 1 })
    const { result } = retryAction()
    await waitFor(() => expect(result.current.allowed).toBe(true))

    act(() => result.current.run({ jobId: "job-1", retries: 1 }, { feedback: FEEDBACK }))
    expect(result.current.pending("job-1")).toBe(true)
    expect(result.current.pending("job-2")).toBe(false)
    expect(result.current.pending()).toBe(true)
    await waitFor(() => expect(result.current.done.has("job-1")).toBe(true))

    expect(write).toHaveBeenCalledWith("camunda7_set_job_retries", { jobId: "job-1", retries: 1 })
    expect(result.current.done.get("job-1")).toEqual({
      args: { jobId: "job-1", retries: 1 },
      result: { success: true, retries: 1 },
    })
    expect(result.current.pending()).toBe(false)
    const refreshed = invalidate.mock.calls.map(([filters]) => filters?.queryKey?.[0])
    expect(refreshed).toEqual(WRITE_POLICY.camunda7_set_job_retries.invalidates)
  })

  it("keeps a failure at its target until that target runs again — and refreshes nothing", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
    write.mockImplementationOnce(() => {
      throw new Error("job gone")
    })
    const onError = vi.fn()
    const { result } = retryAction()
    await waitFor(() => expect(result.current.allowed).toBe(true))

    act(() => result.current.run({ jobId: "job-1", retries: 1 }, { onError, feedback: FEEDBACK }))
    await waitFor(() => expect(result.current.error("job-1")).toBe("job gone"))
    expect(result.current.error("job-2")).toBeNull()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "job gone" }))
    expect(invalidate).not.toHaveBeenCalled()

    act(() => result.current.run({ jobId: "job-1", retries: 1 }, { feedback: FEEDBACK }))
    expect(result.current.error("job-1")).toBeNull()
    await waitFor(() => expect(result.current.done.has("job-1")).toBe(true))
  })

  it("ignores a second run of a target that is still in flight", async () => {
    let finish!: (value: unknown) => void
    write.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    const { result } = retryAction()
    await waitFor(() => expect(result.current.allowed).toBe(true))
    act(() => result.current.run({ jobId: "job-1", retries: 1 }, { feedback: FEEDBACK }))
    act(() => result.current.run({ jobId: "job-1", retries: 1 }, { feedback: FEEDBACK }))
    act(() => finish({ success: true }))
    await waitFor(() => expect(result.current.pending()).toBe(false))
    expect(write).toHaveBeenCalledTimes(1)
  })

  it("drops the success marks when fresh server data arrives", async () => {
    const { result, rerender } = retryAction({ rows: 1 })
    await waitFor(() => expect(result.current.allowed).toBe(true))
    act(() =>
      result.current.run(
        { jobId: "job-1", retries: 1 },
        { onSuccess: () => {}, feedback: FEEDBACK },
      ),
    )
    await waitFor(() => expect(result.current.done.size).toBe(1))
    rerender({ reset: { rows: 0 } })
    expect(result.current.done.size).toBe(0)
  })
})

describe("useEngineAction — a write that asks first", () => {
  function resolveAction() {
    return renderHook(
      ({ available }: { available: boolean }) =>
        useEngineAction<{ incidentId: string }>({
          tool: "camunda7_resolve_incident",
          target: (args) => args.incidentId,
          available,
        }),
      { wrapper, initialProps: { available: true } },
    )
  }

  it("withdraws an unanswered question when the state stops allowing the write", async () => {
    const { result, rerender } = resolveAction()
    await waitFor(() => expect(result.current.allowed).toBe(true))
    act(() => result.current.run({ incidentId: "inc-1" }, { confirm: CONFIRM, feedback: FEEDBACK }))
    expect(result.current.confirmation).not.toBeNull()

    // The instance ended while the dialog was open.
    rerender({ available: false })
    expect(result.current.confirmation).toBeNull()
    act(() => result.current.confirm())
    // The state coming back does not resurrect the old question.
    rerender({ available: true })
    expect(result.current.confirmation).toBeNull()
    expect(write).not.toHaveBeenCalled()
  })

  it("keeps a question whose write is in flight — the dialog must show its outcome", async () => {
    let finish!: (value: unknown) => void
    write.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    const { result, rerender } = resolveAction()
    await waitFor(() => expect(result.current.allowed).toBe(true))
    act(() => result.current.run({ incidentId: "inc-1" }, { confirm: CONFIRM, feedback: FEEDBACK }))
    act(() => result.current.confirm())

    rerender({ available: false })
    expect(result.current.confirmation).not.toBeNull()
    expect(result.current.pending("inc-1")).toBe(true)
    act(() => finish({ success: true }))
    await waitFor(() => expect(result.current.confirmation).toBeNull())
    expect(write).toHaveBeenCalledTimes(1)
  })

  it("refuses to run without a confirmation that names its target", async () => {
    const { result } = resolveAction()
    await waitFor(() => expect(result.current.allowed).toBe(true))
    expect(() => result.current.run({ incidentId: "inc-1" }, { feedback: FEEDBACK })).toThrow(
      /asks first/,
    )
    expect(write).not.toHaveBeenCalled()
  })

  it("asks, runs on confirm, and closes the question once the write succeeded", async () => {
    const onSuccess = vi.fn()
    const { result } = resolveAction()
    await waitFor(() => expect(result.current.allowed).toBe(true))

    act(() =>
      result.current.run(
        { incidentId: "inc-1" },
        { confirm: CONFIRM, onSuccess, feedback: FEEDBACK },
      ),
    )
    expect(result.current.confirmation).toEqual({ target: "inc-1", spec: CONFIRM })
    expect(write).not.toHaveBeenCalled()

    act(() => result.current.confirm())
    expect(result.current.pending("inc-1")).toBe(true)
    await waitFor(() => expect(result.current.confirmation).toBeNull())
    expect(write).toHaveBeenCalledWith("camunda7_resolve_incident", { incidentId: "inc-1" })
    expect(onSuccess).toHaveBeenCalledWith({ success: true })
  })

  it("keeps the question open with its failure; dismissing keeps the failure for the row", async () => {
    write.mockImplementation(() => {
      throw new Error("not resolvable")
    })
    const { result } = resolveAction()
    await waitFor(() => expect(result.current.allowed).toBe(true))
    act(() => result.current.run({ incidentId: "inc-1" }, { confirm: CONFIRM, feedback: FEEDBACK }))
    act(() => result.current.confirm())
    await waitFor(() => expect(result.current.error("inc-1")).toBe("not resolvable"))
    expect(result.current.confirmation).not.toBeNull()

    act(() => result.current.dismiss())
    expect(result.current.confirmation).toBeNull()
    expect(result.current.error("inc-1")).toBe("not resolvable")

    // Asking again starts a fresh question — the old failure does not greet it.
    act(() => result.current.run({ incidentId: "inc-1" }, { confirm: CONFIRM, feedback: FEEDBACK }))
    expect(result.current.error("inc-1")).toBeNull()
  })

  it("cannot be dismissed or confirmed again while the write is in flight", async () => {
    let finish!: (value: unknown) => void
    write.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    const { result } = resolveAction()
    await waitFor(() => expect(result.current.allowed).toBe(true))
    act(() => result.current.run({ incidentId: "inc-1" }, { confirm: CONFIRM, feedback: FEEDBACK }))
    act(() => result.current.confirm())
    act(() => result.current.dismiss())
    act(() => result.current.confirm())
    expect(result.current.confirmation).not.toBeNull()
    act(() => finish({ success: true }))
    await waitFor(() => expect(result.current.confirmation).toBeNull())
    expect(write).toHaveBeenCalledTimes(1)
  })
})

describe("useEngineAction — the feedback (U9: a write is never silent)", () => {
  function toastWrapper({ children }: { children: ReactNode }) {
    return (
      <AppQueryProvider callTool={callTool}>
        <ToastProvider>{children}</ToastProvider>
      </AppQueryProvider>
    )
  }

  const toast = (title: string) =>
    document.querySelector(`[data-slot="toast"]`)?.textContent?.includes(title)
      ? document.querySelector(`[data-slot="toast"]`)
      : null

  function action<TResult = unknown>(
    tool: "camunda7_set_job_retries" | "camunda7_resolve_incident" = "camunda7_set_job_retries",
  ) {
    return renderHook(
      () =>
        useEngineAction<Record<string, unknown>, TResult>({
          tool,
          target: (args) => String(args.jobId ?? args.incidentId),
        }),
      { wrapper: toastWrapper },
    )
  }

  it("confirms a success with a toast naming the object", async () => {
    const { result } = action()
    await waitFor(() => expect(result.current.allowed).toBe(true))
    act(() => result.current.run({ jobId: "job-1", retries: 1 }, { feedback: FEEDBACK }))
    await waitFor(() => expect(toast("Job retried")?.getAttribute("data-tone")).toBe("success"))
  })

  it("lets the result word the success", async () => {
    write.mockReturnValue({ outcome: "resolved" })
    const { result } = action<{ outcome: string }>()
    await waitFor(() => expect(result.current.allowed).toBe(true))
    act(() =>
      result.current.run(
        { jobId: "job-1" },
        { feedback: { success: (r) => `Outcome ${r.outcome}`, failure: "x" } },
      ),
    )
    await waitFor(() => expect(toast("Outcome resolved")).not.toBeNull())
  })

  it("reports a failure as a danger toast: the object, then the reason in words", async () => {
    write.mockImplementation(() => {
      throw new Error("[503 ProcessEngineException] down (engine prod)")
    })
    const { result } = action()
    await waitFor(() => expect(result.current.allowed).toBe(true))
    act(() => result.current.run({ jobId: "job-1", retries: 1 }, { feedback: FEEDBACK }))
    await waitFor(() => expect(toast("Couldn't retry the job")).not.toBeNull())
    const shown = toast("Couldn't retry the job")!
    expect(shown.getAttribute("data-tone")).toBe("danger")
    expect(shown.textContent).toContain("Engine prod is unreachable (HTTP 503).")
    expect(shown.textContent).not.toContain("ProcessEngineException")
  })

  it("leaves a confirmed write's failure to its dialog — no second, toast-shaped copy", async () => {
    write.mockImplementation(() => {
      throw new Error("not resolvable")
    })
    const { result } = action("camunda7_resolve_incident")
    await waitFor(() => expect(result.current.allowed).toBe(true))
    act(() => result.current.run({ incidentId: "inc-1" }, { confirm: CONFIRM, feedback: FEEDBACK }))
    act(() => result.current.confirm())
    await waitFor(() => expect(result.current.error("inc-1")).toBe("not resolvable"))
    expect(document.querySelector(`[data-slot="toast"]`)).toBeNull()
  })
})
