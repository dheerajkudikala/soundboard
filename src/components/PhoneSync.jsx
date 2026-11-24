import { useEffect, useState } from "react";
import { getDbUrl, setDbUrl } from "../lib/cloudDb";
import { getPublishStatus, onPublishStatus, queuePublish } from "../lib/publish";

export default function PhoneSync() {
  const [url, setUrl] = useState("");
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState({ state: "idle" });

  useEffect(() => {
    getDbUrl().then((value) => {
      setUrl(value);
      setSaved(Boolean(value));
    });
    getPublishStatus().then(setStatus);
    return onPublishStatus(setStatus);
  }, []);

  async function save() {
    try {
      const next = await setDbUrl(url);
      setUrl(next);
      setSaved(Boolean(next));
      if (next) queuePublish();
    } catch (error) {
      setStatus({ state: "error", message: error.message });
    }
  }

  const hint =
    status.state === "saving"
      ? "Saving to the database…"
      : status.state === "ok"
        ? "Phones pick this up live. Open the PWA or Chrome on the phone."
        : status.state === "need-db"
          ? "Paste the Firebase database URL once. After that, every Mac edit updates the phone."
          : status.state === "error"
            ? status.message
            : saved
              ? "Clips, names, and trims save to the database. The phone listens for changes."
              : "This is a live database, not GitHub. Create it once, paste the URL, then forget it.";

  return (
    <section className="space-y-3 rounded-3xl border border-white/10 bg-zinc-900/50 p-4">
      <h2 className="text-sm font-semibold text-white">Live database</h2>
      <p className="text-xs leading-relaxed text-zinc-400">{hint}</p>
      <ol className="list-decimal space-y-1 pl-4 text-xs text-zinc-500">
        <li>
          Open{" "}
          <a
            href="https://console.firebase.google.com/"
            target="_blank"
            rel="noreferrer"
            className="text-indigo-300 underline"
          >
            Firebase
          </a>
          , create a project, then Realtime Database → Create → start in test mode.
        </li>
        <li>Copy the URL that looks like https://something-default-rtdb.firebaseio.com</li>
        <li>Paste it here, then send that same URL in chat so the phone can listen too.</li>
      </ol>
      <input
        type="url"
        autoComplete="off"
        spellCheck={false}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onBlur={save}
        placeholder="https://your-app-default-rtdb.firebaseio.com"
        className="w-full rounded-2xl border border-white/10 bg-zinc-950 px-3 py-2 text-sm outline-none"
      />
      <button
        type="button"
        onClick={save}
        className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-200"
      >
        {saved ? "Database connected" : "Connect database"}
      </button>
    </section>
  );
}
