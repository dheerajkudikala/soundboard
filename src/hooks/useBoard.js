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
import { getDbUrl, pullBoard, subscribeBoard } from "../lib/cloudDb";
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

    let stopWatch = () => {};

    async function load() {
      await seedIfEmpty();
      const dbUrl = await getDbUrl();
      if (dbUrl) {
        await pullBoard({ overwriteMeta: phone }).catch(() => false);
      } else {
        await pullSitePack({ overwriteMeta: phone });
      }
      if (cancelled) return;
      await refresh();
      setReady(true);
      if (phone && dbUrl) {
        stopWatch = subscribeBoard(() => {
          pullBoard({ overwriteMeta: true })
            .then((changed) => changed && refresh())
            .catch(() => {});
        });
      }
    }

    load();

    const onVisible = () => {
      if (document.hidden || !phone) return;
      getDbUrl().then((dbUrl) =>
        (dbUrl ? pullBoard({ overwriteMeta: true }) : pullSitePack({ overwriteMeta: true }))
          .then((changed) => changed && refresh())
          .catch(() => {})
      );
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      stopWatch();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
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
