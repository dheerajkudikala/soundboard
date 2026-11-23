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
    (async () => {
      await seedIfEmpty();
      await importBundledManifest();
      await refresh();
      setReady(true);
    })();
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
