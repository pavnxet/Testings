import puppeteer from "@cloudflare/puppeteer";

const AUTH_COOKIE = "ff_auth";
const AUTH_MAX_AGE = 60 * 60 * 24;
const MAX_URLS = 30;
const encoder = new TextEncoder();

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function getKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function createAuthToken(secret) {
  const exp = Math.floor(Date.now() / 1000) + AUTH_MAX_AGE;
  const payload = String(exp);
  const key = await getKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${toBase64Url(encoder.encode(payload))}.${toBase64Url(new Uint8Array(signature))}`;
}

async function verifyAuthToken(request, secret) {
  if (!secret) return false;
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${AUTH_COOKIE}=([^;]+)`));
  if (!match) return false;
  try {
    const [payloadEncoded, signatureEncoded] = match[1].split(".");
    if (!payloadEncoded || !signatureEncoded) return false;
    const payload = new TextDecoder().decode(fromBase64Url(payloadEncoded));
    const exp = Number(payload);
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
    const key = await getKey(secret);
    return crypto.subtle.verify("HMAC", key, fromBase64Url(signatureEncoded), encoder.encode(payload));
  } catch {
    return false;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}

function page(title, body) {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
body{margin:0;background:#faf6f0;color:#1e1a15;font-family:system-ui,sans-serif;padding:24px}.card{max-width:900px;margin:40px auto;background:#fff;border:1px solid #e8ded0;border-radius:20px;padding:28px;box-shadow:0 10px 30px #0000000d}input,textarea,button{font:inherit}textarea{width:100%;min-height:220px;box-sizing:border-box;padding:14px;border:1px solid #e8ded0;border-radius:12px;background:#f6efe5}button{margin-top:12px;padding:12px 18px;border:0;border-radius:10px;background:#b55d2b;color:#fff;font-weight:700;cursor:pointer}.muted{color:#6e655a}.ok{color:#1e4620}.err{color:#8b2624;white-space:pre-wrap}code{word-break:break-all}</style></head><body><main class="card">${body}</main></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function loginPage(error = "") {
  return page("FuckingFast Resolver — Login", `<h1>⚡ FuckingFast Resolver</h1><p class="muted">Browser-based resolver with checkpointed failures.</p>${error ? `<p class="err">${error}</p>` : ""}<form method="POST" action="/login"><input name="password" type="password" placeholder="Access password" required autofocus style="width:100%;box-sizing:border-box;padding:13px;border:1px solid #e8ded0;border-radius:10px"><button>🔐 Unlock</button></form>`);
}

function dashboard() {
  return page("FuckingFast Resolver", `<h1>⚡ FuckingFast Resolver</h1><p class="muted">One URL per line. Filename fragments after <code>#</code> are preserved as metadata but never sent to the server.</p><form id="f"><textarea name="urls" placeholder="https://fuckingfast.co/bvkh77satm5c#filename.part1.rar"></textarea><button>Resolve links</button></form><pre id="out" style="margin-top:20px;white-space:pre-wrap"></pre><p><a href="/health">Health / diagnostics</a> · <a href="/logout">Logout</a></p><script>
const f=document.getElementById('f'),o=document.getElementById('out');
f.addEventListener('submit',async e=>{e.preventDefault();o.textContent='Resolving...';try{const r=await fetch('/scrape',{method:'POST',body:new FormData(f)});o.textContent=JSON.stringify(await r.json(),null,2)}catch(x){o.textContent='Request failed: '+x.message}});
</script>`);
}

function parseInput(raw) {
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:") throw new Error("Only HTTPS URLs are allowed");
  if (parsed.hostname !== "fuckingfast.co") throw new Error("Unsupported domain");
  const id = parsed.pathname.replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(id)) throw new Error("Invalid FuckingFast file id");
  const filename = parsed.hash ? decodeURIComponent(parsed.hash.slice(1)) : "";
  return { id, filename, pageUrl: `https://fuckingfast.co/${id}` };
}

async function resolveWithBrowser(input, env) {
  const target = parseInput(input);
  if (!env.BROWSER) throw new Error("BROWSER binding is missing. Configure Cloudflare Browser Run first.");

  const browser = await puppeteer.launch(env.BROWSER);
  const page = await browser.newPage();
  const checkpoint = { stage: "browser_launch", id: target.id };

  try {
    checkpoint.stage = "open_page";
    const response = await page.goto(target.pageUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    checkpoint.pageStatus = response ? response.status() : null;

    checkpoint.stage = "wait_for_page";
    await new Promise(r => setTimeout(r, 1000));

    checkpoint.stage = "resolve_endpoint";
    const result = await page.evaluate(async id => {
      const response = await fetch(`/f/${id}/go`, { method: "POST", headers: { "HX-Request": "true", "Accept": "text/html,*/*" } });
      return {
        status: response.status,
        redirect: response.headers.get("HX-Redirect") || response.headers.get("Location"),
        text: response.status >= 400 ? (await response.text()).slice(0, 500) : ""
      };
    }, target.id);

    checkpoint.stage = "validate_redirect";
    if (!result.redirect) throw new Error(`Resolver returned HTTP ${result.status} without a redirect`);
    if (!/^https:\/\/dl\.fuckingfast\.co\/dl\//.test(result.redirect)) throw new Error(`Unexpected redirect target: ${result.redirect.slice(0, 300)}`);

    return { success: true, directLink: result.redirect, filename: target.filename, checkpoint };
  } catch (error) {
    throw new Error(`${checkpoint.stage}: ${error.message}`);
  } finally {
    await browser.close();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const authSecret = env.AUTH_PASSWORD;
    if (!authSecret) return new Response("AUTH_PASSWORD is not configured", { status: 503 });

    if (url.pathname === "/login" && request.method === "GET") {
      if (await verifyAuthToken(request, authSecret)) return Response.redirect(url.origin + "/", 302);
      return loginPage();
    }

    if (url.pathname === "/login" && request.method === "POST") {
      const form = await request.formData();
      if (String(form.get("password") || "") !== authSecret) return loginPage("❌ Incorrect password");
      const token = await createAuthToken(authSecret);
      return new Response(null, { status: 302, headers: { Location: "/", "Set-Cookie": `${AUTH_COOKIE}=${token}; Max-Age=${AUTH_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Strict` } });
    }

    if (url.pathname === "/logout") return new Response(null, { status: 302, headers: { Location: "/login", "Set-Cookie": `${AUTH_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict` } });

    if (!(await verifyAuthToken(request, authSecret))) return loginPage();

    if (url.pathname === "/health") {
      return json({ ok: true, browserBindingConfigured: Boolean(env.BROWSER), resolver: "browser-run-v1", checkpointing: true, maxUrls: MAX_URLS });
    }

    if (request.method === "POST" && url.pathname === "/scrape") {
      const form = await request.formData();
      const raw = String(form.get("urls") || "");
      const inputs = raw.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      if (!inputs.length) return json({ success: false, error: "No URLs provided" }, 400);
      if (inputs.length > MAX_URLS) return json({ success: false, error: `Maximum ${MAX_URLS} URLs per batch` }, 429);

      const results = await Promise.all(inputs.map(async input => {
        const started = Date.now();
        try {
          const result = await resolveWithBrowser(input, env);
          return { input, ...result, elapsedMs: Date.now() - started };
        } catch (error) {
          return { input, success: false, error: error.message, elapsedMs: Date.now() - started };
        }
      }));

      return json({ success: true, results, successLinks: results.filter(x => x.success).map(x => x.directLink), failures: results.filter(x => !x.success) });
    }

    return dashboard();
  }
};
