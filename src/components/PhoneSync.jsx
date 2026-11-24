import { useEffect, useState } from "react";
import { getPublishStatus, getPublishToken, onPublishStatus, queuePublish, setPublishToken } from "../lib/publish";

const TOKEN_URL =
  "https://github.com/settings/tokens/new?description=Soundboard%20phones&scopes=public_repo";

export default function PhoneSync() {
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState({ state: "idle" });

  useEffect(() => {
    getPublishToken().then((value) => {
      setToken(value);
      setSaved(Boolean(value));
    });
    getPublishStatus().then(setStatus);
    return onPublishStatus(setStatus);
  }, []);

  async function saveToken() {
    await setPublishToken(token);
    setSaved(Boolean(token.trim()));
    if (token.trim()) queuePublish();
  }

  const hint =
    status.state === "saving"
      ? "Updating phones…"
      : status.state === "ok"
        ? `Phones will see ${status.clips} clip${status.clips === 1 ? "" : "s"} after a refresh.`
        : status.state === "need-token"
          ? "Mac saves stay on this computer until you paste a GitHub token once."
          : status.state === "error"
            ? status.message
            : saved
              ? "New clips and edits upload to the site pack. Open the phone app again to hear them."
              : "Paste a GitHub token once. After that, every save on this Mac updates the phone.";

  return (
    <section className="space-y-3 rounded-3xl border border-white/10 bg-zinc-900/50 p-4">
      <h2 className="text-sm font-semibold text-white">Update phones</h2>
      <p className="text-xs leading-relaxed text-zinc-400">{hint}</p>
      <ol className="list-decimal space-y-1 pl-4 text-xs text-zinc-500">
        <li>
          <a href={TOKEN_URL} target="_blank" rel="noreferrer" className="text-indigo-300 underline">
            Create a token
          </a>{" "}
          with <code className="text-zinc-300">public_repo</code>. Copy it.
        </li>
        <li>Paste it here. It stays on this Mac only.</li>
      </ol>
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={token}
        onChange={(e) => setToken(e.target.value)}
        onBlur={saveToken}
        placeholder="ghp_…"
        className="w-full rounded-2xl border border-white/10 bg-zinc-950 px-3 py-2 text-sm outline-none"
      />
      <button
        type="button"
        onClick={saveToken}
        className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-200"
      >
        {saved ? "Token saved on this Mac" : "Save token"}
      </button>
    </section>
  );
}
