import { afterEach, describe, expect, it, vi } from "vitest"
import type { WebviewIntent, WriteState } from "../../src/core/protocol/index.js"
import { HostContext, type Host } from "../../src/webview/host/host-context.js"
import { useSubmission } from "../../src/webview/host/submission.js"
import { buttonNamed, fakeApi, getRole, mount, type Mounted } from "./harness.js"

const TARGET = { kind: "variable", name: "amount" } as const
const SAVE: WebviewIntent = { type: "setVariable", name: "amount", valueJson: "13" }

interface ProbeProps {
  readonly mine: WriteState | undefined
  readonly onClose: () => void
}

function SubmissionProbe({ mine, onClose }: ProbeProps) {
  const submission = useSubmission(mine, onClose)
  return (
    <>
      <output aria-label="Phase">{submission.phase}</output>
      <button
        type="button"
        onClick={() => {
          submission.submit(SAVE)
        }}
      >
        Save
      </button>
    </>
  )
}

describe("a submission", () => {
  let mounted: Mounted
  const posted: WebviewIntent[] = []
  const host: Host = {
    api: fakeApi(posted),
    back: undefined,
    post: (intent) => posted.push(intent),
  }
  const onClose = vi.fn()

  afterEach(() => {
    mounted.unmount()
    posted.length = 0
  })

  function probe(mine: WriteState | undefined) {
    return (
      <HostContext.Provider value={host}>
        <SubmissionProbe mine={mine} onClose={onClose} />
      </HostContext.Provider>
    )
  }

  function phase(): string {
    return getRole(mounted.root, "status", { name: "Phase" }).textContent
  }

  function sentAndCancelled(): void {
    mounted = mount(probe(undefined))
    buttonNamed(mounted.root, "Save").click()
    mounted.update(probe(undefined))
    expect(phase()).toBe("sent")
    expect(posted).toEqual([SAVE])
    mounted.update(probe({ status: "cancelled", target: TARGET }))
  }

  it("is back to editing once the confirmation is cancelled, so a later done closes nothing", () => {
    sentAndCancelled()
    expect(phase()).toBe("editing")

    mounted.update(probe({ status: "done", target: TARGET }))

    expect(phase()).toBe("editing")
    expect(onClose).not.toHaveBeenCalled()
  })

  it("takes a failure after a cancel as no answer, since nothing was sent since", () => {
    sentAndCancelled()

    mounted.update(probe({ status: "failed", target: TARGET, message: "local refused it." }))

    expect(phase()).toBe("editing")
  })
})
