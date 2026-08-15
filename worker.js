/**
 * ⚡ Dedicated Multi-Link Cloudflare Scraper Panel
 * 🔐 Password auth + signed 2-minute guest preview
 * Secret required: AUTH_PASSWORD
 */

const AUTH_COOKIE = "ff_auth";
const GUEST_COOKIE = "ff_guest";
const AUTH_MAX_AGE = 60 * 60 * 24; // 24h
const GUEST_MAX_AGE = 60 * 2; // 2 minutes

const textEncoder = new TextEncoder();

function timingSafeEqual(a, b) {
  const aBytes = textEncoder.encode(String(a));
  const bBytes = textEncoder.encode(String(b));
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return base64Url(await crypto.subtle.sign("HMAC", key, textEncoder.encode(value)));
}

async function makeToken(secret, type, issuedAt) {
  const payload = `${type}.${issuedAt}`;
  return `${payload}.${await hmac(secret, payload)}`;
}

function readCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function verifyToken(token, secret, type, maxAgeSeconds) {
  if (!token || !secret) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== type) return false;

  const issuedAt = Number(parts[1]);
  if (!Number.isFinite(issuedAt)) return false;

  const now = Date.now();
  if (issuedAt > now + 60_000) return false;
  if (now - issuedAt > maxAgeSeconds * 1000) return false;

  const expected = await hmac(secret, `${type}.${issuedAt}`);
  return timingSafeEqual(parts[2], expected);
}

async function isAuthenticated(request, env) {
  return verifyToken(readCookie(request, AUTH_COOKIE), env.AUTH_PASSWORD, "auth", AUTH_MAX_AGE);
}

async function isGuest(request, env) {
  return verifyToken(readCookie(request, GUEST_COOKIE), env.AUTH_PASSWORD, "guest", GUEST_MAX_AGE);
}

function commonHeaders(contentType = "text/html; charset=utf-8") {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  };
}

function unauthorizedJson(message = "Authentication required.") {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status: 401,
    headers: commonHeaders("application/json")
  });
}

