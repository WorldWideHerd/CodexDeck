import * as CardPopup from "@radix-ui/react-dialog";
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
} from "react";
import { X } from "lucide-react";
import { Button } from "./ui/button";
import { AccountDetails } from "./account-details";

type Props = ComponentProps<typeof AccountDetails> & {
  children: ReactElement;
  onOpen: () => void;
  active?: boolean;
};

export function AccountInfoPopover({
  children,
  onOpen,
  active = true,
  ...props
}: Props) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);
  const editing = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const { account, fa, section } = props;
  const title =
    section === "resets"
      ? fa
        ? "ریست‌های هدیه"
        : "Reset credits"
      : section === "subscription"
        ? fa
          ? "پایان اشتراک"
          : "Subscription end"
        : fa
          ? "اعتبار و سهمیه"
          : "Credits & limits";
  return (
    <CardPopup.Root
      modal={false}
      open={open}
      onOpenChange={(value) => {
        if (value && active) onOpen();
        setOpen(value && active);
      }}
    >
      <CardPopup.Trigger asChild>{children}</CardPopup.Trigger>
      <CardPopup.Content
        ref={contentRef}
        className="account-info-popover"
        tabIndex={-1}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus({ preventScroll: true });
        }}
        dir={fa ? "rtl" : "ltr"}
        onCloseAutoFocus={(event) => {
          if (editing.current || !active) {
            event.preventDefault();
            editing.current = false;
          }
        }}
      >
        <header className="account-info-heading">
          <div>
            <CardPopup.Title>{title}</CardPopup.Title>
            <CardPopup.Description asChild>
              <p>
                <bdi>{account.label}</bdi>
              </p>
            </CardPopup.Description>
          </div>
          <CardPopup.Close asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={fa ? "بستن جزئیات" : "Close details"}
            >
              <X size={14} />
            </Button>
          </CardPopup.Close>
        </header>
        <div className="account-info-scroll">
          <AccountDetails
            {...props}
            onEdit={() => {
              editing.current = true;
              setOpen(false);
              props.onEdit();
            }}
          />
        </div>
      </CardPopup.Content>
    </CardPopup.Root>
  );
}
