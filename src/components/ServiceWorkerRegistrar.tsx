"use client";

import { useEffect } from "react";

/**
 * Регистрация service worker (аудит A-15). Флаг `enabled` вычисляет серверный layout в рантайме
 * (`NODE_ENV=production` и не задан `DISABLE_SW=1`), поэтому офлайн-режим можно выключить без
 * пересборки образа. В dev кэш навигаций и статики мешал бы HMR, поэтому там, наоборот, снимаем
 * прежнюю регистрацию — как и при явном отключении.
 */
export function ServiceWorkerRegistrar({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (!enabled) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => {});
      return;
    }
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* нет HTTPS / приватный режим — приложение работает и без офлайн-кэша */
    });
  }, [enabled]);
  return null;
}

/** Просит service worker забыть кэшированные ответы API (вызывается при выходе из аккаунта). */
export function clearServiceWorkerCache() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.controller?.postMessage({ type: "clear-cache" });
}
