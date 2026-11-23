import { useEffect, useRef, useState } from "react";
import { Square } from "lucide-react";
import Clipper from "./components/Clipper.jsx";
import FriendsBackup from "./components/FriendsBackup.jsx";
import InstallBanner, { UpdateToast } from "./components/InstallBanner.jsx";
import ClipEditor from "./components/ClipEditor.jsx";
import DeleteClipModal from "./components/DeleteClipModal.jsx";
import NameModal from "./components/NameModal.jsx";
import Soundboard from "./components/Soundboard.jsx";
import { useBoard } from "./hooks/useBoard.js";
import { useDesktop } from "./hooks/useDesktop.js";
import { useInstallPrompt } from "./hooks/useInstallPrompt.js";
import { getClipBlob } from "./lib/db.js";
import { playClip, stopAll } from "./lib/audio.js";
import { hasGithubToken, schedulePublish } from "./lib/githubSync.js";

export default function App() {
  const board = useBoard();
  const install = useInstallPrompt();
  const desktop = useDesktop();
  const [tab, setTab] = useState("board");
  const [friendModal, setFriendModal] = useState(false);
  const [renameClip, setRenameClip] = useState(null);
  const [editorClip, setEditorClip] = useState(null);
  const [deleteClip, setDeleteClip] = useState(null);
  const [needsSync, setNeedsSync] = useState(() => typeof window !== "undefined" && !hasGithubToken());
  const friendAddedRef = useRef(null);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") {
        if (editorClip || friendModal || renameClip) {
          setEditorClip(null);
          setFriendModal(false);
          setRenameClip(null);
          return;
        }
        stopAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [friendModal, renameClip, editorClip]);

  useEffect(() => {
    if (!desktop) setTab("board");
  }, [desktop]);

  function openAddFriend(onCreated) {
    friendAddedRef.current = onCreated || null;
    setFriendModal(true);
  }

  return (
    <div className={`mx-auto flex min-h-[100dvh] flex-col ${desktop ? "max-w-5xl" : "max-w-lg"}`}>
      <header className="sticky top-0 z-20 border-b border-white/10 bg-zinc-950/85 px-4 pb-3 pt-3 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <div>
            {desktop ? (
              <p className="text-[11px] uppercase tracking-[0.2em] text-indigo-300">Offline PWA</p>
            ) : null}
            <h1 className={`font-semibold tracking-tight ${desktop ? "text-lg" : "text-2xl"}`}>Soundboard</h1>
          </div>
          <button
            type="button"
            onClick={stopAll}
            className={`inline-flex items-center rounded-full border border-white/10 font-semibold ${
              desktop ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-sm"
            }`}
          >
            <Square size={desktop ? 12 : 16} className="mr-1" /> Stop
          </button>
        </div>
        {desktop ? (
        <nav className="mt-3 gap-1 rounded-2xl border border-white/10 bg-zinc-900/70 p-1 flex">
          {[
            ["board", "Soundboard"],
            ["clip", "Clip Audio"],
            ["friends", "Friends / Backup"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium ${
                tab === id ? "bg-gradient-to-r from-indigo-500 to-violet-600 text-white" : "text-zinc-400"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
        ) : null}
      </header>

      {desktop && needsSync ? (
        <div className="mx-4 mb-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-100">
          Connect GitHub once under Friends / Backup so clips you add here show up on your iPhone.
        </div>
      ) : null}

      <InstallBanner
        canInstall={install.canInstall}
        showIosTip={install.showIosTip}
        onInstall={install.install}
        onDismiss={install.dismiss}
      />

      <main className={`flex-1 px-4 py-4 ${desktop ? "pb-10" : "pb-[calc(1.5rem+env(safe-area-inset-bottom))]"}`}>
        {(tab === "board" || !desktop) && (
          <Soundboard
            friends={board.friends}
            clips={board.clips}
            playOnly={!desktop}
            onAddFriend={() => openAddFriend()}
            onRenameClip={(clip) => setEditorClip(clip)}
            onDeleteClip={(clip) => setDeleteClip(clip)}
          />
        )}
        {desktop && tab === "clip" && (
          <Clipper
            friends={board.friends}
            onSaved={() => {
              board.refresh();
              schedulePublish();
            }}
            onCreateFriend={board.addFriend}
          />
        )}
        {desktop && tab === "friends" && (
          <FriendsBackup
            friends={board.friends}
            clips={board.clips}
            onAddFriend={() => openAddFriend()}
            onRenameFriend={board.renameFriend}
            onDeleteFriend={(id) => {
              if (window.confirm("Delete this friend and their clips?")) board.deleteFriend(id);
            }}
            onImported={() => {
              board.refresh();
              schedulePublish();
            }}
            onTokenSaved={() => setNeedsSync(!hasGithubToken())}
          />
        )}
      </main>

      <UpdateToast show={install.needRefresh} onReload={install.applyUpdate} />

      <NameModal
        open={friendModal}
        title="Add friend"
        label="Name"
        placeholder="Silvano"
        confirmLabel="Add friend"
        onClose={() => {
          setFriendModal(false);
          friendAddedRef.current = null;
        }}
        onSubmit={async (name) => {
          const friend = await board.addFriend(name);
          friendAddedRef.current?.(friend);
          friendAddedRef.current = null;
        }}
      />
      {deleteClip ? (
        <DeleteClipModal
          title={deleteClip.title}
          onCancel={() => {
            stopAll();
            setDeleteClip(null);
          }}
          onPlay={async () => {
            const blob = await getClipBlob(deleteClip.id);
            if (!blob) return;
            await playClip(deleteClip.id, blob, {
              volume: deleteClip.volume ?? 1,
              playbackRate: deleteClip.playbackRate ?? 1,
              preservePitch: deleteClip.preservePitch !== false,
            });
          }}
          onConfirm={async () => {
            stopAll();
            await board.deleteClip(deleteClip.id);
            setDeleteClip(null);
          }}
        />
      ) : null}

      {editorClip ? (
        <ClipEditor
          clip={editorClip}
          friends={board.friends}
          onClose={() => setEditorClip(null)}
          onSaved={() => {
            board.refresh();
            schedulePublish();
          }}
        />
      ) : null}

      <NameModal
        open={Boolean(renameClip)}
        title="Rename clip"
        label="Title"
        placeholder="Clip name"
        initialValue={renameClip?.title || ""}
        confirmLabel="Save"
        onClose={() => setRenameClip(null)}
        onSubmit={async (title) => {
          await board.renameClip(renameClip.id, title);
        }}
      />
    </div>
  );
}
