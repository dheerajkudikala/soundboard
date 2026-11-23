import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import Pad from "./Pad.jsx";

export default function Soundboard({
  friends,
  clips,
  playOnly,
  onAddFriend,
  onRenameClip,
  onDeleteClip,
}) {
  const [filter, setFilter] = useState("all");

  const visible = useMemo(() => {
    if (filter === "all") return clips;
    return clips.filter((c) => c.friendId === filter);
  }, [clips, filter]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const friend of friends) map.set(friend.id, []);
    map.set("none", []);
    for (const clip of visible) {
      const key = friends.some((f) => f.id === clip.friendId) ? clip.friendId : "none";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(clip);
    }
    return map;
  }, [visible, friends]);

  return (
    <div className="space-y-5">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        <FilterPill large={playOnly} active={filter === "all"} onClick={() => setFilter("all")}>
          All
        </FilterPill>
        {friends.map((friend) => (
          <FilterPill
            key={friend.id}
            large={playOnly}
            active={filter === friend.id}
            onClick={() => setFilter(friend.id)}
            color={friend.color}
          >
            {friend.name}
          </FilterPill>
        ))}
        {playOnly ? null : (
          <button
            type="button"
            onClick={onAddFriend}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-white/20 px-3 py-1.5 text-xs font-medium text-zinc-300"
          >
            <Plus size={12} /> Add Friend
          </button>
        )}
      </div>

      {clips.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/10 px-4 py-16 text-center">
          <p className="text-sm font-medium text-zinc-200">No clips yet</p>
          <p className="mt-1 text-xs text-zinc-500">
            {playOnly ? "Add clips on a laptop, then they show up here to tap and play." : "Open Clip Audio, drop a voice memo, and save quotes to the board."}
          </p>
        </div>
      ) : filter === "all" ? (
        friends.map((friend) => {
          const items = grouped.get(friend.id) || [];
          if (!items.length) return null;
          return (
            <section key={friend.id} className="space-y-3">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                <span className="h-2 w-2 rounded-full" style={{ background: friend.color }} />
                {friend.name}
              </h2>
              <Grid playOnly={playOnly}>
                {items.map((clip) => (
                  <Pad
                    key={clip.id}
                    clip={clip}
                    friend={friend}
                    playOnly={playOnly}
                    onRename={onRenameClip}
                    onDelete={onDeleteClip}
                  />
                ))}
              </Grid>
            </section>
          );
        })
      ) : (
        <Grid playOnly={playOnly}>
          {visible.map((clip) => (
            <Pad
              key={clip.id}
              clip={clip}
              friend={friends.find((f) => f.id === clip.friendId)}
              playOnly={playOnly}
              onRename={onRenameClip}
              onDelete={onDeleteClip}
            />
          ))}
        </Grid>
      )}
    </div>
  );
}

function Grid({ children, playOnly }) {
  return (
    <div
      className={
        playOnly
          ? "grid grid-cols-1 gap-4 sm:grid-cols-2"
          : "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
      }
    >
      {children}
    </div>
  );
}

function FilterPill({ active, onClick, children, color, large }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full font-semibold transition ${
        large ? "px-4 py-2.5 text-sm" : "px-3 py-1.5 text-xs"
      } ${active ? "bg-gradient-to-r from-indigo-500 to-violet-600 text-white" : "bg-white/5 text-zinc-300"}`}
    >
      {color ? <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} /> : null}
      {children}
    </button>
  );
}
