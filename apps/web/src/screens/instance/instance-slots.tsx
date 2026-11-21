import { useCallback, useMemo } from "react"
import type { InstanceSlots, ScreenCopy, ScreenLinkProps } from "@miragon/pulse-blocks"
import { cn, FOCUS_RING, useToast } from "@miragon/pulse-ui"
import { useT } from "../../messages/index.js"
import { PageLink, type Navigate } from "../../router/page-link.js"
import { PagePlainTable, targetUrl } from "../slots.js"

/** A link of a block, in the page's quiet look: underlined text in the link's colour. */
const LINK = cn(
  "text-link rounded-xs underline decoration-1 underline-offset-3 hover:decoration-2",
  FOCUS_RING,
)

/**
 * The page's copy of a block's text: on the clipboard, and a toast that names what it copied, or
 * that it could not (the browser refused the clipboard).
 */
function useCopy(): (copy: ScreenCopy) => void {
  const t = useT()
  const toast = useToast()
  return useCallback(
    (copy: ScreenCopy) => {
      const done = () =>
        toast.show({ tone: "success", title: t("copy.done", { label: copy.label }) })
      const failed = () =>
        toast.show({
          tone: "danger",
          title: t("copy.failed", { label: copy.label }),
          description: t("copy.failedHint"),
        })
      // A page served without a secure context (plain http beyond loopback) has no clipboard.
      const clipboard = navigator.clipboard as Clipboard | undefined
      if (clipboard === undefined) {
        failed()
        return
      }
      clipboard.writeText(copy.text).then(done, failed)
    },
    [t, toast],
  )
}

/**
 * The slots the page brings to an instance's blocks: its plain table at the height its tab leaves
 * it, its link to a target (a real `<a href>` of the page's router, so Ctrl or Cmd with a click and
 * a middle click open a new tab) and its copy. The page writes nothing, so it fills no write slot.
 */
export function useInstanceSlots(navigate: Navigate): InstanceSlots {
  const onCopy = useCopy()
  const Link = useMemo(
    () =>
      function PageTargetLink({ rel, target, title, children }: ScreenLinkProps) {
        return (
          <PageLink
            href={targetUrl(target)}
            navigate={navigate}
            title={title}
            data-rel={rel}
            className={LINK}
          >
            {children}
          </PageLink>
        )
      },
    [navigate],
  )
  return useMemo(() => ({ PlainTable: PagePlainTable, Link, onCopy }), [Link, onCopy])
}
