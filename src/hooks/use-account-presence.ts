import { useEffect, useRef, useState } from "react";
import type { Account } from "@/lib/types";

// Keep only successfully removed records for the brief exit. Initial loading and
// remounting start from the supplied records, so they never replay entrances.
export function useAccountPresence(accounts: Account[], ready = true) {
  const wasReady = useRef(ready);
  useEffect(() => {
    wasReady.current = ready;
  }, [ready]);
  const [presence, setPresence] = useState({
    source: accounts,
    accounts,
    exiting: [] as string[],
    entering: [] as string[],
  });
  let current = presence;
  if (presence.source !== accounts) {
    const removed = presence.accounts.filter(
      (a) => !accounts.some((next) => next.id === a.id),
    );
    current = {
      source: accounts,
      accounts: [...accounts],
      exiting: removed.map((a) => a.id),
      entering: wasReady.current
        ? accounts
            .filter(
              (a) =>
                presence.entering.includes(a.id) ||
                !presence.accounts.some((old) => old.id === a.id),
            )
            .map((a) => a.id)
        : [],
    };
    for (const a of removed) {
      const index = presence.accounts.findIndex(
        (previous) => previous.id === a.id,
      );
      current.accounts.splice(Math.min(index, current.accounts.length), 0, a);
    }
    setPresence(current);
  }
  const exitKey = current.exiting.join("\0");
  useEffect(() => {
    if (!exitKey) return;
    const finish = () =>
      setPresence((previous) => ({
        ...previous,
        accounts: previous.accounts.filter(
          (a) => !previous.exiting.includes(a.id),
        ),
        exiting: [],
      }));
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    const timer = setTimeout(finish, 180);
    return () => clearTimeout(timer);
  }, [exitKey]);
  const entryKey = current.entering.join("\0");
  useEffect(() => {
    if (!entryKey) return;
    const timer = setTimeout(
      () => setPresence((previous) => ({ ...previous, entering: [] })),
      200,
    );
    return () => clearTimeout(timer);
  }, [entryKey]);
  return current;
}
