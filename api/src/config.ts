// Where the app lives. One list feeds both checks, so they cannot drift:
// - sign-in may only return a token to a URL under one of these prefixes (exact app path, not the whole origin —
//   komogortev.github.io hosts every Pages site the owner has);
// - CORS admits their origins (CORS cannot be narrower than an origin).
// Production value is in wrangler.toml; local dev overrides it with `--var` in the `dev` script.
export function appUrls(env: { ALLOWED_APP_URLS: string }): string[] {
  return env.ALLOWED_APP_URLS.split(',').map((s) => s.trim()).filter(Boolean)
}

export function appOrigins(env: { ALLOWED_APP_URLS: string }): string[] {
  return appUrls(env).map((u) => new URL(u).origin)
}
