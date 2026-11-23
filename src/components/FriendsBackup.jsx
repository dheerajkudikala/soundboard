import { useRef, useState } from "react";
import { Download, Trash2, Upload } from "lucide-react";
import { downloadBlob, exportBoardZip, importBoardZip } from "../lib/boardZip";
import { hasGithubToken, publishBoard, setGithubToken, testGithubToken } from "../lib/githubSync";

export default function FriendsBackup({
  friends,
  clips,
  onAddFriend,
  onRenameFriend,
  onDeleteFriend,
  onImported,
  onTokenSaved,
}) {
  const fileRef = useRef(null);
  const [status, setStatus] = useState("");
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(() => hasGithubToken());
  const [savingToken, setSavingToken] = useState(false);

  async function exportZip() {
    const blob = await exportBoardZip();
    downloadBlob(blob, `soundboard-${new Date().toISOString().slice(0, 10)}.zip`);
    setStatus("Board exported.");
  }

  async function importZip(file) {
    if (!file) return;
    try {
      await importBoardZip(file);
      await onImported?.();
      setStatus("Board imported.");
    } catch (error) {
      setStatus(error.message || "Import failed.");
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-white">Friends</h2>
        <div className="space-y-2">
          {friends.map((friend) => {
            const count = clips.filter((c) => c.friendId === friend.id).length;
            return (
              <div key={friend.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-zinc-900/60 px-3 py-2.5">
                <span className="h-3 w-3 rounded-full" style={{ background: friend.color }} />
                <input
                  defaultValue={friend.name}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== friend.name) onRenameFriend(friend.id, name);
                  }}
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
                <span className="text-xs text-zinc-500">{count}</span>
                <button type="button" onClick={() => onDeleteFriend(friend.id)} className="text-zinc-500 hover:text-rose-300">
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onAddFriend}
          className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-200"
        >
          + Add Friend
        </button>
      </section>

      <section className="space-y-3 rounded-3xl border border-indigo-400/20 bg-indigo-500/10 p-4">
        <h2 className="text-sm font-semibold text-white">iPhone sync</h2>
        <p className="text-xs leading-relaxed text-zinc-400">
          One-time on this MacBook: create a GitHub token with the <span className="text-zinc-200">public_repo</span> scope,
          paste it here, then clips you save go to the site. Your iPhone reads them automatically.
        </p>
        {connected ? (
          <p className="text-xs text-emerald-300">Connected. New clips will show up on your iPhone after a refresh.</p>
        ) : (
          <form
            className="space-y-2"
            onSubmit={async (event) => {
              event.preventDefault();
              setSavingToken(true);
              setStatus("");
              try {
                const login = await testGithubToken(token.trim());
                setGithubToken(token.trim());
                setConnected(true);
                setToken("");
                onTokenSaved?.();
                setStatus(`Connected as ${login}. Publishing your board…`);
                await publishBoard();
                setStatus(`Connected as ${login}. Board published.`);
              } catch (error) {
                setStatus(error.message || "Token did not work. Use a classic token with public_repo.");
              } finally {
                setSavingToken(false);
              }
            }}
          >
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_…"
              className="w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
            />
            <div className="flex flex-wrap gap-2">
              <a
                href="https://github.com/settings/tokens/new?description=Soundboard%20iPhone%20sync&scopes=public_repo"
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-indigo-200"
              >
                Create token
              </a>
              <button
                type="submit"
                disabled={savingToken || !token.trim()}
                className="rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 px-3 py-2 text-xs font-semibold disabled:opacity-50"
              >
                {savingToken ? "Connecting…" : "Save and publish"}
              </button>
            </div>
          </form>
        )}
        {connected ? (
          <button
            type="button"
            onClick={() => {
              setGithubToken("");
              setConnected(false);
              onTokenSaved?.();
              setStatus("Disconnected. iPhone will keep the last published board.");
            }}
            className="text-xs text-zinc-500"
          >
            Disconnect
          </button>
        ) : null}
      </section>

      <section className="space-y-3 rounded-3xl border border-white/10 bg-zinc-900/50 p-4">
        <h2 className="text-sm font-semibold text-white">GitHub Sync / Backup</h2>
        <p className="text-xs leading-relaxed text-zinc-400">
          Export a zip of <code className="text-zinc-200">manifest.json</code> plus trimmed wavs. Import it on another phone,
          or drop clips into <code className="text-zinc-200">public/sounds</code> and ship them with GitHub Pages.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportZip}
            className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-2.5 text-sm font-semibold"
          >
            <Download size={15} /> Export Board (.zip)
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold"
          >
            <Upload size={15} /> Import Board (.zip)
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => importZip(e.target.files?.[0])}
          />
        </div>
        {status ? <p className="text-xs text-indigo-200">{status}</p> : null}
      </section>
    </div>
  );
}
