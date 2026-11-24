import { useEffect, useState } from "react";
import { getSyncState, onSyncChange } from "../lib/cloudSync";

export default function SyncBar() {
  const [state, setState] = useState(getSyncState);
  const [, setTick] = useState(0);

  useEffect(() => onSyncChange(setState), []);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const color =
    state.status === "error"
      ? "text-rose-300"
      : state.status === "syncing"
        ? "text-amber-300"
        : "text-emerald-300";

  return (
    <p className={`text-[11px] ${color}`}>
      {state.message}
      {state.status === "ok" && state.at
        ? ` · ${Math.max(0, Math.round((Date.now() - state.at) / 1000))}s ago`
        : ""}
    </p>
  );
}
