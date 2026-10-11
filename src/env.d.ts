/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Build identity injected by vite.config.ts (`define`). */
declare const __APP_BUILD__: { version: string; commit: string; builtAt: string }

interface ImportMetaEnv {
  /** Set only by the GitHub Pages build after the origin move: the address the app now lives at. Its presence = the "moved" build. */
  readonly VITE_MOVED_TO?: string
}
