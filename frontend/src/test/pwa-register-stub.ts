// Test stand-in for `virtual:pwa-register/react` (the real module only exists inside the Vite PWA build).
export function useRegisterSW() {
  return {
    needRefresh: [false, () => undefined],
    offlineReady: [false, () => undefined],
    updateServiceWorker: () => Promise.resolve(),
  };
}
