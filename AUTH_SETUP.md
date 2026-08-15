# 🔐 Password Authentication Setup

The Worker is now protected by a Cloudflare Worker secret named `AUTH_PASSWORD`.

## 1. Create the secret

If you deploy with Wrangler:

```bash
npx wrangler secret put AUTH_PASSWORD
```

Enter the password when Wrangler prompts you. The password is stored as a Cloudflare Worker secret and is **not** committed to GitHub.

If you deploy from the Cloudflare dashboard, open the Worker and add `AUTH_PASSWORD` under **Settings → Variables and Secrets** as a secret.

## 2. What changed

- `/` requires authentication.
- `/scrape` is also protected server-side, so calling the API directly does not bypass the login.
- Successful login creates an `HttpOnly`, `Secure`, `SameSite=Strict` signed session cookie.
- Sessions expire after 24 hours.
- `/logout` invalidates the session cookie.
- The password itself is never sent to GitHub or stored in source code.
- If `AUTH_PASSWORD` is missing, the Worker fails closed with HTTP 500 instead of running unprotected.

## 3. Important

Do **not** put the password in `worker.js`, frontend JavaScript, `wrangler.toml`, or any public repository file.

After adding the secret, redeploy the Worker. Existing users will need to log in again after the deployment.