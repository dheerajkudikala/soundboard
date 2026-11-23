import { useEffect, useRef, useState } from "react";

export default function NameModal({
  open,
  title,
  label,
  placeholder,
  initialValue = "",
  confirmLabel = "Save",
  onClose,
  onSubmit,
}) {
  const inputRef = useRef(null);
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    setError("");
    setBusy(false);
    const id = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, [open, initialValue]);

  if (!open) return null;

  async function submit(event) {
    event?.preventDefault();
    const name = value.trim();
    if (!name) {
      setError("Enter a name.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(name);
      onClose();
    } catch (err) {
      setError(err.message || "Could not save.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center">
      <button type="button" className="absolute inset-0" aria-label="Close" onClick={onClose} />
      <form
        onSubmit={submit}
        className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-900 p-4 shadow-2xl"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <h2 className="text-base font-semibold text-white">{title}</h2>
        <label className="mt-3 block">
          <span className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</span>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            className="mt-1 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
          />
        </label>
        {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full px-3 py-2 text-sm text-zinc-400">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
