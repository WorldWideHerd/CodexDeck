import * as Popup from "@radix-ui/react-dialog";
import { useRef, type ReactNode } from "react";

// Non-modal menus stay in their parent so their position remains stable on scroll.
export function PopupMenu({
  open,
  onOpenChange,
  className,
  contentClassName,
  label,
  title,
  trigger,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className: string;
  contentClassName: string;
  label: string;
  title?: string;
  trigger: ReactNode;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <Popup.Root modal={false} open={open} onOpenChange={onOpenChange}>
      <div className={className} data-state={open ? "open" : "closed"}>
        <Popup.Trigger
          className="popup-menu-trigger"
          aria-label={label}
          title={title}
        >
          {trigger}
        </Popup.Trigger>
        <Popup.Content
          ref={contentRef}
          className={contentClassName}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            contentRef.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            // An action may already have opened the account editor or confirmation.
            if (document.activeElement?.closest('[role="dialog"]'))
              event.preventDefault();
          }}
        >
          <Popup.Title className="sr-only">{label}</Popup.Title>
          {children}
        </Popup.Content>
      </div>
    </Popup.Root>
  );
}
