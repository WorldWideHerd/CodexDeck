import { useEffect, useRef, useState } from "react";
import { bridge } from "@/lib/bridge";
import type { Account, RefreshResult } from "@/lib/types";

// A fulfilled command alone is not evidence of a successful quota read.
export function refreshSucceeded(before: Account[], result: RefreshResult) {
  return (
    before.length > 0 &&
    before.every((previous) => {
      const next = result.accounts.find((a) => a.id === previous.id);
      return (
        next?.status === "connected" &&
        !next.error &&
        !!next.snapshot &&
        next.updatedAt !== null &&
        result.refreshedIds?.includes(previous.id)
      );
    })
  );
}

export function useQuietFeedback() {
  const [confirmed, setConfirmed] = useState(false);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  function clear() {
    clearTimeout(timer.current);
    setConfirmed(false);
  }
  function confirm() {
    if (!mounted.current) return;
    clear();
    setConfirmed(true);
    timer.current = setTimeout(() => setConfirmed(false), 1400);
  }
  return { confirmed, confirm, clear };
}

export function useManualRefresh(
  accounts: Account[],
  run: (action: () => Promise<unknown>) => Promise<boolean>,
  id?: string,
) {
  const feedback = useQuietFeedback();
  const [pending, setPending] = useState(false);
  async function refresh() {
    feedback.clear();
    setPending(true);
    let successful = false;
    try {
      const completed = await run(async () => {
        const result = await bridge.refresh(id);
        successful = refreshSucceeded(accounts, result);
        return result;
      });
      if (completed && successful) feedback.confirm();
    } finally {
      setPending(false);
    }
  }
  return { ...feedback, pending, refresh };
}
