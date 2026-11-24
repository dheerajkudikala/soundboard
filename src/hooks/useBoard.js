import { useCallback, useEffect, useState } from "react";
import {
  addFriend,
  deleteClip,
  deleteFriend,
  listClips,
  listFriends,
  renameFriend,
  seedIfEmpty,
  updateClip,
} from "../lib/db";
import { importBundledManifest } from "../lib/boardZip";
import { POLL_MS, fillMissingAudio, pullPublishedBoard, schedulePublish } from "../lib/cloudSync";

export function useBoard() {
  const [friends, setFriends] = useState([]);
  const [clips, setClips] = useState([]);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const [f, c] = await Promise.all([listFriends(), listClips()]);
    setFriends(f);
    setClips(c);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const phone =
      typeof window !== "undefined" &&
      !window.matchMedia("(min-width: 768px) and (hover: hover) and (pointer: fine)").matches;

    async function load() {
      await seedIfEmpty();
      await importBundledManifest();
      try {
        await pullPublishedBoard({ prune: phone });
      } catch {
        /* bundled clips still load */
      }
      await fillMissingAudio();
      if (cancelled) return;
      await refresh();
      setReady(true);
      if (!phone) schedulePublish();
    }

    load();

    const onVisible = () => {
      if (document.hidden) return;
      Promise.all([
        pullPublishedBoard({ prune: phone }).catch(() => false),
        importBundledManifest(),
        fillMissingAudio(),
      ])
        .then(() => refresh())
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    const poll = window.setInterval(onVisible, POLL_MS);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      window.clearInterval(poll);
    };
  }, [refresh]);

  return {
    friends,
    clips,
    ready,
    refresh,
    addFriend: async (name) => {
      const friend = await addFriend(name);
      await refresh();
      schedulePublish();
      return friend;
    },
    renameFriend: async (id, name) => {
      await renameFriend(id, name);
      await refresh();
      schedulePublish();
    },
    deleteFriend: async (id) => {
      await deleteFriend(id);
      await refresh();
      schedulePublish();
    },
    renameClip: async (id, title) => {
      await updateClip(id, { title });
      await refresh();
      schedulePublish();
    },
    moveClip: async (id, friendId) => {
      await updateClip(id, { friendId });
      await refresh();
      schedulePublish();
    },
    deleteClip: async (id) => {
      await deleteClip(id);
      await refresh();
      schedulePublish();
    },
  };
}
