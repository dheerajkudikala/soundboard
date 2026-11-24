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
import { isPhoneDevice, pullBoard, subscribeBoard } from "../lib/cloudDb";
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
    queuePublish();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const phone = isPhoneDevice();
    let stopWatch = () => {};

    async function load() {
      await seedIfEmpty();
      await pullSitePack({ overwriteMeta: false }).catch(() => false);
      await pullBoard({ overwriteMeta: phone }).catch(() => false);
      if (cancelled) return;
      await refresh();
      setReady(true);
      if (phone) {
        stopWatch = subscribeBoard(() => {
          pullBoard({ overwriteMeta: true })
            .then((changed) => changed && refresh())
            .catch(() => {});
        });
      } else {
        queuePublish();
      }
    }

    load();

    const onVisible = () => {
      if (document.hidden) return;
      if (phone) {
        pullBoard({ overwriteMeta: true })
          .then((changed) => changed && refresh())
          .catch(() => {});
      } else {
        queuePublish();
      }
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
