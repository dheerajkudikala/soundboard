import { useEffect, useMemo, useState } from "react";

export function useInstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [hidden, setHidden] = useState(() => localStorage.getItem("sb-hide-install") === "1");
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateSW, setUpdateSW] = useState(null);

  const standalone = useMemo(() => {
    if (typeof window === "undefined") return false;
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  }, []);

  const isIOS = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }, []);

  useEffect(() => {
    const onPrompt = (event) => {
      event.preventDefault();
      setDeferred(event);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  useEffect(() => {
    let mounted = true;
    import("virtual:pwa-register")
      .then(({ registerSW }) => {
        const fn = registerSW({
          immediate: true,
          onNeedRefresh() {
            if (mounted) setNeedRefresh(true);
          },
        });
        if (mounted) setUpdateSW(() => fn);
      })
      .catch(() => {
        /* vite-plugin-pwa virtual module is unavailable outside the app */
      });
    return () => {
      mounted = false;
    };
  }, []);

  return {
    standalone,
    isIOS,
    canInstall: Boolean(deferred) && !standalone && !hidden,
    showIosTip: isIOS && !standalone && !hidden,
    needRefresh,
    install: async () => {
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
    },
    dismiss: () => {
      localStorage.setItem("sb-hide-install", "1");
      setHidden(true);
    },
    applyUpdate: () => updateSW?.(true),
  };
}
