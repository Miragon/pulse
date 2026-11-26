import { Button, EmptyState, Icon } from "@miragon/pulse-ui"
import type { PageFrame, SignedOutReason } from "@miragon/pulse-widget-shell/widgets"
import {
  CircleX,
  Clock,
  KeyRound,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldX,
  Unplug,
  type LucideIcon,
} from "lucide-react"
import { PageLayout } from "./frame/layout.js"
import { useT } from "./messages/index.js"
import { signInUrl } from "./router/routes.js"

/** What the signed-out page shows per reason: its icon and the words of its one action. */
const REASONS: Readonly<
  Record<SignedOutReason, { readonly icon: LucideIcon; readonly action: string }>
> = {
  denied: { icon: ShieldX, action: "action.signInAgain" },
  expired: { icon: Clock, action: "action.signInAgain" },
  failed: { icon: CircleX, action: "action.signInAgain" },
  audience: { icon: KeyRound, action: "action.signInAgain" },
  signed_out: { icon: LogOut, action: "action.signIn" },
  unavailable: { icon: Unplug, action: "action.tryAgain" },
}

/**
 * The page a browser without a session sees (`/app/signed-out`), the server's answer for each way
 * a sign-in ends: what happened (its one heading, which titles the document per reason) and what to
 * do, and the one step that starts a sign-in, which comes back to `/app`. It needs no session, so
 * it shows no one and calls nothing.
 */
export function signedOutFrame(reason: SignedOutReason): PageFrame {
  const { icon: Glyph, action } = REASONS[reason]
  return function SignedOutFrame() {
    const t = useT()
    return (
      <PageLayout fallbackTitle={t("frame.product")}>
        <main className="p-gutter flex-1">
          <EmptyState
            icon={<Glyph />}
            title={t(`signedOut.${reason}.title`)}
            description={t(`signedOut.${reason}.description`)}
            titleAs="h1"
            size="page"
            action={
              <Button asChild>
                <a href={signInUrl()}>
                  <Icon icon={reason === "unavailable" ? RefreshCw : LogIn} />
                  {t(action)}
                </a>
              </Button>
            }
          />
        </main>
      </PageLayout>
    )
  }
}
