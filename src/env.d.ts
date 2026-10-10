/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Build identity injected by vite.config.ts (`define`). */
declare const __APP_BUILD__: { version: string; commit: string; builtAt: string }
