import {
  Component,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { reorder } from "@/lib/usage";

interface Props {
  ids: string[];
  enabled: boolean;
  className: string;
  onCommit: (ids: string[]) => void | Promise<unknown>;
  children: (id: string, index: number) => ReactNode;
}

// React's snapshot lifecycle runs before DOM reordering. It captures the visible
// positions, including unfinished animation offsets, before cancellation.
class LayoutSnapshot extends Component<{
  motionKey: string;
  capture: () => void;
  children: ReactNode;
}> {
  getSnapshotBeforeUpdate(previous: Readonly<typeof this.props>) {
    if (previous.motionKey !== this.props.motionKey) this.props.capture();
    return null;
  }
  componentDidUpdate() {}
  render() {
    return this.props.children;
  }
}

// Keep the real cards mounted while a non-interactive copy follows the pointer.
export function AccountReorder({
  ids,
  enabled,
  className,
  onCommit,
  children,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const positions = useRef(new Map<string, DOMRect>());
  const previousLayout = useRef(className);
  const previousOrder = useRef("");
  const animations = useRef(new Map<HTMLElement, Animation>());
  const settles = useRef(new Set<() => void>());
  const [draft, setDraft] = useState<string[] | null>(null);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const stop = () => {
      animations.current.forEach((animation) => animation.cancel());
      animations.current.clear();
      settles.current.forEach((finish) => finish());
    };
    const changed = () => {
      if (media?.matches) stop();
    };
    media?.addEventListener?.("change", changed);
    return () => {
      cleanup.current?.();
      stop();
      media?.removeEventListener?.("change", changed);
    };
  }, []);
  const visibleIds = draft
    ? [
        ...draft.filter((id) => ids.includes(id)),
        ...ids.filter((id) => !draft.includes(id)),
      ]
    : ids;
  const orderKey = visibleIds.join("\0");
  useLayoutEffect(() => {
    const host = container.current;
    if (!host) return;
    const next = new Map<string, DOMRect>();
    const layoutChanged = previousLayout.current !== className;
    const orderChanged = previousOrder.current !== orderKey;
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    host
      .querySelectorAll<HTMLElement>(":scope > [data-account-id]")
      .forEach((node) => {
        if (layoutChanged || orderChanged)
          animations.current.get(node)?.cancel();
        const rect = node.getBoundingClientRect();
        const old = positions.current.get(node.dataset.accountId!);
        next.set(node.dataset.accountId!, rect);
        if (
          node.dataset.exiting &&
          !node.style.getPropertyValue("--exit-height")
        )
          node.style.setProperty(
            "--exit-height",
            `${old?.height ?? rect.height}px`,
          );
        if (!node.dataset.exiting) node.style.removeProperty("--exit-height");
        if (
          orderChanged &&
          !reduced &&
          !layoutChanged &&
          old &&
          node.animate &&
          node.style.opacity !== "0" &&
          (old.left !== rect.left || old.top !== rect.top)
        ) {
          animations.current.set(
            node,
            node.animate(
              [
                {
                  transform: `translate(${old.left - rect.left}px, ${old.top - rect.top}px)`,
                },
                { transform: "translate(0, 0)" },
              ],
              { duration: 220, easing: "cubic-bezier(.2,.7,.2,1)" },
            ),
          );
        }
      });
    if (layoutChanged && !reduced && host.animate) {
      animations.current.get(host)?.cancel();
      animations.current.set(
        host,
        host.animate([{ opacity: 0.65 }, { opacity: 1 }], {
          duration: 180,
          easing: "ease-out",
        }),
      );
    }
    animations.current.forEach((animation, node) => {
      if (!host.contains(node) && node !== host) {
        animation.cancel();
        animations.current.delete(node);
      }
    });
    positions.current = next;
    previousLayout.current = className;
    previousOrder.current = orderKey;
  }, [orderKey, className, children]);
  useEffect(() => {
    cleanup.current?.();
  }, [enabled, ids.join("\0")]);

  return (
    <LayoutSnapshot
      motionKey={`${className}\0${orderKey}`}
      capture={() => {
        const host = container.current;
        if (!host) return;
        positions.current = new Map(
          Array.from(
            host.querySelectorAll<HTMLElement>(":scope > [data-account-id]"),
          ).map((node) => [
            node.dataset.accountId!,
            node.getBoundingClientRect(),
          ]),
        );
      }}
    >
      <div
        ref={container}
        className={className}
        onPointerDown={(event) => {
          if (!enabled || event.button !== 0 || cleanup.current) return;
          settles.current.forEach((finish) => finish());
          const target = event.target as HTMLElement;
          if (
            target.closest(
              "button, input, summary, a, select, textarea, [role='button'], [contenteditable='true']",
            )
          )
            return;
          const card = target.closest<HTMLElement>("[data-account-id]");
          const host = container.current;
          if (!card || !host || card.parentElement !== host) return;
          // Stop native text selection before the drag threshold is reached.
          event.preventDefault();
          const source = card.dataset.accountId!;
          const origin = card.getBoundingClientRect();
          const startX = event.clientX,
            startY = event.clientY;
          const pointerId = event.pointerId;
          const slots = Array.from(
            host.querySelectorAll<HTMLElement>(":scope > [data-account-id]"),
          ).map((node) => node.getBoundingClientRect());
          const initialScroll = window.scrollY;
          let order = [...ids];
          let ghost: HTMLElement | null = null;
          let active = false;
          const previousSelection = document.body.style.userSelect;
          const previousWebkitSelection = document.body.style.getPropertyValue(
            "-webkit-user-select",
          );
          const previousCursor = document.body.style.cursor;
          const finish = (commit: boolean) => {
            const preview = ghost;
            let settleAnimation: Animation | undefined;
            let removed = false;
            const removePreview = () => {
              if (removed) return;
              removed = true;
              settleAnimation?.cancel();
              preview?.remove();
              card.style.removeProperty("opacity");
              settles.current.delete(removePreview);
            };
            if (
              commit &&
              active &&
              preview?.animate &&
              !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
            ) {
              const destination = card.getBoundingClientRect();
              settleAnimation = preview.animate(
                [
                  { transform: preview.style.transform },
                  {
                    transform: `translate(${destination.left - origin.left}px, ${destination.top - origin.top}px)`,
                  },
                ],
                { duration: 160, easing: "ease-out", fill: "forwards" },
              );
              settles.current.add(removePreview);
              settleAnimation.finished.then(removePreview, removePreview);
            } else removePreview();
            document.body.style.userSelect = previousSelection;
            if (previousWebkitSelection)
              document.body.style.setProperty(
                "-webkit-user-select",
                previousWebkitSelection,
              );
            else document.body.style.removeProperty("-webkit-user-select");
            document.body.style.cursor = previousCursor;
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", cancel);
            window.removeEventListener("keydown", key);
            window.removeEventListener("blur", cancel);
            cleanup.current = null;
            if (
              commit &&
              active &&
              order.some((id, index) => id !== ids[index])
            ) {
              // Keep the live order until the backend accepts it; rejection returns
              // to the last authoritative order without remounting any cards.
              Promise.resolve(onCommit(order)).then(
                (accepted) => {
                  if (accepted === false) removePreview();
                  setDraft(null);
                },
                () => {
                  removePreview();
                  setDraft(null);
                },
              );
            } else setDraft(null);
          };
          const move = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return;
            if (
              !active &&
              Math.hypot(e.clientX - startX, e.clientY - startY) < 6
            )
              return;
            if (!active) {
              active = true;
              window.getSelection()?.removeAllRanges();
              ghost = card.cloneNode(true) as HTMLElement;
              ghost.removeAttribute("data-account-id");
              ghost.removeAttribute("id");
              ghost.removeAttribute("data-entering");
              ghost.removeAttribute("data-exiting");
              ghost
                .querySelectorAll("[id]")
                .forEach((node) => node.removeAttribute("id"));
              ghost.setAttribute("aria-hidden", "true");
              ghost.inert = true;
              ghost.classList.add("account-drag-preview");
              Object.assign(ghost.style, {
                position: "fixed",
                left: `${origin.left}px`,
                top: `${origin.top}px`,
                width: `${origin.width}px`,
                height: `${origin.height}px`,
                margin: "0",
                pointerEvents: "none",
                zIndex: "100",
                boxShadow: "0 18px 48px #0004",
              });
              host.append(ghost);
              card.style.opacity = "0";
              document.body.style.userSelect = "none";
              document.body.style.setProperty("-webkit-user-select", "none");
              document.body.style.cursor = "grabbing";
            }
            e.preventDefault();
            ghost!.style.transform = `translate(${e.clientX - startX}px, ${e.clientY - startY}px)`;
            // Stable slots avoid swapping back when the displaced card animates under the mouse.
            const y = e.clientY + window.scrollY - initialScroll;
            let nearest = 0,
              distance = Infinity;
            slots.forEach((rect, index) => {
              const dx = Math.max(
                rect.left - e.clientX,
                0,
                e.clientX - rect.right,
              );
              const dy = Math.max(rect.top - y, 0, y - rect.bottom);
              const d = dx * dx + dy * dy;
              if (d < distance) {
                distance = d;
                nearest = index;
              }
            });
            const from = order.indexOf(source);
            if (from === nearest) return;
            order = reorder(order, source, order[nearest]);
            setDraft(order);
          };
          const up = (e: PointerEvent) => {
            if (e.pointerId === pointerId) finish(true);
          };
          const cancel = () => finish(false);
          const key = (e: KeyboardEvent) => {
            if (e.key === "Escape") finish(false);
          };
          cleanup.current = cancel;
          window.addEventListener("pointermove", move, { passive: false });
          window.addEventListener("pointerup", up);
          window.addEventListener("pointercancel", cancel);
          window.addEventListener("keydown", key);
          window.addEventListener("blur", cancel);
        }}
      >
        {visibleIds.map(children)}
      </div>
    </LayoutSnapshot>
  );
}
