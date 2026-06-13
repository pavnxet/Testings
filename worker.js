/**
 * ⚡ Dedicated Multi-Link Cloudflare Scraper Panel (With pCloud Rename Assistant)
 * 💖 Premium Creamy Light & Dark Design System
 * 💖 Made with love by pavnxet (https://pavnxet.github.io/)
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. POST Request Handling: High-Speed Parallel Scraping Logic
    if (request.method === "POST" && url.pathname === "/scrape") {
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

        const headers = {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache"
        };

        // 🚀 Parallel Processing preserves array order perfectly
        const fetchPromises = urls.map(async (targetUrl) => {
          if (!targetUrl.startsWith("https://")) {
            return { type: 'error', msg: `❌ Rejected (Insecure Protocol): ${targetUrl}` };
          }

          if (!targetUrl.includes("fuckingfast.co")) {
            return { type: 'error', msg: `❌ Rejected (Unsupported Domain): ${targetUrl}` };
          }

          try {
            const response = await fetch(targetUrl, { 
              headers: headers,
              redirect: "follow" 
            });
            
            if (response.status === 200) {
              const pageSource = await response.text();
              let directLink = null;

              const match = pageSource.match(/window\.open\("(https:\/\/dl\.fuckingfast\.co\/dl\/[^"]+)"\)/);
              if (match && match[1]) directLink = match[1];
              
              if (!directLink) {
                const backupMatch = pageSource.match(/(https:\/\/dl\.fuckingfast\.co\/dl\/[^\s"'\>]+)/);
                if (backupMatch && backupMatch[1]) directLink = backupMatch[1];
              }

              if (directLink) {
                return { type: 'success', msg: directLink.replace(/[\s"'\>]+/g, '') };
              } else {
                return { type: 'error', msg: `⚠️ Direct link signature not found: ${targetUrl}` };
              }
            } else {
              return { type: 'error', msg: `❌ HTTP Error ${response.status}: ${targetUrl}` };
            }
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
            "X-Data-Source": "pavnxet-engine"
          }
        });

      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: "Internal Server Error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // 2. GET Request Handling: Premium UI Dashboard
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
                <button onclick="toggleTheme()" class="p-2 rounded-lg btn-secondary text-sm font-bold" title="Toggle Theme">
                    🌓
                </button>
            </div>
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
                        required></textarea>
                </div>
                
                <button 
                    type="submit" 
                    id="submitBtn"
                    class="w-full py-3.5 px-4 rounded-xl font-semibold shadow-sm btn-accent relative overflow-hidden">
                    <span>🚀 Launch Parallel Scraper</span>
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
            function toggleTheme() {
                document.body.classList.toggle('dark-theme');
            }

            async function pasteClipboard() {
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

            document.getElementById('scraperForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const submitBtn = document.getElementById('submitBtn');
                const outputContainer = document.getElementById('outputContainer');
                const successBox = document.getElementById('successBox');
                const errorBox = document.getElementById('errorBox');
                const progressContainer = document.getElementById('progressContainer');
                const progressBar = document.getElementById('progressBar');
                
                submitBtn.disabled = true;
                submitBtn.querySelector('span').innerHTML = \`⏳ Sorting Sequences Parallelly...\`;
                
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
                    
                    if(res.status === 500) {
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
                                
                                // Set Raw Links
                                document.getElementById('resultBox').value = data.successLinks.join('\\n');
                                
                                // ✨ Process and build the pCloud Renaming Assistant Text
                                const mappingLines = data.successLinks.map((link, index) => {
                                    const partNum = String(index + 1).padStart(2, '0');
                                    // Extract the random hash file name from URL structure
                                    const fileHash = link.substring(link.lastIndexOf('/') + 1);
                                    return \`Part_\${partNum}  ==>  \${fileHash}\`;
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
                    submitBtn.querySelector('span').innerText = "🚀 Launch Parallel Scraper";
                }
            });
        </script>
    </body>
    </html>
    `;

    return new Response(htmlUI, {
      headers: { 
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "X-XSS-Protection": "1; mode=block"
      }
    });
  }
};
