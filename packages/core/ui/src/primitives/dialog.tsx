"use client"

import { createContext, useContext } from "react"
import type * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { useFocusReturn } from "../lib/focus-return.js"
import { useUiMessages } from "../locale/locale-provider.js"
import { cn } from "../lib/utils.js"
import { usePortalContainer } from "../theme/portal-container.js"
import { Button, buttonVariants } from "./button.js"

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  container,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  // Default to the nearest portal container (theme + mode), not <body>.
  const portalContainer = usePortalContainer()
  return (
    <DialogPrimitive.Portal
      data-slot="dialog-portal"
      container={container ?? portalContainer ?? undefined}
      {...props}
    />
  )
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

/** The scrim (`--scrim`, the guide's backdrop) blurs and greys the view behind the dialog. */
function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 bg-scrim fixed inset-0 z-50 backdrop-blur-[3px] backdrop-grayscale",
        className,
      )}
      {...props}
    />
  )
}

/** Whether the content draws its close button, which sits in the header's top right corner. */
const DialogCloseButtonContext = createContext(false)

/**
 * A dialog up to 560 px wide, 16 px off each edge of a narrower view (a confirmation narrows it
 * to 440 px through `className`), in three parts that carry its spacing (CI §8): `DialogHeader`,
 * `DialogBody` and `DialogFooter`. Its close button is a 32 px ghost icon button in the header's
 * top right corner, 16 px in from the edges.
 */
function DialogContent({
  className,
  children,
  showCloseButton = true,
  closeLabel,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  /** Accessible name of the close button. Default: the locale's "Close". */
  closeLabel?: string
}) {
  const messages = useUiMessages()
  // Without a DialogTrigger, Radix returns the focus nowhere: hand it back to
  // the element that opened it (lib/focus-return.ts).
  const focusReturn = useFocusReturn({ onOpenAutoFocus, onCloseAutoFocus })
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "bg-popover text-popover-foreground dark:border-input data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 shadow-3 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[min(560px,calc(100%-2rem))] translate-x-[-50%] translate-y-[-50%] rounded-md border duration-(--motion-base) focus-visible:outline-hidden",
          className,
        )}
        {...props}
        {...focusReturn}
      >
        <DialogCloseButtonContext.Provider value={showCloseButton}>
          {children}
        </DialogCloseButtonContext.Provider>
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "text-muted-foreground absolute top-4 right-4 size-8",
            )}
          >
            <XIcon />
            <span className="sr-only">{closeLabel ?? messages.common.close}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

/**
 * The title and its description: 16 px above, 24 px on the left, 8 px below, 16 px on the right,
 * and the close button's 32 px with an 8 px gap kept clear beside them while it shows.
 */
function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  const closeButton = useContext(DialogCloseButtonContext)
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "flex flex-col gap-1 pt-4 pr-4 pb-2 pl-6 text-left",
        closeButton && "pr-14",
        className,
      )}
      {...props}
    />
  )
}

/**
 * The dialog's content under its header: 24 px on the sides and below. Prose takes the body step;
 * a form's controls and a table bring their own 13 px.
 */
function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn("text-body flex min-w-0 flex-col gap-3 px-6 pb-6", className)}
      {...props}
    />
  )
}

/**
 * The buttons under a rule, 24 px on the sides and 16 px above and below, secondary before
 * primary; they take `size="lg"`, the 36 px control of a dialog.
 */
function DialogFooter({
  className,
  showCloseButton = false,
  closeLabel,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
  /** Label of the footer close button. Default: the locale's "Close". */
  closeLabel?: string
}) {
  const messages = useUiMessages()
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 border-t px-6 py-4 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline" size="lg">
            {closeLabel ?? messages.common.close}
          </Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      // The dialog's heading row (CI §8: weight 600) on the type scale's
      // section step (21 px / 600, the CI h3).
      className={cn("text-section", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-dense", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
