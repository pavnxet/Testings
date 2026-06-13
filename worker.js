/**
 * ⚡ Intelligent Multi-Domain Cloudflare Scraper Panel
 * 💖 Made with love by pavnxet (https://pavnxet.github.io/)
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. POST Request Handling: Secure Core Scraping Logic
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

        // Sanitizing and parsing inputs safely
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

        // Security Enforcement: Limit batch size to prevent server abuse/DoS
        if (urls.length > 30) {
          return new Response(JSON.stringify({ success: false, error: "Rate limit exceeded: Maximum 30 URLs allowed per batch." }), {
            status: 429,
            headers: { "Content-Type": "application/json" }
          });
        }

        const successLinks = [];
        const errorLinks = [];
        
        // Security Feature: Strict rotated browser emulation headers
        const headers = {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache"
        };

        for (const targetUrl of urls) {
          try {
            // Security Verification: URL protocol strict checking
            if (!targetUrl.startsWith("https://")) {
              errorLinks.push(`❌ Rejected (Insecure Protocol): ${targetUrl}`);
              continue;
            }

            const response = await fetch(targetUrl, { 
              headers: headers,
              redirect: "follow" 
            });
            
            if (response.status === 200) {
              const pageSource = await response.text();
              let directLink = null;

              // Intelligent Routing Mechanism
              if (targetUrl.includes("fuckingfast.co")) {
                const match = pageSource.match(/window\.open\("(https:\/\/dl\.fuckingfast\.co\/dl\/[^"]+)"\)/);
                if (match && match[1]) directLink = match[1];
                
                if (!directLink) {
                  const backupMatch = pageSource.match(/(https:\/\/dl\.fuckingfast\.co\/dl\/[^\s"'\>]+)/);
                  if (backupMatch && backupMatch[1]) directLink = backupMatch[1];
                }

              } else if (targetUrl.includes("datanodes.to")) {
                const dataNodesMatch = pageSource.match(/(https:\/\/[^\s"'\>]+datanodes\.to\/cgi-bin\/dl\.cgi\/[^\s"'\>]+)/) 
                                    || pageSource.match(/href=["'](https:\/\/.*?datanodes\.to\/d\/.*?)["']/);
                if (dataNodesMatch && dataNodesMatch[1]) directLink = dataNodesMatch[1];
              }

              if (directLink) {
                // Security Mitigation: Sanitizing output links from unwanted trailing code blocks
                successLinks.push(directLink.replace(/[\s"'\>]+/g, ''));
              } else {
                errorLinks.push(`⚠️ Direct link signature not found: ${targetUrl}`);
              }

            } else {
              errorLinks.push(`❌ HTTP Error ${response.status}: ${targetUrl}`);
            }
          } catch (e) {
            errorLinks.push(`❌ Network failure: ${e.message}`);
          }
        }

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

    // 2. GET Request Handling: Secure & Refined Glassmorphic UI Dashboard
    const htmlUI = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Intelligent Worker Scraper Dashboard</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
            body {
                background: linear-gradient(135deg, #090d16 0%, #111026 100%);
                min-height: 100vh;
            }
            .glass-panel {
                background: rgba(255, 255, 255, 0.02);
                backdrop-filter: blur(14px);
                -webkit-backdrop-filter: blur(14px);
                border: 1px solid rgba(255, 255, 255, 0.06);
            }
        </style>
    </head>
    <body class="p-6 text-gray-100 flex flex-col items-center justify-between min-h-screen">
        <div class="w-full max-w-3xl p-8 rounded-2xl glass-panel shadow-2xl mt-8">
            <div class="flex items-center justify-between mb-2">
                <div class="flex items-center space-x-3">
                    <h1 class="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-teal-400 to-blue-500">
                        ⚡ Instant Worker Scraper
                    </h1>
                    <span class="px-2 py-0.5 text-[10px] font-bold bg-cyan-500/20 text-cyan-300 rounded border border-cyan-500/30">V2.5-SECURE</span>
                </div>
            </div>
            <p class="text-sm text-gray-400 mb-6">Paste batch links from FuckingFast or DataNodes. The scraper parses and detects sources intelligently directly on the edge server.</p>
            
            <form id="scraperForm" class="space-y-4">
                <div>
                    <label class="block text-sm font-medium text-gray-300 mb-2">Input Batch URLs (One URL per line):</label>
                    <textarea 
                        name="urls" 
                        id="urls" 
                        rows="7" 
                        class="w-full p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-sm focus:ring-2 focus:ring-cyan-500 focus:outline-none placeholder-gray-600 font-mono text-cyan-100"
                        placeholder="https://fuckingfast.co/...\nhttps://datanodes.to/..."
                        required></textarea>
                </div>
                
                <button 
                    type="submit" 
                    id="submitBtn"
                    class="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 via-teal-500 to-blue-600 font-semibold hover:opacity-95 active:scale-[0.99] transition duration-200 shadow-lg shadow-cyan-500/10">
                    🚀 Launch Smart Scraper
                </button>
            </form>
        </div>

        <div id="outputContainer" class="w-full max-w-3xl space-y-4 mt-6 hidden">
            <div id="successBox" class="p-6 rounded-2xl glass-panel shadow-2xl border-l-4 border-green-500/50 hidden">
                <div class="flex justify-between items-center mb-3">
                    <h2 class="text-base font-bold text-green-400 flex items-center">
                        ✅ Direct Extraction Output (<span id="successCount">0</span>)
                    </h2>
                    <button onclick="copyLinks('resultBox')" class="px-3 py-1 text-xs font-semibold bg-slate-900 border border-slate-800 rounded-lg hover:bg-slate-800 text-gray-300 transition">
                        📋 Copy All
                    </button>
                </div>
                <textarea id="resultBox" rows="6" class="w-full p-4 rounded-xl bg-black/30 border border-slate-900 text-xs font-mono text-emerald-400 focus:outline-none" readonly></textarea>
            </div>

            <div id="errorBox" class="p-6 rounded-2xl glass-panel shadow-2xl border-l-4 border-red-500/50 hidden">
                <h2 class="text-base font-bold text-red-400 mb-3 flex items-center">
                    ⚠️ Failed / Insecure Signatures (<span id="errorCount">0</span>)
                </h2>
                <textarea id="errResultBox" rows="4" class="w-full p-4 rounded-xl bg-black/30 border border-slate-900 text-xs font-mono text-rose-400 focus:outline-none" readonly></textarea>
            </div>
        </div>

        <footer class="mt-12 mb-6 text-sm text-gray-500 hover:text-cyan-400 transition duration-300">
            <a href="https://pavnxet.github.io/" target="_blank" rel="noopener noreferrer" class="flex items-center space-x-1">
                <span>Made with 💖 by</span>
                <span class="font-bold underline tracking-wide bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-teal-400">pavnxet</span>
            </a>
        </footer>

        <script>
            document.getElementById('scraperForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const submitBtn = document.getElementById('submitBtn');
                const outputContainer = document.getElementById('outputContainer');
                const successBox = document.getElementById('successBox');
                const errorBox = document.getElementById('errorBox');
                
                submitBtn.disabled = true;
                submitBtn.innerHTML = \`<span class="inline-block animate-spin mr-2">⏳</span> Edge Engines Executing Protocols...\`;
                outputContainer.classList.add('hidden');
                successBox.classList.add('hidden');
                errorBox.classList.add('hidden');

                try {
                    const res = await fetch('/scrape', {
                        method: 'POST',
                        body: new FormData(e.target)
                    });
                    
                    // Error protection if server fails completely
                    if(res.status === 500) {
                        alert("❌ Security Block or Internal Runtime Error triggered on the Cloudflare Environment.");
                        return;
                    }
                    
                    const data = await res.json();

                    if (data.success) {
                        outputContainer.classList.remove('hidden');
                        
                        if (data.successLinks.length > 0) {
                            successBox.classList.remove('hidden');
                            document.getElementById('successCount').innerText = data.successLinks.length;
                            document.getElementById('resultBox').value = data.successLinks.join('\\n');
                        }
                        
                        if (data.errorLinks.length > 0) {
                            errorBox.classList.remove('hidden');
                            document.getElementById('errorCount').innerText = data.errorLinks.length;
                            document.getElementById('errResultBox').value = data.errorLinks.join('\\n');
                        }
                    } else {
                        alert("❌ Execution Halted: " + data.error);
                    }
                } catch (err) {
                    alert("❌ Application Exception: " + err.message);
                } finally {
                    submitBtn.disabled = false;
                    submitBtn.innerText = "🚀 Launch Smart Scraper";
                }
            });

            function copyLinks(boxId) {
                const box = document.getElementById(boxId);
                box.select();
                document.execCommand('copy');
                alert('📋 Copied securely to system clipboard!');
            }
        </script>
    </body>
    </html>
    `;

    return new Response(htmlUI, {
      headers: { 
        "Content-Type": "text/html; charset=utf-8",
        // Security Feature: Basic security headers implemented via edge injection
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "X-XSS-Protection": "1; mode=block"
      }
    });
  }
};