function loginPage(error = "") {
  const errorHtml = error
    ? `<div class="error">${escapeHtml(error)}</div>`
    : "";

  return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Private Scraper — Login</title>
<style>${baseCss()}</style>
</head>
<body class="center"><main class="card auth-card">
<div class="brand">🔐</div><h1>Private Scraper</h1>
<p class="muted">Enter the access password to unlock the full dashboard.</p>
${errorHtml}
<form method="POST" action="/login" class="stack">
<input name="password" type="password" autocomplete="current-password" required autofocus placeholder="Access password">
<button class="primary">Unlock dashboard</button>
</form>
<a class="secondary" href="/">← Back to guest preview</a>
</main></body></html>`, {
    status: 401,
    headers: commonHeaders()
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function baseCss() {
  return `
  :root{--bg:#faf6f0;--surface:#fff;--inner:#f6efe5;--ink:#1e1a15;--muted:#6e655a;--border:#e8ded0;--accent:#b55d2b;--success:#edf7ed;--successInk:#1e4620;--error:#fdeded;--errorInk:#5f2120}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100vh}
  body.center{display:grid;place-items:center;padding:24px}.card{background:var(--surface);border:1px solid var(--border);border-radius:22px;box-shadow:0 18px 45px rgba(30,26,21,.08)}
  .auth-card{width:min(430px,100%);padding:30px}.brand{font-size:34px}h1{margin:8px 0;font-size:28px}.muted{color:var(--muted);line-height:1.5}.stack{display:grid;gap:12px;margin-top:20px}
  input,textarea{width:100%;border:1px solid var(--border);border-radius:14px;background:var(--inner);color:var(--ink);padding:14px;font:inherit;outline:none}input:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(181,93,43,.14)}
  button,.button-link{border:0;border-radius:14px;padding:13px 16px;font:inherit;font-weight:700;cursor:pointer;text-decoration:none;text-align:center}.primary{background:var(--accent);color:#fff}.secondary{display:block;margin-top:12px;background:var(--inner);color:var(--ink);border:1px solid var(--border)}
  .error{margin-top:14px;padding:12px;border-radius:12px;background:var(--error);color:var(--errorInk);border:1px solid rgba(95,33,32,.12)}
  .wrap{width:min(900px,100%);margin:0 auto;padding:28px 18px 36px}.top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:18px}.title{font-size:32px;font-weight:800;letter-spacing:-.02em}.badge{display:inline-block;margin-left:8px;padding:4px 8px;border:1px solid var(--border);border-radius:9px;background:var(--inner);font-size:10px;font-weight:800;color:var(--accent);vertical-align:middle}
  .guest{padding:12px 14px;border-radius:14px;background:#fff7df;border:1px solid #efd78d;color:#6b5714;margin-bottom:16px}.row{display:flex;gap:10px;flex-wrap:wrap}.spacer{flex:1}.panel{padding:22px}.label{display:block;font-weight:700;margin-bottom:8px}.hint{font-size:13px;color:var(--muted)}.actions{margin-top:12px}.output{margin-top:18px}.hidden{display:none}.success{background:var(--success);border:1px solid rgba(30,70,32,.12);color:var(--successInk)}.errorBox{background:var(--error);border:1px solid rgba(95,33,32,.12);color:var(--errorInk)}.output textarea{min-height:130px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}
  @media(max-width:650px){.title{font-size:25px}.top{flex-direction:column}.actions{display:grid}.panel{padding:18px}}
  `;
}

function dashboard({ guest }) {
  const guestBanner = guest
    ? `<div class="guest"><strong>Guest preview:</strong> you have <span id="guestTimer">02:00</span> remaining. The dashboard is view-only; scraping is disabled until you unlock it.</div>`
    : `<div class="guest" style="background:var(--success);border-color:rgba(30,70,32,.12);color:var(--successInk)"><strong>Authenticated:</strong> full scraper access enabled.</div>`;

  const scrapeForm = guest
    ? `<div class="panel card"><div class="label">Input URLs</div><textarea rows="7" disabled placeholder="Available after authentication"></textarea><div class="actions"><a class="button-link primary" href="/login">🔐 Unlock full access</a></div></div>`
    : `<form id="scraperForm" class="panel card"><div class="label">Input URLs (one per line)</div><div class="hint">Maximum 30 URLs per batch.</div><textarea name="urls" id="urls" rows="7" placeholder="https://fuckingfast.co/..." required></textarea><div class="actions"><button id="submitBtn" class="primary" type="submit">🚀 Launch Parallel Scraper</button></div></form>`;

  return new Response(`<!doctype html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FuckingFast Scraper Dashboard</title><style>${baseCss()}</style></head>
<body><div class="wrap">
<div class="top"><div><div class="title">⚡ FuckingFast Scraper <span class="badge">V3.6-AUTH</span></div><div class="muted">High-speed extraction with the existing direct-link workflow.</div></div><div class="row"><a class="button-link secondary" href="/login">🔐 Login</a>${guest ? `<a class="button-link secondary" href="/guest-exit">✕ End preview</a>` : `<a class="button-link secondary" href="/logout">🚪 Logout</a>`}</div></div>
${guestBanner}
${scrapeForm}
<div id="output" class="output hidden">
<div id="successBox" class="panel card success"><div class="label">✅ Pure Direct Links (<span id="successCount">0</span>)</div><textarea id="resultBox" readonly></textarea><div class="actions"><button class="secondary" type="button" onclick="copyBox('resultBox')">📋 Copy Links</button></div><div class="label" style="margin-top:18px">📦 pCloud Rename Map</div><textarea id="renameMapBox" readonly></textarea></div>
<div id="errorBox" class="panel card errorBox" style="margin-top:14px"><div class="label">⚠️ Failed Signatures (<span id="errorCount">0</span>)</div><textarea id="errResultBox" readonly></textarea></div>
</div>
</div>
<script>
function copyBox(id){const x=document.getElementById(id);x.select();document.execCommand('copy')}
${guest ? `let remaining=120;const timer=document.getElementById('guestTimer');const tick=()=>{const m=String(Math.floor(remaining/60)).padStart(2,'0');const s=String(remaining%60).padStart(2,'0');timer.textContent=m+':'+s;if(remaining<=0){clearInterval(i);location.href='/login';}remaining--;};tick();const i=setInterval(tick,1000);` : `document.getElementById('scraperForm').addEventListener('submit',async(e)=>{e.preventDefault();const b=document.getElementById('submitBtn');b.disabled=true;b.textContent='⏳ Working...';try{const r=await fetch('/scrape',{method:'POST',body:new FormData(e.target)});const d=await r.json();if(r.status===401){location.href='/login';return}document.getElementById('output').classList.remove('hidden');document.getElementById('successBox').style.display=d.successLinks?.length?'block':'none';document.getElementById('errorBox').style.display=d.errorLinks?.length?'block':'none';document.getElementById('successCount').textContent=d.successLinks?.length||0;document.getElementById('errorCount').textContent=d.errorLinks?.length||0;document.getElementById('resultBox').value=(d.successLinks||[]).join('\\n');document.getElementById('errResultBox').value=(d.errorLinks||[]).join('\\n');document.getElementById('renameMapBox').value=(d.successLinks||[]).map((u,n)=>'Part_'+String(n+1).padStart(2,'0')+'  ==>  '+u.substring(u.lastIndexOf('/')+1)).join('\\n');}catch(err){alert('Request failed: '+err.message)}finally{b.disabled=false;b.textContent='🚀 Launch Parallel Scraper'}});`}
</script></body></html>`, { status: 200, headers: commonHeaders() });
}

async function scrape(request) {
  try {
    const formData = await request.formData();
    const urlsInput = formData.get("urls");
    if (!urlsInput) return new Response(JSON.stringify({ success:false, error:"No URLs provided!" }), { status:400, headers:commonHeaders("application/json") });

    const urls = String(urlsInput).split("\n").map(x=>x.trim()).filter(Boolean);
    if (!urls.length) return new Response(JSON.stringify({ success:false, error:"No valid URLs found." }), { status:400, headers:commonHeaders("application/json") });
    if (urls.length > 30) return new Response(JSON.stringify({ success:false, error:"Maximum 30 URLs allowed per batch." }), { status:429, headers:commonHeaders("application/json") });

    const headers = {
      "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
      "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language":"en-US,en;q=0.5",
      "Cache-Control":"no-cache",
      "Pragma":"no-cache"
    };

    const results = await Promise.all(urls.map(async targetUrl => {
      if (!/^https:\/\//i.test(targetUrl)) return {type:"error",msg:`❌ Rejected (Insecure Protocol): ${targetUrl}`};
      let target;
      try { target = new URL(targetUrl); } catch { return {type:"error",msg:`❌ Rejected (Invalid URL): ${targetUrl}`}; }
      if (target.hostname !== "fuckingfast.co" && !target.hostname.endsWith(".fuckingfast.co")) return {type:"error",msg:`❌ Rejected (Unsupported Domain): ${targetUrl}`};

      try {
        const response = await fetch(target.toString(), {headers, redirect:"follow"});
        if (response.status !== 200) return {type:"error",msg:`❌ HTTP Error ${response.status}: ${targetUrl}`};
        const pageSource = await response.text();
        const match = pageSource.match(/window\.open\("(https:\/\/dl\.fuckingfast\.co\/dl\/[^"]+)"\)/);
        const backup = pageSource.match(/(https:\/\/dl\.fuckingfast\.co\/dl\/[^\s"'<>]+)/);
        const directLink = match?.[1] || backup?.[1];
        return directLink ? {type:"success",msg:directLink.replace(/[\s"'<>]+$/g,"")} : {type:"error",msg:`⚠️ Direct link signature not found: ${targetUrl}`};
      } catch (e) {
        return {type:"error",msg:`❌ Network failure: ${e instanceof Error ? e.message : "Unknown error"}`};
      }
    }));

    return new Response(JSON.stringify({success:true,successLinks:results.filter(x=>x.type==="success").map(x=>x.msg),errorLinks:results.filter(x=>x.type==="error").map(x=>x.msg)}), {headers:commonHeaders("application/json")});
  } catch {
    return new Response(JSON.stringify({success:false,error:"Internal Server Error"}), {status:500,headers:commonHeaders("application/json")});
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!env.AUTH_PASSWORD) {
      return new Response("Server authentication is not configured. Set the AUTH_PASSWORD Worker secret.", { status:500, headers:commonHeaders("text/plain; charset=utf-8") });
    }

    if (request.method === "POST" && url.pathname === "/login") {
      try {
        const formData = await request.formData();
        const supplied = String(formData.get("password") || "");
        if (!timingSafeEqual(supplied, env.AUTH_PASSWORD)) return loginPage("Invalid password.");
        const token = await makeToken(env.AUTH_PASSWORD, "auth", Date.now());
        return new Response(null, {status:303,headers:{...commonHeaders(),Location:"/",Set-Cookie:`${AUTH_COOKIE}=${encodeURIComponent(token)}; Max-Age=${AUTH_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Strict`}});
      } catch { return loginPage("Unable to process login request."); }
    }

    if (url.pathname === "/logout") {
      return new Response(null,{status:303,headers:{...commonHeaders(),Location:"/",Set-Cookie:`${AUTH_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`}});
    }

    if (url.pathname === "/guest-exit") {
      return new Response(null,{status:303,headers:{...commonHeaders(),Location:"/login",Set-Cookie:`${GUEST_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`}});
    }

    if (request.method === "POST" && url.pathname === "/scrape") {
      if (!(await isAuthenticated(request, env))) return unauthorizedJson("Authentication required to scrape.");
      return scrape(request);
    }

    if (url.pathname === "/login" && request.method === "GET") return loginPage();

    const authenticated = await isAuthenticated(request, env);
    if (authenticated) return dashboard({guest:false});

    const guest = await isGuest(request, env);
    if (guest) return dashboard({guest:true});

    const guestToken = await makeToken(env.AUTH_PASSWORD, "guest", Date.now());
    return new Response((await dashboard({guest:true})).body, {
      status:200,
      headers:{...commonHeaders(),"Set-Cookie":`${GUEST_COOKIE}=${encodeURIComponent(guestToken)}; Max-Age=${GUEST_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Strict`}
    });
  }
};
