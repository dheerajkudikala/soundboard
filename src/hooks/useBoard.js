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
import { pullPublishedBoard, schedulePublish } from "../lib/githubSync";

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
    const phone =
      typeof window !== "undefined" &&
      !window.matchMedia("(min-width: 768px) and (hover: hover) and (pointer: fine)").matches;

    async function load(fromRemote) {
      await seedIfEmpty();
      if (fromRemote || phone) {
        try {
          await pullPublishedBoard();
        } catch {
          await importBundledManifest();
        }
      } else {
        await importBundledManifest();
      }
      await refresh();
      setReady(true);
    }

    load(false);
    if (!phone) return undefined;

    const onVisible = () => {
      if (document.hidden) return;
      pullPublishedBoard()
        .then(() => refresh())
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const poll = window.setInterval(onVisible, 45000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
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
