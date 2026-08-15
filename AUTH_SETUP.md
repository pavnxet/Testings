# 🔐 Password Authentication + Guest Preview

The Worker uses a Cloudflare Worker secret named `AUTH_PASSWORD`.

## 1. Create the secret

With Wrangler:

```bash
npx wrangler secret put AUTH_PASSWORD
```

Or in Cloudflare Dashboard: **Worker → Settings → Variables and Secrets → Add secret**.

Use:

```text
AUTH_PASSWORD
```

The password is stored only as a Cloudflare secret and is not committed to GitHub.

## 2. Guest preview

Unauthenticated visitors now get a **2-minute signed guest preview** of the dashboard.

During guest mode:

- The dashboard UI is visible.
- The scraper input is read-only/disabled.
- `/scrape` is rejected by the Worker with HTTP 401.
- The guest token is signed with `AUTH_PASSWORD` and expires after 120 seconds.
- The token is `HttpOnly`, `Secure`, and `SameSite=Strict`.

After two minutes the guest preview redirects to the login screen.

## 3. Full authentication

Successful login creates a signed authentication cookie that lasts 24 hours.

- `/scrape` requires the authenticated cookie server-side.
- `/logout` clears the authentication cookie.
- The password is never placed in frontend JavaScript or source code.
- If `AUTH_PASSWORD` is missing, the Worker fails closed with HTTP 500.

## 4. Security note

The 2-minute guest system is intentionally stateless. A visitor who deletes their guest cookie, uses a new browser profile, or uses another device can receive another 2-minute preview. This does **not** grant scraper access, because `/scrape` still requires the signed authenticated session.

To enforce a stronger guest quota per IP/device, add Cloudflare Rate Limiting or a Durable Object/KV-backed guest registry.

After changing the Worker code or secret, redeploy the Worker. Do not put the password in `worker.js`, `wrangler.toml`, frontend code, or any public repository file.
