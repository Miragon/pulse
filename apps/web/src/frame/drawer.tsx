import { createContext, useContext, useMemo, useState, type ReactNode } from "react"
import { Button, Dialog, DialogClose, DialogContent, DialogTitle, Icon } from "@miragon/pulse-ui"
import type { HostChrome } from "@miragon/pulse-widget-shell/widgets"
import { Menu, X } from "lucide-react"
import { useT } from "../messages/index.js"

/** The drawer's state, which the page's menu button reads wherever a view puts it. */
interface DrawerState {
  readonly open: boolean
  readonly show: () => void
}

const DrawerContext = createContext<DrawerState>({ open: false, show: () => undefined })

/**
 * The page's menu button: under 64rem the first element of every view bar (and of the page's own
 * row where a view shows none), which opens the navigation in the drawer; from 64rem on, where
 * the navigation stands beside the view, it takes no room.
 */
function MenuButton() {
  const t = useT()
  const { open, show } = useContext(DrawerContext)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={t("nav.menu")}
      title={t("nav.menu")}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={show}
      className="lg:hidden"
    >
      <Icon icon={Menu} />
    </Button>
  )
}

/** The page's menu, which the frame hands its views as their bar's first element. */
export const PAGE_MENU = <MenuButton />

/** What the page offers its views (`PageView`'s `chrome`): it navigates itself, its menu first. */
export const PAGE_CHROME: HostChrome = { menu: PAGE_MENU }

/** What the drawer's navigation does with the drawer. */
export interface DrawerControls {
  /**
   * Closes it as the page moves on (an entry): the page then hands focus to the new view's
   * heading, never back to the menu button.
   */
  readonly moveOn: () => void
  /**
   * Closes it, the focus back to the menu: where the page says something above the view's bar
   * (a sign-out that did not go through), which the modal drawer covers and hides from a screen
   * reader.
   */
  readonly close: () => void
}

/**
 * The navigation under 64rem: pulse-ui's dialog as a drawer from the left (its scrim, its
 * focus trap, Escape), the product's name and its close button in its first row. `children`
 * renders the navigation with the drawer's controls.
 */
function NavDrawer({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: (drawer: DrawerControls) => ReactNode
}) {
  const t = useT()
  // Closed as the page moves on: the page hands focus to the new view's heading itself.
  const [moving, setMoving] = useState(false)
  const controls: DrawerControls = {
    moveOn: () => {
      setMoving(true)
      onOpenChange(false)
    },
    close: () => onOpenChange(false),
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        side="left"
        showCloseButton={false}
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          if (moving) event.preventDefault()
          setMoving(false)
        }}
      >
        <div className="min-h-bar ps-gutter flex items-center justify-between gap-2 pe-2">
          <DialogTitle className="text-dense text-foreground font-semibold">
            {t("frame.product")}
          </DialogTitle>
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("nav.close")}
              title={t("nav.close")}
            >
              <Icon icon={X} />
            </Button>
          </DialogClose>
        </div>
        {children(controls)}
      </DialogContent>
    </Dialog>
  )
}

/**
 * The drawer of the page's navigation and the state its menu button reads: `children` is the page
 * (its menu buttons open the drawer), `navigation` what the drawer holds, given the drawer's
 * controls (`DrawerControls`).
 */
export function Drawer({
  navigation,
  children,
}: {
  navigation: (drawer: DrawerControls) => ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const state = useMemo<DrawerState>(() => ({ open, show: () => setOpen(true) }), [open])
  return (
    <DrawerContext.Provider value={state}>
      {children}
      <NavDrawer open={open} onOpenChange={setOpen}>
        {navigation}
      </NavDrawer>
    </DrawerContext.Provider>
  )
}
