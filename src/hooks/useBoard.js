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
import { pullSitePack } from "../lib/sitePack";

export function useBoard() {
  const [friends, setFriends] = useState([]);
  const [clips, setClips] = useState([]);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const [nextFriends, nextClips] = await Promise.all([listFriends(), listClips()]);
    setFriends(nextFriends);
    setClips(nextClips);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const phone =
      typeof window !== "undefined" &&
      !window.matchMedia("(min-width: 768px) and (hover: hover) and (pointer: fine)").matches;

    async function load() {
      await seedIfEmpty();
      await pullSitePack({ overwriteMeta: phone });
      if (cancelled) return;
      await refresh();
      setReady(true);
    }

    load();

    const onVisible = () => {
      if (document.hidden) return;
      pullSitePack({ overwriteMeta: phone })
        .then((changed) => changed && refresh())
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
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
      return friend;
    },
    renameFriend: async (id, name) => {
      await renameFriend(id, name);
      await refresh();
    },
    deleteFriend: async (id) => {
      await deleteFriend(id);
      await refresh();
    },
    renameClip: async (id, title) => {
      await updateClip(id, { title });
      await refresh();
    },
    moveClip: async (id, friendId) => {
      await updateClip(id, { friendId });
      await refresh();
    },
    deleteClip: async (id) => {
      await deleteClip(id);
      await refresh();
    },
  };
}
