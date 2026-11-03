// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, renderHook, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { LocaleProvider, ToastProvider } from "@miragon/pulse-ui"
import { failureLine, useActionFeedback, type ActionFeedback } from "./action-feedback.js"

afterEach(cleanup)

/** The hook under a locale and a toast stack; the toasts render into the document. */
function renderIn(locale: string): ActionFeedback {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <LocaleProvider locale={locale}>
      <ToastProvider>{children}</ToastProvider>
    </LocaleProvider>
  )
  return renderHook(() => useActionFeedback(), { wrapper }).result.current
}

const toastOf = (text: string) => screen.getByText(text).closest('[data-slot="toast"]')

describe("useActionFeedback (U9: a write is never silent)", () => {
  it("confirms a success with a success toast naming the object", () => {
    const feedback = renderIn("de")
    act(() => feedback.succeeded("Job für LEA-2026-00424 neu eingeplant"))
    expect(toastOf("Job für LEA-2026-00424 neu eingeplant")?.getAttribute("data-tone")).toBe(
      "success",
    )
  })

  it("passes a success's second line on", () => {
    const feedback = renderIn("en")
    act(() => feedback.succeeded("Job rescheduled", "It runs within the next minute."))
    expect(screen.getByText("It runs within the next minute.")).toBeTruthy()
  })

  it("reports a failure as a danger toast: the object, then why and what to do, not the raw text", () => {
    const feedback = renderIn("de")
    act(() =>
      feedback.failed(
        "Job für LEA-2026-00424 konnte nicht neu eingeplant werden",
        new Error("[503 ProcessEngineException] down (engine prod)"),
      ),
    )
    const toast = toastOf("Job für LEA-2026-00424 konnte nicht neu eingeplant werden")
    expect(toast?.getAttribute("data-tone")).toBe("danger")
    expect(toast?.textContent).toContain(
      "Die Engine prod ist nicht erreichbar (HTTP 503). Prüf, ob die Engine läuft, oder wähl eine andere Engine.",
    )
    expect(toast?.textContent).not.toContain("ProcessEngineException")
  })

  it("carries an engine refusal's reason in the toast itself (U9: no Details there)", () => {
    const feedback = renderIn("en")
    act(() =>
      feedback.failed(
        "Couldn't retry the job for LEA-1",
        new Error("[500 ProcessEngineException] Job is already finished (engine prod)"),
      ),
    )
    const toast = toastOf("Couldn't retry the job for LEA-1")
    expect(toast?.textContent).toContain("“Job is already finished”")
    expect(toast?.textContent).not.toContain("Details")
  })

  it("announces through pulse-ui's polite live region", () => {
    const feedback = renderIn("en")
    act(() => feedback.succeeded("Saved"))
    const viewport = document.querySelector('[data-slot="toast-viewport"]')
    expect(viewport?.getAttribute("aria-live")).toBe("polite")
    expect(viewport?.textContent).toContain("Saved")
  })

  it("is a no-op outside a toast provider (a bare fixture never crashes)", () => {
    const { result } = renderHook(() => useActionFeedback())
    expect(() => result.current.succeeded("x")).not.toThrow()
    expect(() => result.current.failed("x", new Error("y"))).not.toThrow()
  })
})

describe("failureLine", () => {
  it("is the reason and the next step for a known kind, the next step alone otherwise", () => {
    expect(failureLine(new Error("engine p unreachable (ECONNREFUSED)"), "en")).toBe(
      "Engine p is unreachable. Check that the engine is running, or pick another engine.",
    )
    expect(failureLine(new Error("odd"), "en")).toBe(
      "Try again. If it fails again, ask in the chat.",
    )
  })

  it("quotes an engine refusal's own reason: a toast has no Details to point to", () => {
    const de = failureLine(
      new Error("[500 ProcessEngineException] Cannot resolve incident (engine prod)"),
      "de",
    )
    expect(de).toBe(
      "Die Engine prod meldet einen Fehler (HTTP 500): „Cannot resolve incident“. Versuch es noch mal oder frag im Chat nach.",
    )
    const en = failureLine(
      new Error(
        "[400 InvalidRequestException] Cannot complete task t-1: variable amount is missing. (engine prod)",
      ),
      "en",
    )
    expect(en).toBe(
      "Engine prod reported an error (HTTP 400): “Cannot complete task t-1: variable amount is missing”. Try again, or ask in the chat.",
    )
    for (const line of [de, en]) expect(line).not.toMatch(/Details|ProcessEngineException|\[/)
  })

  it("keeps the next step when the refusal carries no words, and cuts a long one", () => {
    expect(failureLine(new Error("[500] (engine prod)"), "en")).toBe(
      "Engine prod reported an error (HTTP 500). Try again, or ask in the chat.",
    )
    const long = failureLine(new Error(`[500 X] ${"word ".repeat(80)}`), "en")
    expect(long).toContain("…”.")
    expect(long.length).toBeLessThan(300)
  })

  it("says a write whose answer never came may have gone through: no blind retry", () => {
    expect(
      failureLine(
        new Error(
          "engine prod did not respond within 30000 ms (timeout) — the POST may still have been applied; check the current state before retrying",
        ),
        "de",
      ),
    ).toBe(
      "Die Engine prod antwortet nicht rechtzeitig. Vielleicht hat es trotzdem geklappt. Prüf den aktuellen Stand, bevor du es noch mal versuchst.",
    )
    expect(
      failureLine(
        new Error(
          "connection to engine prod failed (UND_ERR_SOCKET) — the PUT may still have been applied; check the current state before retrying",
        ),
        "en",
      ),
    ).toBe(
      "Engine prod is unreachable. It may have worked anyway. Check the current state before you try again.",
    )
  })
})
