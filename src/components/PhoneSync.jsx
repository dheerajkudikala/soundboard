import { useEffect, useState } from "react";
import { getPublishStatus, onPublishStatus, queuePublish } from "../lib/publish";

export default function PhoneSync() {
  const [status, setStatus] = useState({ state: "idle" });

  useEffect(() => {
    getPublishStatus().then(setStatus);
    return onPublishStatus(setStatus);
  }, []);

  const hint =
    status.state === "saving"
      ? "Uploading clips to the live database…"
      : status.state === "ok"
        ? `Live. ${status.clips || 0} clips are in the database for the phone.`
        : status.state === "error"
          ? status.message
          : "Open this Mac site and it uploads. The phone checks the database every few seconds.";

  return (
    <section className="space-y-3 rounded-3xl border border-white/10 bg-zinc-900/50 p-4">
      <h2 className="text-sm font-semibold text-white">Live database</h2>
      <p className="text-xs leading-relaxed text-zinc-400">{hint}</p>
      <button
        type="button"
        onClick={() => queuePublish()}
        className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-200"
      >
        Upload to phones now
      </button>
    </section>
  );
}
