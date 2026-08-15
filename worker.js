/**
 * ⚡ Dedicated Multi-Link Cloudflare Scraper Panel (With pCloud Rename Assistant)
 * 💖 Premium Creamy Light & Dark Design System
 * 💖 Made with love by pavnxet (https://pavnxet.github.io/)
 * 🔐 Minimal password auth + 2-minute guest preview
 */

const AUTH_COOKIE = "ff_auth";
const GUEST_COOKIE = "ff_guest";
const AUTH_MAX_AGE = 60 * 60 * 24;
const GUEST_MAX_AGE = 60 * 2;
const encoder = new TextEncoder();

function timingSafeEqual(a, b) {
  const aBytes = encoder.encode(String(a));
  const bBytes = encoder.encode(String(b));
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

function base64Url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function signToken(secret, type, issuedAt) {
  const payload = `${type}.${issuedAt}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${base64Url(signature)}`;
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function verifyToken(request, env, cookieName, tokenType, maxAge) {
  if (!env.AUTH_PASSWORD) return false;
  const token = getCookie(request, cookieName);
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== tokenType) return false;

  const issuedAt = Number(parts[1]);
  if (!Number.isFinite(issuedAt)) return false;

  const now = Date.now();
  if (issuedAt > now + 60_000) return false;
  if (now - issuedAt > maxAge * 1000) return false;

  const expected = await signToken(env.AUTH_PASSWORD, tokenType, issuedAt);
  return timingSafeEqual(token, expected);
}

async function isAuthenticated(request, env) {
  return verifyToken(request, env, AUTH_COOKIE, "auth", AUTH_MAX_AGE);
}

async function isGuest(request, env) {
  return verifyToken(request, env, GUEST_COOKIE, "guest", GUEST_MAX_AGE);
}

function cookieHeader(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

function clearCookie(name) {
  return `${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

function securityHeaders(type = "text/html; charset=utf-8") {
  return {
    "Content-Type": type,
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer"
  };
}

function loginPage(message = "") {
  const safeMessage = String(message)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Private Scraper — Login</title>
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen flex items-center justify-center bg-stone-100 p-6">
  <div class="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl border border-stone-200">
    <div class="text-3xl mb-2">🔐</div>
    <h1 class="text-2xl font-bold text-stone-900">Private Scraper</h1>
    <p class="text-sm text-stone-500 mt-2 mb-6">Enter the access password to unlock the full scraper.</p>
    ${safeMessage ? `<div class="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">${safeMessage}</div>` : ""}
    <form method="POST" action="/login" class="space-y-4">
      <input name="password" type="password" autocomplete="current-password" required autofocus class="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-orange-600" placeholder="Password">
      <button class="w-full rounded-xl bg-orange-700 py-3 font-semibold text-white hover:opacity-90">Unlock</button>
    </form>
    <a href="/" class="block text-center mt-4 text-sm text-stone-500 hover:text-stone-900">← Back to guest preview</a>
  </div>
</body>
</html>`, { status: 401, headers: securityHeaders() });
}

function unauthorizedJson() {
  return new Response(JSON.stringify({
    success: false,
    error: "Authentication required. Guest preview cannot scrape."
  }), {
    status: 401,
    headers: securityHeaders("application/json")
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!env.AUTH_PASSWORD) {
      return new Response("Server authentication is not configured. Set the AUTH_PASSWORD Worker secret.", {
        status: 500,
        headers: securityHeaders("text/plain; charset=utf-8")
      });
    }

    // Authentication
    if (url.pathname === "/login" && request.method === "GET") {
      return loginPage();
    }

    if (url.pathname === "/login" && request.method === "POST") {
      try {
        const formData = await request.formData();
        const suppliedPassword = String(formData.get("password") || "");

        if (!timingSafeEqual(suppliedPassword, env.AUTH_PASSWORD)) {
          return loginPage("Invalid password.");
        }

        const token = await signToken(env.AUTH_PASSWORD, "auth", Date.now());
        return new Response(null, {
          status: 303,
          headers: {
            "Location": "/",
            "Set-Cookie": cookieHeader(AUTH_COOKIE, token, AUTH_MAX_AGE),
            "Cache-Control": "no-store"
          }
        });
      } catch {
        return loginPage("Unable to process login request.");
      }
    }

    if (url.pathname === "/logout") {
      return new Response(null, {
        status: 303,
        headers: {
          "Location": "/",
          "Set-Cookie": clearCookie(AUTH_COOKIE),
          "Cache-Control": "no-store"
        }
      });
    }

    if (url.pathname === "/guest-exit") {
      return new Response(null, {
        status: 303,
        headers: {
          "Location": "/login",
          "Set-Cookie": clearCookie(GUEST_COOKIE),
          "Cache-Control": "no-store"
        }
      });
    }

    // The API is always protected. Guest preview never gets scraper access.
    if (request.method === "POST" && url.pathname === "/scrape") {
      if (!(await isAuthenticated(request, env))) return unauthorizedJson();

      try {
        const formData = await request.formData();
        const urlsInput = formData.get("urls");

        if (!urlsInput) {
          return new Response(JSON.stringify({ success: false, error: "No URLs provided!" }), {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "X-Powered-By": "pavnxet-scraper"
            }
          });
        }

        const urls = urlsInput
          .split("\n")
          .map(link => link.trim())
          .filter(link => link.length > 0);

        if (urls.length === 0) {
          return new Response(JSON.stringify({ success: false, error: "No valid URLs found." }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
          });
        }

        if (urls.length > 30) {
          return new Response(JSON.stringify({ success: false, error: "Rate limit exceeded: Maximum 30 URLs allowed per batch." }), {
            status: 429,
            headers: { "Content-Type": "application/json" }
          });
        }

        const fetchPromises = urls.map(async (targetUrl) => {
          if (!targetUrl.startsWith("https://")) {
            return { type: 'error', msg: `❌ Rejected (Insecure Protocol): ${targetUrl}` };
          }

          let parsedUrl;
          try {
            parsedUrl = new URL(targetUrl);
          } catch {
            return { type: 'error', msg: `❌ Rejected (Invalid URL): ${targetUrl}` };
          }

          const hostname = parsedUrl.hostname.toLowerCase();
          if (hostname !== "fuckingfast.co" && !hostname.endsWith(".fuckingfast.co")) {
            return { type: 'error', msg: `❌ Rejected (Unsupported Domain): ${targetUrl}` };
          }

          try {
            // 🔥 URL से # (Hash/Fragment) को पूरी तरह हटाना
            const cleanUrl = targetUrl.split('#')[0];

            // Anti-Bot Advanced Bypassing Headers
            const antiBotHeaders = {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9,hi;q=0.8",
              "Cache-Control": "no-cache",
              "Pragma": "no-cache",
              "Referer": "https://fuckingfast.co/",
              "Sec-Ch-Ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
              "Sec-Ch-Ua-Mobile": "?0",
              "Sec-Ch-Ua-Platform": '"Windows"',
              "Sec-Fetch-Dest": "document",
              "Sec-Fetch-Mode": "navigate",
              "Sec-Fetch-Site": "same-origin",
              "Sec-Fetch-User": "?1",
              "Upgrade-Insecure-Requests": "1"
            };

            const response = await fetch(cleanUrl, {
              headers: antiBotHeaders,
              redirect: "follow",
              cf: {
                cacheEverything: false,
                scrapeShield: false,
                minify: { javascript: false, css: false, html: false }
              }
            });

            if (response.status === 200) {
              const pageSource = await response.text();
              let directLink = null;

              const match = pageSource.match(/window\.open\("(https:\/\/dl\.fuckingfast\.co\/dl\/[^\"]+)"\)/);
              if (match && match[1]) directLink = match[1];

              if (!directLink) {
                const backupMatch = pageSource.match(/(https:\/\/dl\.fuckingfast\.co\/dl\/[^\s"'\>]+)/);
                if (backupMatch && backupMatch[1]) directLink = backupMatch[1];
              }

              if (directLink) {
                return { type: 'success', msg: directLink.replace(/[\s"'\>]+/g, '') };
              }

              return { type: 'error', msg: `⚠️ Direct link signature not found: ${targetUrl}` };
            }

            return { type: 'error', msg: `❌ HTTP Error ${response.status}: ${targetUrl}` };
          } catch (e) {
            return { type: 'error', msg: `❌ Network failure: ${e.message}` };
          }
        });

        const results = await Promise.all(fetchPromises);
        const successLinks = results.filter(r => r.type === 'success').map(r => r.msg);
        const errorLinks = results.filter(r => r.type === 'error').map(r => r.msg);

        return new Response(JSON.stringify({ success: true, successLinks, errorLinks }), {
          headers: {
            "Content-Type": "application/json",
            "X-Data-Source": "pavnxet-engine",
            "Cache-Control": "no-store"
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: "Internal Server Error" }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
        });
      }
    }

    // Guest preview or authenticated dashboard.
    const authenticated = await isAuthenticated(request, env);
    let guest = false;
    let setGuestCookie = null;

    if (!authenticated) {
      guest = await isGuest(request, env);

      if (!guest) {
        if (getCookie(request, GUEST_COOKIE)) {
          return loginPage("Your 2-minute guest preview has expired.");
        }

        const token = await signToken(env.AUTH_PASSWORD, "guest", Date.now());
        guest = true;
        setGuestCookie = cookieHeader(GUEST_COOKIE, token, GUEST_MAX_AGE);
      }
    }

    const htmlUI = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>FuckingFast Worker Scraper Dashboard</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
            :root {
                --bg-primary: #faf6f0;
                --bg-surface: #ffffff;
                --bg-inner: #f6efe5;
                --bg-active: #f3ebe0;
                --ink: #1e1a15;
                --ink-muted: #6e655a;
                --border-color: #e8ded0;
                --accent: #b55d2b;
                --success-ink: #1e4620;
                --success-bg: #edf7ed;
                --error-ink: #5f2120;
                --error-bg: #fdeded;
                --shadow-premium: 0 10px 30px -10px rgba(30, 26, 21, 0.05), 0 1px 3px rgba(30, 26, 21, 0.02);
            }

            body.dark-theme {
                --bg-primary: #121212;
                --bg-surface: #1e1e1e;
                --bg-inner: #2a2a2a;
                --bg-active: #333333;
                --ink: #e8e6e3;
                --ink-muted: #9e9a95;
                --border-color: #383838;
                --accent: #d97b45;
                --success-ink: #81c784;
                --success-bg: #1b3320;
                --error-ink: #e57373;
                --error-bg: #401919;
                --shadow-premium: 0 10px 30px -10px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.3);
            }

            body {
                background-color: var(--bg-primary);
                color: var(--ink);
                font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                min-height: 100vh;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                transition: background-color 0.3s, color 0.3s;
            }

            .premium-card {
                background-color: var(--bg-surface);
                border: 1px solid var(--border-color);
                box-shadow: var(--shadow-premium);
                transition: background-color 0.3s, border-color 0.3s, box-shadow 0.3s;
            }

            .inner-input {
                background-color: var(--bg-inner);
                border: 1px solid var(--border-color);
                color: var(--ink);
            }

            .inner-input:focus {
                border-color: var(--accent);
                box-shadow: 0 0 0 3px rgba(181, 93, 43, 0.15);
            }

            .btn-accent {
                background-color: var(--accent);
                color: #ffffff;
                transition: all 0.2s ease-in-out;
            }

            .btn-accent:hover { opacity: 0.9; transform: translateY(-1px); }
            .btn-accent:active { opacity: 1; transform: translateY(0); }

            .btn-secondary {
                background-color: var(--bg-inner);
                border: 1px solid var(--border-color);
                color: var(--ink);
                transition: all 0.2s;
            }
            .btn-secondary:hover { background-color: var(--bg-active); }

            .terminal-success {
                background-color: var(--success-bg);
                border: 1px solid rgba(30, 70, 32, 0.12);
                color: var(--success-ink);
            }

            .terminal-error {
                background-color: var(--error-bg);
                border: 1px solid rgba(95, 33, 32, 0.12);
                color: var(--error-ink);
            }

            footer a { color: var(--ink-muted); transition: color 0.2s ease; }
            footer a:hover { color: var(--accent); }

            #progressContainer {
                background-color: var(--bg-inner);
                overflow: hidden;
            }
            #progressBar {
                background-color: var(--accent);
                transition: width 0.4s ease;
            }

            .guest-banner {
                background-color: var(--bg-inner);
                border: 1px solid var(--border-color);
                color: var(--ink-muted);
            }

            .guest-timer {
                color: var(--accent);
                font-weight: 800;
                font-variant-numeric: tabular-nums;
            }
        </style>
    </head>
    <body class="p-6 flex flex-col items-center justify-between min-h-screen">
        <div class="w-full max-w-3xl p-8 rounded-2xl premium-card mt-8">
            <div class="flex items-center justify-between mb-2">
                <div class="flex items-center space-x-3">
                    <h1 class="text-3xl font-extrabold tracking-tight" style="color: var(--ink);">
                        ⚡ FuckingFast Scraper
                    </h1>
                    <span class="px-2 py-0.5 text-[10px] font-bold rounded border" style="background-color: var(--bg-inner); border-color: var(--border-color); color: var(--accent);">V3.5-RENAME</span>
                </div>
                <div class="flex items-center gap-2">
                    <a href="${authenticated ? '/logout' : '/login'}" class="p-2 rounded-lg btn-secondary text-sm font-bold" title="${authenticated ? 'Log out' : 'Login'}">
                        ${authenticated ? '🚪' : '🔐'}
                    </a>
                    <button onclick="toggleTheme()" class="p-2 rounded-lg btn-secondary text-sm font-bold" title="Toggle Theme">
                        🌓
                    </button>
                </div>
            </div>

            ${guest ? `
            <div class="guest-banner rounded-xl px-4 py-3 mb-5 text-sm flex items-center gap-2">
                <span>👀</span>
                <span><strong style="color: var(--ink);">Guest preview</strong> — read-only for <span id="guestTimer" class="guest-timer">02:00</span>. Scraping unlocks after login.</span>
                <a href="/login" class="ml-auto font-semibold underline" style="color: var(--accent);">Unlock</a>
            </div>` : `
            <div class="guest-banner rounded-xl px-4 py-3 mb-5 text-sm">
                🔓 <strong style="color: var(--ink);">Authenticated</strong> — full scraper access enabled.
            </div>`}

            <p class="text-sm mb-6" style="color: var(--ink-muted);">Paste your batch links from FuckingFast.co. High-speed extraction with sequential pCloud mapping helper.</p>

            <form id="scraperForm" class="space-y-4">
                <div>
                    <div class="flex justify-between items-end mb-2">
                        <label class="block text-sm font-semibold" style="color: var(--ink);">Input URLs (One per line):</label>
                        <button type="button" onclick="pasteClipboard()" class="text-xs px-2 py-1 rounded btn-secondary font-semibold">
                            📋 Paste
                        </button>
                    </div>
                    <textarea
                        name="urls"
                        id="urls"
                        rows="7"
                        class="w-full p-4 rounded-xl text-sm focus:outline-none inner-input font-mono"
                        placeholder="https://fuckingfast.co/..."
                        ${guest ? 'readonly' : ''}
                        required></textarea>
                </div>

                <button
                    type="submit"
                    id="submitBtn"
                    class="w-full py-3.5 px-4 rounded-xl font-semibold shadow-sm btn-accent relative overflow-hidden">
                    <span>${guest ? '🔐 Login to Launch Scraper' : '🚀 Launch Parallel Scraper'}</span>
                </button>

                <div id="progressContainer" class="w-full h-2 rounded-full hidden mt-2">
                    <div id="progressBar" class="h-full w-0"></div>
                </div>
            </form>
        </div>

        <div id="outputContainer" class="w-full max-w-3xl space-y-4 mt-6 hidden">
            <div id="successBox" class="p-6 rounded-2xl premium-card border-l-4 hidden" style="border-left-color: var(--accent);">
                <div class="flex justify-between items-center mb-3">
                    <h2 class="text-base font-bold flex items-center" style="color: var(--ink);">
                        ✅ Pure Direct Links (<span id="successCount">0</span>)
                    </h2>
                    <div class="space-x-2">
                        <button onclick="copyLinks('resultBox')" class="px-3 py-1 text-xs font-semibold rounded-lg btn-secondary">
                            📋 Copy Links
                        </button>
                    </div>
                </div>
                <textarea id="resultBox" rows="5" class="w-full p-4 rounded-xl text-xs font-mono focus:outline-none terminal-success" readonly></textarea>

                <div class="mt-5 pt-4 border-t border-dashed" style="border-color: var(--border-color);">
                    <div class="flex justify-between items-center mb-3">
                        <h3 class="text-xs font-bold tracking-wider uppercase opacity-80" style="color: var(--ink);">
                            📦 pCloud Rename Map Assistant (Sequence Order)
                        </h3>
                        <button onclick="copyLinks('renameMapBox')" class="px-2 py-0.5 text-[11px] font-semibold rounded btn-secondary">
                            📋 Copy Rename Map
                        </button>
                    </div>
                    <textarea id="renameMapBox" rows="5" class="w-full p-4 rounded-xl text-xs font-mono focus:outline-none terminal-success bg-opacity-40" placeholder="Mapping list will generate here..." readonly></textarea>
                </div>
            </div>

            <div id="errorBox" class="p-6 rounded-2xl premium-card border-l-4 hidden" style="border-left-color: #d32f2f;">
                <h2 class="text-base font-bold mb-3 flex items-center" style="color: #d32f2f;">
                    ⚠️ Failed Signatures (<span id="errorCount">0</span>)
                </h2>
                <textarea id="errResultBox" rows="4" class="w-full p-4 rounded-xl text-xs font-mono focus:outline-none terminal-error" readonly></textarea>
            </div>
        </div>

        <footer class="mt-12 mb-6 text-sm">
            <a href="https://pavnxet.github.io/" target="_blank" rel="noopener noreferrer" class="flex items-center space-x-1">
                <span>Made with 💖 by</span>
                <span class="font-bold underline tracking-wide" style="color: var(--accent);">pavnxet</span>
            </a>
        </footer>

        <script>
            const IS_GUEST = ${guest ? 'true' : 'false'};

            function toggleTheme() {
                document.body.classList.toggle('dark-theme');
            }

            async function pasteClipboard() {
                if (IS_GUEST) {
                    alert('🔐 Guest preview is read-only. Login to use the scraper.');
                    return;
                }

                try {
                    const text = await navigator.clipboard.readText();
                    document.getElementById('urls').value = text;
                } catch (err) {
                    alert('❌ Clipboard access denied. Please paste manually.');
                }
            }

            function copyLinks(boxId) {
                const box = document.getElementById(boxId);
                box.select();
                document.execCommand('copy');
                alert('📋 Copied securely to system clipboard!');
            }

            if (IS_GUEST) {
                let remaining = ${GUEST_MAX_AGE};
                const timer = document.getElementById('guestTimer');

                const interval = setInterval(() => {
                    remaining--;
                    if (remaining <= 0) {
                        clearInterval(interval);
                        window.location.href = '/login';
                        return;
                    }

                    const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
                    const seconds = String(remaining % 60).padStart(2, '0');
                    timer.textContent = minutes + ':' + seconds;
                }, 1000);
            }

            document.getElementById('scraperForm').addEventListener('submit', async (e) => {
                e.preventDefault();

                if (IS_GUEST) {
                    window.location.href = '/login';
                    return;
                }

                const submitBtn = document.getElementById('submitBtn');
                const outputContainer = document.getElementById('outputContainer');
                const successBox = document.getElementById('successBox');
                const errorBox = document.getElementById('errorBox');
                const progressContainer = document.getElementById('progressContainer');
                const progressBar = document.getElementById('progressBar');

                submitBtn.disabled = true;
                submitBtn.querySelector('span').textContent = "⏳ Sorting Sequences Parallelly...";

                outputContainer.classList.add('hidden');
                successBox.classList.add('hidden');
                errorBox.classList.add('hidden');

                progressContainer.classList.remove('hidden');
                progressBar.style.width = '10%';

                let progressInterval = setInterval(() => {
                    let currentWidth = parseInt(progressBar.style.width);
                    if (currentWidth < 90) {
                        progressBar.style.width = (currentWidth + 5) + '%';
                    }
                }, 400);

                try {
                    const res = await fetch('/scrape', {
                        method: 'POST',
                        body: new FormData(e.target)
                    });

                    clearInterval(progressInterval);
                    progressBar.style.width = '100%';

                    if (res.status === 401) {
                        window.location.href = '/login';
                        return;
                    }

                    if (res.status === 500) {
                        alert("❌ Server Runtime Error triggered.");
                        return;
                    }

                    const data = await res.json();

                    setTimeout(() => {
                        progressContainer.classList.add('hidden');
                        progressBar.style.width = '0%';

                        if (data.success) {
                            outputContainer.classList.remove('hidden');

                            if (data.successLinks.length > 0) {
                                successBox.classList.remove('hidden');
                                document.getElementById('successCount').innerText = data.successLinks.length;
                                document.getElementById('resultBox').value = data.successLinks.join('\\n');

                                const mappingLines = data.successLinks.map((link, index) => {
                                    const partNum = String(index + 1).padStart(2, '0');
                                    const fileHash = link.substring(link.lastIndexOf('/') + 1);
                                    return "Part_" + partNum + "  ==>  " + fileHash;
                                });
                                document.getElementById('renameMapBox').value = mappingLines.join('\\n');
                            }

                            if (data.errorLinks.length > 0) {
                                errorBox.classList.remove('hidden');
                                document.getElementById('errorCount').innerText = data.errorLinks.length;
                                document.getElementById('errResultBox').value = data.errorLinks.join('\\n');
                            }
                        } else {
                            alert("❌ Halted: " + data.error);
                        }
                    }, 400);

                } catch (err) {
                    clearInterval(progressInterval);
                    progressContainer.classList.add('hidden');
                    progressBar.style.width = '0%';
                    alert("❌ Exception: " + err.message);
                } finally {
                    submitBtn.disabled = false;
                    submitBtn.querySelector('span').innerText = IS_GUEST ? "🔐 Login to Launch Scraper" : "🚀 Launch Parallel Scraper";
                }
            });
        </script>
    </body>
    </html>
    `;

    const headers = securityHeaders();
    if (setGuestCookie) headers["Set-Cookie"] = setGuestCookie;

    return new Response(htmlUI, { headers });
  }
};
