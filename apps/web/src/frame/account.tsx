import { useState } from "react"
import { Button, Icon } from "@miragon/pulse-ui"
import { LogOut } from "lucide-react"
import { useT } from "../messages/index.js"
import type { SessionPage } from "./session-page.js"

/**
 * Who is signed in, and the sign-out, which says it runs until the browser leaves: at the foot of
 * the page's navigation, the name cut with an ellipsis (its whole in its title) beside the button.
 * A sign-out that did not go through calls `onFailed` (the drawer closes, so the page's notice
 * shows), then the page says so above the view's bar.
 */
export function Account({ page, onFailed }: { page: SessionPage; onFailed?: () => void }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const signedInAs = t("frame.signedInAs", { name: page.session.name })
  const run = () => {
    setBusy(true)
    void page.signOut().then((left) => {
      if (left) return
      setBusy(false)
      onFailed?.()
      page.notices.show("sign-out-failed")
    })
  }
  return (
    <div data-slot="page-account" className="px-gutter flex min-w-0 items-center gap-2 py-2">
      <p className="text-small text-muted-foreground min-w-0 flex-1 truncate" title={signedInAs}>
        <span className="sr-only">{signedInAs}</span>
        <span aria-hidden="true">{page.session.name}</span>
      </p>
      <Button
        type="button"
        variant="toolbar"
        size="sm"
        aria-disabled={busy || undefined}
        onClick={busy ? undefined : run}
      >
        <Icon icon={LogOut} />
        {busy ? t("frame.signingOut") : t("frame.signOut")}
      </Button>
    </div>
  )
}
