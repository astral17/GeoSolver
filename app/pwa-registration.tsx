"use client";

import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations
          .filter(
            (registration) =>
              new URL(registration.scope).origin === window.location.origin,
          )
          .forEach((registration) => registration.unregister());
      });
      return;
    }
    const manifest = document.querySelector<HTMLLinkElement>(
      'link[rel="manifest"]',
    );
    const serviceWorkerUrl = new URL(
      "sw.js",
      manifest?.href ?? new URL(".", window.location.href),
    );
    navigator.serviceWorker.register(serviceWorkerUrl, {
      scope: new URL(".", serviceWorkerUrl).pathname,
    });
  }, []);

  return null;
}
