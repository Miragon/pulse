import { Button, EmptyState, ErrorState, Icon } from "@miragon/pulse-ui"
import type { PageFrame } from "@miragon/pulse-widget-shell/widgets"
import { LogIn, LogOut } from "lucide-react"
import { PageBar, PageLayout } from "./bar.js"
import { useT } from "./messages/index.js"
import { signInUrl } from "./routes.js"

/**
 * A page that found no session when it asked for one (it ended between the page and its first
 * read): what happened, and the sign-in that comes back to the page.
 */
export function endedFrame(returnTo: string): PageFrame {
  return function EndedFrame() {
    const t = useT()
    return (
      <PageLayout banner={<PageBar />}>
        <main className="p-gutter flex-1">
          <EmptyState
            icon={<LogOut />}
            title={t("page.ended.title")}
            description={t("page.ended.description")}
            titleAs="h2"
            size="page"
            action={
              <Button asChild>
                <a href={signInUrl(returnTo)}>
                  <Icon icon={LogIn} />
                  {t("action.signInAgain")}
                </a>
              </Button>
            }
          />
        </main>
      </PageLayout>
    )
  }
}

/** A page whose session could not be read (the server answered no session, nor its absence). */
export function unreachableFrame(reload: () => void): PageFrame {
  return function UnreachableFrame() {
    const t = useT()
    return (
      <PageLayout banner={<PageBar />}>
        <main className="p-gutter flex-1">
          <ErrorState
            title={t("page.unreachable.title")}
            description={t("page.unreachable.description")}
            onRetry={reload}
            retryLabel={t("action.tryAgain")}
            role="none"
          />
        </main>
      </PageLayout>
    )
  }
}
