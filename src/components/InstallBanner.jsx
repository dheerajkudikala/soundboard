export default function InstallBanner({ install, showIosTip, canInstall, onInstall, onDismiss }) {
  if (!canInstall && !showIosTip) return null;

  return (
    <div className="mx-4 mb-3 rounded-2xl border border-white/10 bg-zinc-900/90 px-3 py-2.5 backdrop-blur-md">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">Install Soundboard</p>
          {showIosTip ? (
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">
              On iPhone: tap <span className="text-zinc-200">Share</span> then{" "}
              <span className="text-zinc-200">Add to Home Screen</span>.
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-zinc-400">Add it to your dock for one-tap offline clips.</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canInstall ? (
            <button
              type="button"
              onClick={onInstall}
              className="rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Install App
            </button>
          ) : null}
          <button type="button" onClick={onDismiss} className="text-xs text-zinc-500 hover:text-white">
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

export function UpdateToast({ show, onReload }) {
  if (!show) return null;
  return (
    <div className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-lg rounded-2xl border border-emerald-400/20 bg-zinc-900/95 px-4 py-3 shadow-lg shadow-emerald-500/10 md:bottom-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-200">A new version is ready.</p>
        <button
          type="button"
          onClick={onReload}
          className="rounded-full bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-300"
        >
          Update
        </button>
      </div>
    </div>
  );
}
