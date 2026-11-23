import { Grid2x2, Scissors, Users } from "lucide-react";

const tabs = [
  { id: "board", label: "Soundboard", icon: Grid2x2 },
  { id: "clip", label: "Clip Audio", icon: Scissors },
  { id: "friends", label: "Friends / Backup", icon: Users },
];

export default function BottomNav({ tab, onChange }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-zinc-950/90 backdrop-blur-md md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-3">
        {tabs.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${
                active ? "text-indigo-300" : "text-zinc-500"
              }`}
            >
              <Icon size={20} />
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
