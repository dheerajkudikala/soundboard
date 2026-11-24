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
import { queuePublish } from "../lib/publish";

export function useBoard() {
  const [friends, setFriends] = useState([]);
  const [clips, setClips] = useState([]);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const [nextFriends, nextClips] = await Promise.all([listFriends(), listClips()]);
    setFriends(nextFriends);
    setClips(nextClips);
  }, []);

  const publish = useCallback(() => {
    const desktop =
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 768px) and (hover: hover) and (pointer: fine)").matches;
    if (desktop) queuePublish();
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
      if (document.hidden || !phone) return;
      pullSitePack({ overwriteMeta: true })
        .then((changed) => changed && refresh())
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const tick = phone
      ? window.setInterval(() => {
          if (document.hidden) return;
          pullSitePack({ overwriteMeta: true })
            .then((changed) => changed && refresh())
            .catch(() => {});
        }, 20000)
      : 0;
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (tick) window.clearInterval(tick);
    };
  }, [refresh]);

  return {
    friends,
    clips,
    ready,
    refresh,
    publish,
    addFriend: async (name) => {
      const friend = await addFriend(name);
      await refresh();
      publish();
      return friend;
    },
    renameFriend: async (id, name) => {
      await renameFriend(id, name);
      await refresh();
      publish();
    },
    deleteFriend: async (id) => {
      await deleteFriend(id);
      await refresh();
      publish();
    },
    renameClip: async (id, title) => {
      await updateClip(id, { title });
      await refresh();
      publish();
    },
    moveClip: async (id, friendId) => {
      await updateClip(id, { friendId });
      await refresh();
      publish();
    },
    deleteClip: async (id) => {
      await deleteClip(id);
      await refresh();
      publish();
    },
  };
}
