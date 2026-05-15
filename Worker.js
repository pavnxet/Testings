/**
 * Cloudflare Workers — Quiz Generator + Telegram Bot + Turso DB + GitHub Store + AI Normalizer [v5]
 * ─────────────────────────────────────────────────────────────────────────────
 * Web interface:  GET  /          → upload UI  (multi-file merge)
 *                 POST /generate  → returns self-contained HTML quiz
 *                 GET  /dbstats   → JSON aggregate stats from Turso
 * Telegram bot:   POST /telegram  → webhook receiver
 *                 /mystats        → personal quiz stats
 *                 /globalstats    → total platform stats
 * One-time setup: GET  /setup     → registers Telegram webhook
 *                 GET  /initdb    → creates Turso tables (run once)
 *
 * Environment variables  (Cloudflare → Worker → Settings → Variables):
 *   TELEGRAM_TOKEN    e.g.  123456:ABC-DEF...
 *   TURSO_DB_URL      e.g.  https://mydb-myorg.turso.io
 *   TURSO_AUTH_TOKEN  Turso database auth token
 *   GITHUB_TOKEN      GitHub personal access token (repo scope)
 *                     (also accepted: GITHUB_PERSONAL_ACCESS_TOKEN)
 *   GITHUB_REPO       e.g.  yourname/quiz-questions
 *   GITHUB_BRANCH     branch to commit to (default: main)
 *
 * v5.0 SECURITY HARDENING:
 * S1. Security headers on every response (CSP, X-Frame-Options, nosniff, etc.)
 * S2. Telegram webhook signature verification (X-Telegram-Bot-Api-Secret-Token)
 * S3. setupWebhook registers secret_token with Telegram (TELEGRAM_WEBHOOK_SECRET)
 * S4. /setup + /initdb gated behind ADMIN_SECRET query param or header
 * S5. POST /generate: 10 MB file-size guard (Content-Length check)
 * S6. 500-question cap per upload (web + Telegram)
 * S7. Title length capped at 200 chars
 *     New optional env vars: TELEGRAM_WEBHOOK_SECRET, ADMIN_SECRET
 *
 * v4.0 ADDITIONS:
 * 14. AI topic normalization via OpenRouter (openai/gpt-oss-120b:free)
 *     — extractUniquePairs, allPairsMatch (zero-latency bypass), aiNormalizePairs
 *     — dictionary-keyed response prevents array alignment bugs
 *     — Telegram: in-place progress messages via editMessageText
 *     — Web: animated progress bar in upload page UI
 *     OPENROUTER_API_KEY env var required.
 *
 * FIXES applied vs original:
 *  1. generateHtml() — questions JSON now embedded via a
 *     <script type="application/json" id="q-data"> data island so
 *     </script> inside question text can never break the page.
 *  2. titleJs JSON string used for the JS _TITLE constant (not
 *     HTML-escaped titleSafe) so & doesn't appear as &amp; in JS.
 *  3. Turso pipeline errors now log the full response body.
 *  4. trackGeneration() combines both DB writes into one pipeline call.
 *  5. tgApi() wrapped in try/catch so network errors don't crash the worker.
 *  6. tgSendDocument() caption truncated to 1024 chars (Telegram limit).
 *  7. Content-Disposition filename encoded with RFC 5987 (encodeURIComponent).
 *  8. handleDbStats() returns 503 (not 200) when DB is unconfigured/empty.
 *  9. Channel-post messages (no `from` field) handled safely.
 * 10. ghToken() helper resolves either GITHUB_TOKEN or GITHUB_PERSONAL_ACCESS_TOKEN.
 * 11. /api/browse returns 503 when GitHub not configured, so the upload
 *     page hides the question-bank card cleanly.
 * 12. All dynamic nav onclick handlers moved to named functions called from
 *     addEventListener so they are never broken by CSP or parse failures.
 * 13. Quiz HTML script block uses a single DOMContentLoaded entry-point so
 *     all functions are defined before any button can call them.
 */

// ════════════════════════════════════════════════════════════
//  TURSO DB  (libSQL HTTP API — no npm required)
// ════════════════════════════════════════════════════════════
function hasDb(env) {
  return !!(env.TURSO_DB_URL && env.TURSO_AUTH_TOKEN);
}

async function dbExec(env, statements) {
  if (!hasDb(env)) return null;
  const requests = statements.map((s) => ({
    type: "execute",
    stmt: {
      sql: s.sql,
      args: (s.args || []).map((v) =>
        v === null || v === undefined
          ? { type: "null" }
          : typeof v === "number"
            ? { type: "integer", value: String(Math.trunc(v)) }
            : { type: "text", value: String(v) },
      ),
    },
  }));
  requests.push({ type: "close" });
  const dbHttpUrl = env.TURSO_DB_URL.replace(/^libsql:\/\//, "https://");
  try {
    const r = await fetch(`${dbHttpUrl}/v2/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.TURSO_AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requests }),
    });
    if (!r.ok) {
      const errBody = await r.text().catch(() => "(unreadable)");
      console.error("Turso HTTP error", r.status, errBody);
      return null;
    }
    return r.json();
  } catch (e) {
    console.error("Turso fetch error:", e.message);
    return null;
  }
}

async function dbQuery(env, sql, args = []) {
  const res = await dbExec(env, [{ sql, args }]);
  return res?.results?.[0]?.response?.result ?? null;
}

async function initDb(env) {
  return dbExec(env, [
    {
      sql: `CREATE TABLE IF NOT EXISTS quiz_generations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        title TEXT,
        questions_count INTEGER,
        telegram_chat_id TEXT,
        telegram_username TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS telegram_users (
        chat_id TEXT PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        total_quizzes INTEGER DEFAULT 0,
        first_seen TEXT DEFAULT (datetime('now')),
        last_seen TEXT DEFAULT (datetime('now'))
      )`,
    },
  ]);
}

async function trackGeneration(
  env,
  { source, title, questionsCount, chatId, username, firstName },
) {
  if (!hasDb(env)) return;
  try {
    const stmts = [
      {
        sql: "INSERT INTO quiz_generations (source, title, questions_count, telegram_chat_id, telegram_username) VALUES (?, ?, ?, ?, ?)",
        args: [
          source,
          title || "",
          questionsCount,
          chatId ?? null,
          username ?? null,
        ],
      },
    ];
    if (chatId) {
      stmts.push({
        sql: `INSERT INTO telegram_users (chat_id, username, first_name, total_quizzes, last_seen)
              VALUES (?, ?, ?, 1, datetime('now'))
              ON CONFLICT(chat_id) DO UPDATE SET
                total_quizzes = total_quizzes + 1,
                last_seen     = datetime('now'),
                username      = COALESCE(excluded.username, username),
                first_name    = COALESCE(excluded.first_name, first_name)`,
        args: [String(chatId), username ?? null, firstName ?? null],
      });
    }
    await dbExec(env, stmts);
  } catch (e) {
    console.error("trackGeneration error:", e.message);
  }
}

async function getDbStats(env) {
  if (!hasDb(env)) return null;
  const [gen, users] = await Promise.all([
    dbQuery(
      env,
      `SELECT
        COUNT(*)                                     AS total,
        COALESCE(SUM(questions_count),0)             AS total_questions,
        COUNT(CASE WHEN source='web'      THEN 1 END) AS web_count,
        COUNT(CASE WHEN source='telegram' THEN 1 END) AS tg_count
      FROM quiz_generations`,
    ),
    dbQuery(env, "SELECT COUNT(*) AS users FROM telegram_users"),
  ]);
  const g = gen?.rows?.[0];
  const u = users?.rows?.[0];
  if (!g) return null;
  return {
    total: Number(g[0]?.value ?? 0),
    totalQuestions: Number(g[1]?.value ?? 0),
    webCount: Number(g[2]?.value ?? 0),
    tgCount: Number(g[3]?.value ?? 0),
    telegramUsers: Number(u?.[0]?.value ?? 0),
  };
}

async function getUserStats(env, chatId) {
  if (!hasDb(env)) return null;
  const r = await dbQuery(
    env,
    "SELECT total_quizzes, first_seen, last_seen FROM telegram_users WHERE chat_id = ?",
    [String(chatId)],
  );
  if (!r?.rows?.length) return null;
  const row = r.rows[0];
  return {
    totalQuizzes: Number(row[0]?.value ?? 0),
    firstSeen: row[1]?.value ?? "—",
    lastSeen: row[2]?.value ?? "—",
  };
}

// ════════════════════════════════════════════════════════════
//  GITHUB QUESTION STORE
// ════════════════════════════════════════════════════════════
function hasGithub(env) {
  return !!(
    (env.GITHUB_TOKEN || env.GITHUB_PERSONAL_ACCESS_TOKEN) &&
    env.GITHUB_REPO
  );
}

function ghToken(env) {
  return env.GITHUB_TOKEN || env.GITHUB_PERSONAL_ACCESS_TOKEN;
}

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function safeName(s) {
  return (
    String(s || "General")
      .replace(/[/\\:*?"<>|#%]/g, "")
      .trim() || "General"
  );
}

async function ghFetch(env, method, filePath, body) {
  const branch = env.GITHUB_BRANCH || "main";
  const base = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${filePath}`;
  const url =
    method === "GET" ? `${base}?ref=${encodeURIComponent(branch)}` : base;
  // [C3] 10-second timeout on every GitHub API call
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  const opts = {
    method,
    signal: ctrl.signal,
    headers: {
      Authorization: `Bearer ${ghToken(env)}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "QuizWorker/1.0",
    },
  };
  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify({ ...body, branch });
  }
  try {
    return await fetch(url, opts);
  } finally {
    clearTimeout(timer);
  }
}

function dedupKey(q) {
  const en = String(q.qEnglish || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const hi = String(q.qHindi || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  // use whichever fields are present
  if (en && hi) return `${en}|||${hi}`;
  if (en) return `en:${en}`;
  if (hi) return `hi:${hi}`;
  // last resort: hash options too so we don't lose questions with no text
  return `opts:${JSON.stringify(q.optionsEnglish || q.optionsHindi || [])}`;
}

async function saveQuestionsToGithub(env, questions, source) {
  if (!hasGithub(env)) return;
  try {
    const groups = {};
    for (const q of questions) {
      const subject = safeName(q.subject);
      const topic = safeName(q.topic);
      if (!groups[subject]) groups[subject] = {};
      if (!groups[subject][topic]) groups[subject][topic] = [];
      groups[subject][topic].push(q);
    }

    for (const [subject, topics] of Object.entries(groups)) {
      for (const [topic, newQs] of Object.entries(topics)) {
        const filePath = `questions/${subject}/${topic}.json`;
        let existing = [];
        let sha = null;
        try {
          const r = await ghFetch(env, "GET", filePath);
          if (r.ok) {
            const data = await r.json();
            sha = data.sha;
            existing = JSON.parse(fromBase64(data.content));
          }
        } catch (_) {}

        const seen = new Set(existing.map(dedupKey));
        const merged = [
          ...existing,
          ...newQs.filter((q) => !seen.has(dedupKey(q))),
        ];
        if (merged.length === existing.length) continue;

        const body = {
          message: `Add ${merged.length - existing.length} question(s) to ${subject}/${topic} [${source}]`,
          content: toBase64(JSON.stringify(merged, null, 2)),
        };
        if (sha) body.sha = sha;

        const wr = await ghFetch(env, "PUT", filePath, body);
        if (!wr.ok) {
          const err = await wr.text().catch(() => "");
          console.error(`GitHub save error ${wr.status} for ${filePath}:`, err);
        }
      }
    }
  } catch (e) {
    console.error("saveQuestionsToGithub error:", e.message);
  }
}

async function ghListTopics(env) {
  if (!hasGithub(env)) return null;
  try {
    const branch = env.GITHUB_BRANCH || "main";
    // [C3] 10-second timeout on the tree API call
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    let r;
    try {
      r = await fetch(
        `https://api.github.com/repos/${env.GITHUB_REPO}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
        {
          signal: ctrl.signal,
          headers: {
            Authorization: `Bearer ${ghToken(env)}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "QuizWorker/1.0",
          },
        },
      );
    } finally {
      clearTimeout(timer);
    }
    if (!r.ok) return null;
    const data = await r.json();
    // [M2] Warn if GitHub truncated the tree (> 100,000 entries)
    if (data.truncated) {
      console.error("ghListTopics: GitHub tree API returned truncated=true — bank structure is incomplete");
    }
    const structure = {};
    for (const item of data.tree || []) {
      const m = item.path.match(/^questions\/([^/]+)\/([^/]+)\.json$/);
      if (m && item.type === "blob") {
        const [, subject, topic] = m;
        if (!structure[subject]) structure[subject] = [];
        structure[subject].push(topic);
      }
    }
    return Object.keys(structure).length ? structure : null;
  } catch (e) {
    console.error("ghListTopics error:", e.message);
    return null;
  }
}

async function ghGetQuestions(env, subject, topic) {
  if (!hasGithub(env)) return null;
  try {
    const filePath = `questions/${subject}/${topic}.json`;
    const r = await ghFetch(env, "GET", filePath);
    if (!r.ok) return null;
    const data = await r.json();
    return JSON.parse(fromBase64(data.content));
  } catch (e) {
    console.error("ghGetQuestions error:", e.message);
    return null;
  }
}

// ════════════════════════════════════════════════════════════
//  AI TOPIC NORMALIZATION  (OpenRouter — openai/gpt-oss-120b:free)
// ════════════════════════════════════════════════════════════
function hasOpenRouter(env) {
  return !!env.OPENROUTER_API_KEY;
}

function extractUniquePairs(questions) {
  const seen = new Set();
  const pairs = [];
  for (const q of questions) {
    const subject = String(q.subject || "General").trim();
    const topic   = String(q.topic   || "General").trim();
    const key = `${subject}|||${topic}`;
    if (!seen.has(key)) { seen.add(key); pairs.push({ subject, topic }); }
  }
  return pairs;
}

function allPairsMatch(newPairs, githubStructure) {
  if (!githubStructure) return false;
  return newPairs.every(({ subject, topic }) => {
    const topics = githubStructure[subject];
    return Array.isArray(topics) && topics.includes(topic);
  });
}

async function aiNormalizePairs(env, newPairs, githubStructure) {
  if (!hasOpenRouter(env) || !newPairs.length) return null;
  const systemPrompt =
    "You are a taxonomy normalizer for an educational question bank.\n" +
    "Given new subject/topic pairs and the existing bank structure, map each pair to the best matching existing name.\n" +
    "Rules:\n" +
    "- Fix abbreviations: \"Phy\"→\"Physics\", \"Bio\"→\"Biology\"\n" +
    "- Fix case/spelling: \"optics basics\"→\"Optics\", \"Cell Bio\"→\"Cell Biology\"\n" +
    "- If no close match exists keep the original name exactly\n" +
    "- Never invent names — only use names from the existing bank OR the original\n" +
    "- Return a JSON OBJECT where each key is \"OriginalSubject|||OriginalTopic\" and each value is {\"subject\":\"NormalizedSubject\",\"topic\":\"NormalizedTopic\"}\n" +
    "- Return ONLY valid JSON, no explanation, no markdown fences";
  const userMsg =
    `Existing question bank:\n${JSON.stringify(githubStructure, null, 2)}\n\n` +
    `New pairs to normalize:\n${JSON.stringify(newPairs, null, 2)}\n\n` +
    `Return a JSON OBJECT (not an array). Key format: "Subject|||Topic". Every input pair must appear as a key.`;
  // [C1] Hard 25-second abort — CF Workers wall-clock limit is 30s
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        // [L2] Use the actual worker origin when available
        "HTTP-Referer": env.WORKER_ORIGIN || "https://quiz-generator.workers.dev",
        "X-Title": "Quiz Generator",
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b:free",
        temperature: 0,
        // [C2] 4096 tokens — enough for 500 pairs × ~8 tokens each
        max_tokens: 4096,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userMsg },
        ],
      }),
    });
    if (!res.ok) {
      console.error("OpenRouter error", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) return null;
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    if (typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch (e) {
    if (e.name === "AbortError") {
      console.error("aiNormalizePairs: request timed out after 25s — skipping AI normalization");
    } else {
      console.error("aiNormalizePairs error:", e.message);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// [H4] Reject arrays of nulls / non-objects / objects with no recognizable text field
function validateQuestions(questions) {
  const valid = questions.filter(
    (q) =>
      q !== null &&
      typeof q === "object" &&
      !Array.isArray(q) &&
      (q.qEnglish || q.qHindi || q.question || q.text || q.q),
  );
  return valid;
}

function applyNormalization(questions, aiResult) {
  if (!aiResult) return questions;
  return questions.map(q => {
    const key = `${q.subject}|||${q.topic}`;
    const mapped = aiResult[key];
    if (!mapped) return q;
    return { ...q, subject: mapped.subject, topic: mapped.topic };
  });
}

async function normalizeQuestions(env, questions, githubStructure) {
  if (!githubStructure) return questions;
  const newPairs = extractUniquePairs(questions);
  if (allPairsMatch(newPairs, githubStructure)) {
    return questions; // [L1] zero-latency bypass — all pairs already match
  }
  if (!hasOpenRouter(env)) return questions;
  const aiResult = await aiNormalizePairs(env, newPairs, githubStructure);
  return applyNormalization(questions, aiResult);
}



// ════════════════════════════════════════════════════════════
//  QUIZ HTML GENERATOR
//  FIX: questions are now embedded as a <script type="application/json">
//  data island — the browser never executes this block so </script> inside
//  question text is completely harmless and cannot break the page.
// ════════════════════════════════════════════════════════════
function generateHtml(questions, title) {
  const titleSafe = escHtml(title);
  // FIX: JSON for the data island — NO escaping of </script> needed because
  // type="application/json" blocks are never parsed as JS by browsers.
  const qJson = JSON.stringify(questions);
  // FIX: use JSON.stringify for the JS string literal so characters like &
  // are not double-escaped as &amp; inside JavaScript.
  const titleJs = JSON.stringify(title);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title id="page-title">${titleSafe}</title>
<style>
:root{
  --primary:#4f46e5;--primary-light:#818cf8;--primary-dark:#3730a3;
  --success:#16a34a;--danger:#dc2626;--warning:#d97706;
  --bg:#f8fafc;--surface:#fff;--border:#e2e8f0;
  --text:#1e293b;--muted:#64748b;
  --hindi-bg:#fdf4ff;--hindi-border:#e9d5ff;--hindi-text:#7c3aed;
  --match-bg:#fffbeb;--match-border:#fde68a;--match-text:#92400e;
  --r:12px;--sh:0 4px 24px rgba(0,0,0,.08);--sh-sm:0 1px 6px rgba(0,0,0,.06);
}
body.dark{
  --bg:#0f172a;--surface:#1e293b;--border:#334155;
  --text:#f1f5f9;--muted:#94a3b8;
  --hindi-bg:#1e1b33;--hindi-border:#4c1d95;--hindi-text:#a78bfa;
  --match-bg:#1c1a08;--match-border:#78350f;--match-text:#fcd34d;
  --sh:0 4px 24px rgba(0,0,0,.4);--sh-sm:0 1px 6px rgba(0,0,0,.3);
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;transition:background .2s,color .2s}
nav{background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 16px;height:54px;position:sticky;top:0;z-index:100;box-shadow:0 2px 12px rgba(79,70,229,.35);gap:8px}
.logo{font-weight:800;font-size:.95rem;display:flex;align-items:center;gap:6px;flex-shrink:0}
.quiz-title-edit{outline:none;border-bottom:1px dashed rgba(255,255,255,.4);min-width:60px;max-width:200px;white-space:nowrap;overflow:hidden;cursor:text;transition:border .15s}
.quiz-title-edit:focus{border-bottom:1px solid #fff;background:rgba(255,255,255,.1);border-radius:4px;padding:1px 4px}
.nav-tabs{display:flex;gap:2px;flex-shrink:0}
.nav-tab{background:transparent;border:none;color:rgba(255,255,255,.75);cursor:pointer;padding:5px 10px;border-radius:7px;font-size:.8rem;font-weight:500;transition:.15s;white-space:nowrap}
.nav-tab:hover{background:rgba(255,255,255,.15);color:#fff}
.nav-tab.active{background:rgba(255,255,255,.22);color:#fff;font-weight:700}
.nav-right{display:flex;align-items:center;gap:6px;flex-shrink:0}
.icon-btn{background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.25);color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:1rem;transition:.15s}
.icon-btn:hover{background:rgba(255,255,255,.28)}
.bilingual-badge{background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.3);color:#fff;padding:3px 9px;border-radius:99px;font-size:.72rem;font-weight:700;white-space:nowrap}
.page{display:none;padding:18px;max-width:860px;margin:0 auto}
.page.active{display:block}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);box-shadow:var(--sh-sm);padding:20px;margin-bottom:16px}
.home-hero{text-align:center;padding:28px 12px 20px}
.home-hero h1{font-size:1.7rem;color:var(--primary);margin-bottom:5px}
.home-hero p{color:var(--muted);font-size:.9rem}
.bilingual-pill{display:inline-block;background:linear-gradient(90deg,#4f46e5 50%,#7c3aed 50%);color:#fff;border-radius:99px;padding:2px 14px;font-size:.75rem;font-weight:700;margin-top:7px}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin:18px 0}
.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:16px;text-align:center;box-shadow:var(--sh-sm)}
.stat-card .value{font-size:1.8rem;font-weight:800;color:var(--primary)}
.stat-card .label{font-size:.76rem;color:var(--muted);margin-top:3px}
.filter-row{display:flex;gap:9px;flex-wrap:wrap;align-items:center;margin-bottom:16px}
.filter-row label{font-size:.86rem;font-weight:600;color:var(--muted)}
select,input[type=number],input[type=checkbox]{border:1px solid var(--border);border-radius:7px;padding:6px 10px;font-size:.86rem;background:var(--surface);color:var(--text);outline:none;transition:.15s}
input[type=checkbox]{width:18px;height:18px;padding:0;cursor:pointer}
select:focus,input:focus{border-color:var(--primary)}
body.dark select,body.dark input[type=number]{background:var(--surface);color:var(--text)}
.btn{display:inline-flex;align-items:center;gap:5px;border:none;border-radius:7px;padding:8px 16px;font-size:.86rem;font-weight:600;cursor:pointer;transition:.15s}
.btn-primary{background:var(--primary);color:#fff}
.btn-primary:hover{background:var(--primary-dark);transform:translateY(-1px)}
.btn-outline{background:transparent;border:2px solid var(--primary);color:var(--primary)}
.btn-outline:hover{background:var(--primary);color:#fff}
.btn-sm{padding:5px 11px;font-size:.79rem}
.btn:disabled{opacity:.5;cursor:not-allowed;transform:none!important}
.btn-success{background:var(--success);color:#fff}
.btn-success:hover{background:#15803d;transform:translateY(-1px)}
.marking-info{display:inline-flex;gap:10px;padding:5px 12px;border-radius:99px;background:var(--bg);border:1px solid var(--border);font-size:.78rem;color:var(--muted);margin-bottom:14px}
.marking-info .pos{color:var(--success);font-weight:700}
.marking-info .neg{color:var(--danger);font-weight:700}
#quiz-progress-bar-wrap{background:var(--border);border-radius:99px;height:6px;margin-bottom:16px;overflow:hidden}
#quiz-progress-bar{background:linear-gradient(90deg,var(--primary),#7c3aed);height:100%;border-radius:99px;transition:width .3s;width:0%}
.quiz-meta{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;font-size:.81rem;color:var(--muted)}
#quiz-timer{background:var(--primary);color:#fff;border-radius:20px;padding:3px 12px;font-weight:700;font-size:.9rem;transition:background .3s}
#quiz-timer.warning{background:var(--warning)}
#quiz-timer.danger{background:var(--danger);animation:timerPulse .7s infinite alternate}
@keyframes timerPulse{from{opacity:1}to{opacity:.5}}
.question-tag{display:inline-block;font-size:.71rem;background:#ede9fe;color:var(--primary);padding:2px 10px;border-radius:99px;margin-bottom:9px;font-weight:600}
body.dark .question-tag{background:#2e1065;color:#a78bfa}
.question-block{margin-bottom:16px}
.q-image{width:100%;max-height:260px;object-fit:contain;border-radius:8px;margin:6px 0 12px;border:1px solid var(--border)}
.q-english{font-size:1.03rem;font-weight:700;line-height:1.55;color:var(--text);margin-bottom:7px}
.q-hindi{font-size:.95rem;font-weight:500;line-height:1.6;color:var(--hindi-text);background:var(--hindi-bg);border-left:3px solid var(--hindi-border);padding:7px 12px;border-radius:0 8px 8px 0}
.lang-divider{display:flex;align-items:center;gap:7px;margin:6px 0;font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.lang-divider::before,.lang-divider::after{content:'';flex:1;height:1px;background:var(--border)}
.match-table-wrap{margin:10px 0 14px;border:1.5px solid var(--match-border);border-radius:9px;overflow:hidden;background:var(--match-bg)}
.match-table-header{background:var(--match-border);padding:5px 12px;font-size:.72rem;font-weight:700;color:var(--match-text);text-transform:uppercase;letter-spacing:.05em}
.match-tbl{width:100%;border-collapse:collapse;font-size:.86rem}
.match-tbl td{padding:7px 12px;border-bottom:1px solid var(--match-border);color:var(--match-text);vertical-align:top;line-height:1.45}
.match-tbl tr:last-child td{border-bottom:none}
.match-tbl td:first-child{font-weight:700;width:48%;border-right:1px solid var(--match-border)}
.match-tbl.single-col td:first-child{border-right:none;width:100%}
.match-col-hdr{background:rgba(0,0,0,.04);font-weight:700;font-size:.74rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
body.dark .match-col-hdr{background:rgba(255,255,255,.04)}
.match-hi td{background:var(--hindi-bg);color:var(--hindi-text);font-size:.82rem;border-color:var(--hindi-border)}
.options-list{list-style:none;display:flex;flex-direction:column;gap:8px}
.option-item{border:2px solid var(--border);border-radius:9px;padding:10px 13px;cursor:pointer;transition:.15s;display:flex;align-items:flex-start;gap:10px}
.option-item:hover:not(.disabled){border-color:var(--primary-light);background:#ede9fe18}
.option-item.selected{border-color:var(--primary);background:#ede9fe33}
.option-item.correct{border-color:var(--success);background:#dcfce7}
.option-item.wrong{border-color:var(--danger);background:#fee2e2}
.option-item.disabled{cursor:default}
body.dark .option-item.correct{background:#14532d33}
body.dark .option-item.wrong{background:#7f1d1d33}
.option-letter{width:29px;height:29px;border-radius:50%;background:var(--bg);border:2px solid var(--border);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.8rem;flex-shrink:0;margin-top:2px}
.option-item.correct .option-letter{background:var(--success);border-color:var(--success);color:#fff}
.option-item.wrong .option-letter{background:var(--danger);border-color:var(--danger);color:#fff}
.option-item.selected .option-letter{background:var(--primary);border-color:var(--primary);color:#fff}
.option-texts{display:flex;flex-direction:column;gap:2px}
.opt-english{font-size:.91rem;font-weight:600;color:var(--text)}
.opt-hindi{font-size:.81rem;color:var(--hindi-text)}
.explanation-box{margin-top:14px;border-radius:9px;overflow:hidden;display:none;border:1px solid var(--border)}
.explanation-box.show{display:block}
.exp-english{padding:11px 15px;background:#f0fdf4;border-left:4px solid var(--success);font-size:.86rem;line-height:1.6;color:#14532d}
.exp-hindi{padding:11px 15px;background:var(--hindi-bg);border-left:4px solid var(--hindi-border);font-size:.86rem;line-height:1.6;color:var(--hindi-text);border-top:1px solid var(--border)}
body.dark .exp-english{background:#052e16;color:#86efac}
.quiz-nav{display:flex;justify-content:space-between;align-items:center;margin-top:18px;gap:8px;flex-wrap:wrap}
.quiz-nav-left{display:flex;gap:6px;flex-wrap:wrap}
.question-nav-grid{display:flex;flex-wrap:wrap;gap:5px;margin-top:12px}
.q-dot{width:30px;height:30px;border-radius:6px;border:2px solid var(--border);background:var(--surface);cursor:pointer;font-size:.76rem;font-weight:600;color:var(--muted);display:flex;align-items:center;justify-content:center;transition:.12s;position:relative}
.q-dot:hover{border-color:var(--primary);color:var(--primary)}
.q-dot.current{border-color:var(--primary);background:var(--primary);color:#fff}
.q-dot.answered{border-color:var(--success);background:#dcfce7;color:var(--success)}
.q-dot.wrong-answered{border-color:var(--danger);background:#fee2e2;color:var(--danger)}
.q-dot.skipped{border-color:var(--warning);background:#fef9c3;color:var(--warning)}
.q-dot.flagged::after{content:'⭐';position:absolute;top:-6px;right:-6px;font-size:.52rem;line-height:1}
body.dark .q-dot.answered{background:#14532d44}
body.dark .q-dot.wrong-answered{background:#7f1d1d44}
.flag-btn{background:transparent;border:2px solid var(--border);border-radius:7px;cursor:pointer;font-size:1rem;padding:4px 9px;transition:.15s;color:var(--muted)}
.flag-btn.flagged{border-color:#f59e0b;background:#fef9c3;color:#92400e}
.flag-btn:hover{border-color:#f59e0b}
.kbd-hint{font-size:.69rem;color:var(--muted);text-align:center;margin-top:8px;opacity:.7}
.kbd{display:inline-block;background:var(--bg);border:1px solid var(--border);border-radius:3px;padding:0 4px;font-size:.67rem;font-family:monospace}
.result-hero{text-align:center;padding:24px 0}
.result-score-ring{width:128px;height:128px;border-radius:50%;border:10px solid var(--border);display:inline-flex;align-items:center;justify-content:center;flex-direction:column;margin-bottom:12px}
.score-pct{font-size:1.9rem;font-weight:900;color:var(--primary)}
.score-label{font-size:.7rem;color:var(--muted);font-weight:600}
.marks-display{margin-top:8px;font-size:1rem;font-weight:700;color:var(--text)}
.marks-display span{color:var(--primary)}
.result-bars{margin-top:12px}
.result-bar-row{display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:.84rem}
.result-bar-label{width:75px;color:var(--muted)}
.result-bar-track{flex:1;background:var(--border);border-radius:99px;height:7px;overflow:hidden}
.result-bar-fill{height:100%;border-radius:99px}
.result-bar-count{width:34px;text-align:right;font-weight:700}
.review-summary{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px}
.rsm-pill{display:inline-flex;align-items:center;gap:5px;padding:4px 11px;border-radius:99px;font-size:.79rem;font-weight:700;border:1.5px solid}
.rsm-correct{background:#dcfce7;color:#16a34a;border-color:#86efac}
.rsm-wrong{background:#fee2e2;color:#dc2626;border-color:#fca5a5}
.rsm-skipped{background:#fef9c3;color:#d97706;border-color:#fde68a}
.rsm-flagged{background:#fef3c7;color:#92400e;border-color:#fcd34d}
.review-q{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:16px;margin-bottom:12px}
.review-q .q-number{font-size:.76rem;color:var(--muted);margin-bottom:5px}
.review-q .q-english{font-weight:700;margin-bottom:4px;line-height:1.5;font-size:.98rem}
.review-q .q-hindi{font-size:.88rem;color:var(--hindi-text);margin-bottom:10px}
.review-option{padding:7px 12px;border-radius:7px;border:2px solid var(--border);margin-bottom:5px;display:flex;align-items:flex-start;gap:8px;font-size:.86rem}
.review-option.correct-opt{border-color:var(--success);background:#dcfce7}
.review-option.user-wrong{border-color:var(--danger);background:#fee2e2}
body.dark .review-option.correct-opt{background:#052e16}
body.dark .review-option.user-wrong{background:#450a0a}
.review-exp-en{padding:8px 12px;background:#f0fdf4;border-left:4px solid var(--success);font-size:.83rem;line-height:1.55}
.review-exp-hi{padding:8px 12px;background:var(--hindi-bg);border-left:4px solid var(--hindi-border);font-size:.83rem;line-height:1.55;color:var(--hindi-text);border-top:1px solid var(--border)}
body.dark .review-exp-en{background:#052e16;color:#86efac}
.review-exp-wrap{margin-top:9px;border:1px solid var(--border);border-radius:7px;overflow:hidden}
.badge{display:inline-block;padding:2px 7px;border-radius:99px;font-size:.7rem;font-weight:700}
.badge-correct{background:#dcfce7;color:var(--success)}
.badge-wrong{background:#fee2e2;color:var(--danger)}
.badge-skipped{background:#fef9c3;color:var(--warning)}
.badge-flagged{background:#fef3c7;color:#92400e}
.history-item{display:flex;align-items:center;gap:9px;padding:9px 13px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:7px;font-size:.86rem}
.h-score{font-weight:800;font-size:1rem;color:var(--primary)}
.h-detail{color:var(--muted);font-size:.78rem;flex:1}
.h-date{color:var(--muted);font-size:.75rem}
.sub-row{display:grid;grid-template-columns:1fr 65px 65px;gap:7px;padding:6px 0;border-bottom:1px solid var(--border);font-size:.84rem;align-items:center}
.sub-row:last-child{border-bottom:none}
.sub-name{font-weight:600}
.sub-pct{text-align:center;font-weight:700;color:var(--primary)}
.sub-total{text-align:center;color:var(--muted)}
.section-title{font-size:1rem;font-weight:700;margin-bottom:13px;color:var(--text);display:flex;align-items:center;gap:6px}
.divider{border:none;border-top:1px solid var(--border);margin:16px 0}
.empty-state{text-align:center;padding:32px 16px;color:var(--muted)}
.empty-state .icon{font-size:2.6rem;margin-bottom:9px}
.toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#1e293b;color:#fff;padding:9px 20px;border-radius:99px;font-size:.84rem;font-weight:600;z-index:9999;opacity:0;transition:opacity .3s;pointer-events:none}
.toast.show{opacity:1}
@media print{nav,#quiz-page,.quiz-nav,.kbd-hint,#q-nav-grid,.card:has(.section-title){display:none!important}.review-q{break-inside:avoid}body{background:#fff!important}}
@media(max-width:600px){nav{padding:0 9px;gap:5px}.logo{font-size:.82rem}.nav-tab{padding:4px 7px;font-size:.73rem}.page{padding:10px}.quiz-title-edit{max-width:110px}}
</style>
</head>
<body>
<div class="toast" id="toast"></div>
<nav>
  <div class="logo">
    <span>🎓</span>
    <span class="quiz-title-edit" id="quiz-title" contenteditable="true"
          title="Click to rename">${titleSafe}</span>
  </div>
  <div class="nav-tabs">
    <button class="nav-tab active" id="tab-home">Home</button>
    <button class="nav-tab" id="tab-quiz">Quiz</button>
    <button class="nav-tab" id="tab-review">Review</button>
    <button class="nav-tab" id="tab-stats">Stats</button>
  </div>
  <div class="nav-right">
    <div class="bilingual-badge">EN + हिं</div>
    <button class="icon-btn" id="dark-btn" title="Toggle dark mode">🌙</button>
  </div>
</nav>

<div id="home" class="page active">
  <div class="home-hero">
    <h1 id="hero-title">${titleSafe}</h1>
    <p>Bilingual quiz · English &amp; Hindi together</p>
    <div class="bilingual-pill">ENGLISH + हिंदी</div>
  </div>
  <div class="stats-grid" id="home-stats"></div>
  <div class="card"><div class="section-title">📈 Last Performance</div><div id="home-overview"></div></div>
  <div class="card"><div class="section-title">🕐 Recent Sessions</div><div id="home-recent"></div></div>
</div>

<div id="quiz-setup" class="page">
  <div class="card">
    <div class="section-title">⚙️ Quiz Settings</div>
    <div class="filter-row"><label>Subject</label><select id="filter-subject"><option value="">All Subjects</option></select></div>
    <div class="filter-row"><label>Topic</label><select id="filter-topic"><option value="">All Topics</option></select></div>
    <div class="filter-row">
      <label>Questions</label>
      <input type="number" id="q-count" min="1" max="500" value="20" style="width:72px"/>
      <span style="font-size:.81rem;color:var(--muted)" id="q-available"></span>
    </div>
    <div class="filter-row">
      <label>Timer</label>
      <select id="quiz-mode">
        <option value="timed">60s per question</option>
        <option value="custom">Custom timer</option>
        <option value="free">No timer</option>
      </select>
      <input type="number" id="custom-time" min="10" max="600" value="60" style="width:72px;display:none"/>
      <span id="custom-time-unit" style="font-size:.8rem;color:var(--muted);display:none">sec</span>
    </div>
    <div class="filter-row"><label>Order</label><select id="quiz-order"><option value="random">Random</option><option value="sequential">Sequential</option></select></div>
    <div class="filter-row">
      <label>Scramble options</label>
      <input type="checkbox" id="scramble-opts" title="Shuffle A/B/C/D order each question"/>
      <span style="font-size:.78rem;color:var(--muted)">Shuffle answer order (anti-memorisation)</span>
    </div>
    <hr class="divider"/>
    <div class="section-title" style="margin-bottom:10px">🏅 Marking Scheme</div>
    <div class="filter-row">
      <label>✅ Correct</label>
      <input type="number" id="mark-correct" min="0.25" max="10" step="0.25" value="1" style="width:72px"/>
      <label style="margin-left:8px">marks</label>
    </div>
    <div class="filter-row">
      <label>❌ Wrong</label>
      <input type="number" id="mark-neg" min="0" max="10" step="0.25" value="0" style="width:72px"/>
      <label style="margin-left:8px">marks deducted</label>
    </div>
    <div id="marking-preview" style="font-size:.82rem;color:var(--muted);margin-bottom:14px"></div>
    <hr class="divider"/>
    <button class="btn btn-primary" id="start-quiz-btn">▶ Start Quiz</button>
    <span id="setup-msg" style="margin-left:9px;font-size:.81rem;color:var(--danger)"></span>
  </div>
</div>

<div id="quiz-page" class="page">
  <div id="quiz-progress-bar-wrap"><div id="quiz-progress-bar"></div></div>
  <div class="quiz-meta">
    <span id="quiz-meta-left"></span>
    <span id="quiz-timer">60</span>
    <button class="btn btn-sm btn-outline" id="finish-early-btn">Finish Early</button>
  </div>
  <div class="card">
    <div id="quiz-marking-badge" class="marking-info"></div>
    <div class="question-tag" id="q-tag"></div>
    <div class="question-block">
      <img id="q-image" class="q-image" src="" alt="" style="display:none"/>
      <div class="q-english" id="q-english"></div>
      <div class="lang-divider" id="hindi-divider">हिंदी</div>
      <div class="q-hindi" id="q-hindi"></div>
    </div>
    <div id="match-container"></div>
    <ul class="options-list" id="options-list"></ul>
    <div class="explanation-box" id="explanation-box">
      <div class="exp-english" id="exp-english"></div>
      <div class="exp-hindi" id="exp-hindi"></div>
    </div>
    <div class="quiz-nav">
      <div class="quiz-nav-left">
        <button class="btn btn-outline btn-sm" id="prev-btn">← Prev</button>
        <button class="btn btn-sm" id="skip-btn" style="background:#fef9c3;color:#92400e;border:2px solid #fbbf24;">Skip</button>
        <button class="flag-btn" id="flag-btn" title="Flag for review (*)">⭐</button>
      </div>
      <button class="btn btn-primary btn-sm" id="next-btn">Next →</button>
    </div>
    <div class="kbd-hint">
      <span class="kbd">1</span>–<span class="kbd">4</span> pick &nbsp;·&nbsp;
      <span class="kbd">←</span><span class="kbd">→</span> navigate &nbsp;·&nbsp;
      <span class="kbd">S</span> skip &nbsp;·&nbsp;
      <span class="kbd">*</span> flag &nbsp;·&nbsp;
      <span class="kbd">F</span> finish
    </div>
  </div>
  <div class="card">
    <div style="font-size:.78rem;color:var(--muted);margin-bottom:6px">
      Question Navigator &nbsp;·&nbsp; <span id="flag-count-label" style="color:#92400e"></span>
    </div>
    <div class="question-nav-grid" id="q-nav-grid"></div>
  </div>
</div>

<div id="results-page" class="page">
  <div class="card result-hero">
    <div class="result-score-ring" id="score-ring">
      <span class="score-pct" id="result-pct">0%</span>
      <span class="score-label">Accuracy</span>
    </div>
    <h2 id="result-heading"></h2>
    <div class="marks-display" id="marks-display"></div>
    <p id="result-summary" style="color:var(--muted);margin-top:5px;font-size:.88rem;"></p>
  </div>
  <div class="card"><div class="section-title">📊 Breakdown</div><div class="result-bars" id="result-bars"></div></div>
  <div class="card"><div class="section-title">📚 Subject Performance</div><div id="result-subject-breakdown"></div></div>
  <div style="display:flex;gap:9px;flex-wrap:wrap;margin-bottom:18px">
    <button class="btn btn-primary" id="go-review-btn">🔍 Review</button>
    <button class="btn btn-outline" id="retake-btn">🔁 Retake</button>
    <button class="btn btn-outline" id="new-quiz-btn">🔄 New Quiz</button>
    <button class="btn btn-success" id="copy-results-btn">📋 Copy Results</button>
    <button class="btn btn-outline" id="print-btn">🖨️ Print Review</button>
    <button class="btn btn-outline" id="results-home-btn">🏠 Home</button>
  </div>
</div>

<div id="review-page" class="page">
  <div class="card">
    <div class="section-title">🔍 Review (EN + हिं)</div>
    <div id="review-summary-bar" class="review-summary"></div>
    <div class="filter-row">
      <label>Subject</label>
      <select id="review-subject"></select>
      <label>Show</label>
      <select id="review-filter">
        <option value="all">All</option>
        <option value="wrong">Wrong</option>
        <option value="correct">Correct</option>
        <option value="skipped">Skipped</option>
        <option value="flagged">Flagged ⭐</option>
      </select>
    </div>
  </div>
  <div id="review-list"></div>
</div>

<div id="stats-page" class="page">
  <div class="stats-grid" id="stats-grid"></div>
  <div class="card"><div class="section-title">📊 Subject-wise Accuracy</div><div id="stats-subject"></div></div>
  <div class="card">
    <div class="section-title">🕐 Session History</div>
    <div id="stats-history"></div>
    <button class="btn btn-sm btn-outline" id="clear-history-btn"
      style="margin-top:9px;border-color:var(--danger);color:var(--danger)">🗑 Clear History</button>
  </div>
</div>

<!-- FIX: data island — browser never executes this as JS, so </script> inside
     question text is completely harmless and cannot break the page. -->
<script type="application/json" id="q-data">${qJson}</script>

<script>
// ── Bootstrap: read questions from the safe data island ──────────────────────
const ALL_QUESTIONS = JSON.parse(document.getElementById('q-data').textContent);
// FIX: titleJs is a proper JSON string so & etc. are not double-escaped
const _TITLE = ${titleJs};

let currentSession = null, quizHistory = [];

// ── Utility ──────────────────────────────────────────────────────────────────
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let _toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

function applyDark(on) {
  document.body.classList.toggle('dark', on);
  document.getElementById('dark-btn').textContent = on ? '☀️' : '🌙';
  localStorage.setItem('quiz_theme', on ? 'dark' : 'light');
}
function toggleDark() { applyDark(!document.body.classList.contains('dark')); }
function initDark() {
  const s = localStorage.getItem('quiz_theme');
  if (s === 'dark') applyDark(true);
  else if (!s && window.matchMedia('(prefers-color-scheme:dark)').matches) applyDark(true);
}

// ── Title editing ─────────────────────────────────────────────────────────────
const titleEl  = document.getElementById('quiz-title');
const heroEl   = document.getElementById('hero-title');
titleEl.addEventListener('input', () => {
  heroEl.textContent = titleEl.textContent.trim() || _TITLE;
  document.title = titleEl.textContent.trim() || _TITLE;
});
titleEl.addEventListener('blur', () => {
  if (!titleEl.textContent.trim()) titleEl.textContent = _TITLE;
  heroEl.textContent = titleEl.textContent.trim();
  document.title = titleEl.textContent.trim();
});
titleEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
});

// ── History persistence ───────────────────────────────────────────────────────
function saveHistory()  { localStorage.setItem('quiz_history_v3', JSON.stringify(quizHistory)); }
function loadHistory()  { try { quizHistory = JSON.parse(localStorage.getItem('quiz_history_v3') || '[]'); } catch(e) { quizHistory = []; } }
function clearHistory() {
  if (!confirm('Clear all history?')) return;
  quizHistory = []; saveHistory(); renderStatsPage(); renderHomePage();
}

// ── Page routing ──────────────────────────────────────────────────────────────
const PAGE_TAB_MAP = { home: 0, 'quiz-setup': 1, 'quiz-page': 1, 'results-page': 1, 'review-page': 2, 'stats-page': 3 };
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.nav-tab').forEach((t, i) => t.classList.toggle('active', i === PAGE_TAB_MAP[id]));
  if (id === 'home')         renderHomePage();
  if (id === 'review-page')  renderReview();
  if (id === 'stats-page')   renderStatsPage();
  if (id === 'results-page') renderResults();
}

// ── Filters / setup helpers ───────────────────────────────────────────────────
function getSubjects() { return [...new Set(ALL_QUESTIONS.map(q => q.subject).filter(Boolean))].sort(); }
function getTopics(sub) { return [...new Set(ALL_QUESTIONS.filter(q => !sub || q.subject === sub).map(q => q.topic).filter(Boolean))].sort(); }

function populateFilters() {
  const subSel  = document.getElementById('filter-subject');
  const revSub  = document.getElementById('review-subject');
  // seed review-subject with All option
  const allOpt = document.createElement('option'); allOpt.value = ''; allOpt.textContent = 'All'; revSub.appendChild(allOpt);
  getSubjects().forEach(s => {
    [subSel, revSub].forEach(el => {
      const o = document.createElement('option'); o.value = s; o.textContent = s; el.appendChild(o);
    });
  });
  subSel.addEventListener('change', () => {
    const topSel = document.getElementById('filter-topic');
    topSel.innerHTML = '<option value="">All Topics</option>';
    getTopics(subSel.value).forEach(t => {
      const o = document.createElement('option'); o.value = t; o.textContent = t; topSel.appendChild(o);
    });
    updateAvailable();
  });
  document.getElementById('filter-topic').addEventListener('change', updateAvailable);
  document.getElementById('q-count').addEventListener('input', updateAvailable);
  document.getElementById('mark-correct').addEventListener('input', updateMarkingPreview);
  document.getElementById('mark-neg').addEventListener('input', updateMarkingPreview);
  updateAvailable();
  updateMarkingPreview();
}

function updateAvailable() {
  const sub  = document.getElementById('filter-subject').value;
  const top  = document.getElementById('filter-topic').value;
  const pool = ALL_QUESTIONS.filter(q => (!sub || q.subject === sub) && (!top || q.topic === top));
  document.getElementById('q-available').textContent = '(' + pool.length + ' available)';
  document.getElementById('q-count').max = pool.length;
}
function updateMarkingPreview() {
  const mc = parseFloat(document.getElementById('mark-correct').value) || 1;
  const mn = parseFloat(document.getElementById('mark-neg').value) || 0;
  document.getElementById('marking-preview').textContent = 'Correct = +' + mc + '  ·  Wrong = \u2212' + mn + '  ·  Skip = 0';
}

// ── Match-table renderer ──────────────────────────────────────────────────────
function buildMatchHtml(q) {
  const itemsEn = q.matchItemsEnglish || q.matchItems || q.matchObjects || null;
  const itemsHi = q.matchItemsHindi  || q.matchObjectsHindi || null;
  if (!itemsEn) return '';
  let rows = [], singleCol = false, c1Lbl = 'Column 1', c2Lbl = 'Column 2';
  if (typeof itemsEn === 'string') {
    rows = itemsEn.split(/[,\\n]/).map(s => s.trim()).filter(Boolean).map(p => [p]); singleCol = true;
  } else if (Array.isArray(itemsEn)) {
    if (itemsEn.length && Array.isArray(itemsEn[0])) rows = itemsEn;
    else { rows = itemsEn.map(s => ([String(s)])); singleCol = true; }
  } else if (itemsEn && typeof itemsEn === 'object') {
    const c1 = itemsEn.col1 || itemsEn.column1 || itemsEn.left  || [];
    const c2 = itemsEn.col2 || itemsEn.column2 || itemsEn.right || [];
    c1Lbl = itemsEn.col1Label || itemsEn.label1 || 'Column 1';
    c2Lbl = itemsEn.col2Label || itemsEn.label2 || 'Column 2';
    for (let i = 0; i < Math.max(c1.length, c2.length); i++) rows.push([c1[i] || '', c2[i] || '']);
  }
  if (!rows.length) return '';
  let hiRows = [];
  if (itemsHi) {
    if (typeof itemsHi === 'string') hiRows = itemsHi.split(/[,\\n]/).map(s => s.trim()).filter(Boolean).map(p => [p]);
    else if (Array.isArray(itemsHi)) hiRows = Array.isArray(itemsHi[0]) ? itemsHi : itemsHi.map(s => ([String(s)]));
  }
  const tblCls = 'match-tbl' + (singleCol ? ' single-col' : '');
  let h = '<div class="match-table-wrap"><div class="match-table-header">🔗 Match the Following</div><table class="' + tblCls + '">';
  if (!singleCol) h += '<tr class="match-col-hdr"><td>' + esc(c1Lbl) + '</td><td>' + esc(c2Lbl) + '</td></tr>';
  rows.forEach((row, i) => {
    h += '<tr><td>' + esc(row[0] || '') + '</td>' + (singleCol ? '' : '<td>' + esc(row[1] || '') + '</td>') + '</tr>';
    if (hiRows[i]) h += '<tr class="match-hi"><td>' + esc(hiRows[i][0] || '') + '</td>' + (singleCol ? '' : '<td>' + esc(hiRows[i][1] || '') + '</td>') + '</tr>';
  });
  return h + '</table></div>';
}

// ── Quiz start ────────────────────────────────────────────────────────────────
function startQuiz() {
  const sub      = document.getElementById('filter-subject').value;
  const top      = document.getElementById('filter-topic').value;
  const cnt      = parseInt(document.getElementById('q-count').value) || 20;
  const mode     = document.getElementById('quiz-mode').value;
  const ord      = document.getElementById('quiz-order').value;
  const cust     = parseInt(document.getElementById('custom-time').value) || 60;
  const mc       = parseFloat(document.getElementById('mark-correct').value) || 1;
  const mn       = parseFloat(document.getElementById('mark-neg').value) || 0;
  const scramble = document.getElementById('scramble-opts').checked;

  let pool = ALL_QUESTIONS.filter(q => (!sub || q.subject === sub) && (!top || q.topic === top));
  if (!pool.length) { document.getElementById('setup-msg').textContent = 'No questions match.'; return; }
  if (cnt > pool.length) { document.getElementById('setup-msg').textContent = 'Only ' + pool.length + ' available.'; return; }
  document.getElementById('setup-msg').textContent = '';

  let qs = [...pool];
  if (ord === 'random') qs = qs.sort(() => Math.random() - .5);
  qs = qs.slice(0, cnt);

  if (scramble) {
    qs = qs.map(q => {
      const optsEn = q.optionsEnglish || []; if (!optsEn.length) return q;
      const optsHi = q.optionsHindi || [];
      const order  = [...Array(optsEn.length).keys()].sort(() => Math.random() - .5);
      return { ...q,
        optionsEnglish: order.map(i => optsEn[i]),
        optionsHindi:   order.map(i => optsHi[i] || ''),
        correct:        order.indexOf(q.correct) };
    });
  }

  const secPerQ = mode === 'timed' ? 60 : mode === 'custom' ? cust : null;
  currentSession = {
    questions: qs,
    answers:   new Array(qs.length).fill(null),
    revealed:  new Array(qs.length).fill(false),
    flagged:   new Array(qs.length).fill(false),
    currentIdx: 0,
    startTime: Date.now(),
    secPerQ, timeLeft: secPerQ, timerInterval: null,
    subject: sub || 'All', topic: top || 'All',
    markCorrect: mc, markNeg: mn,
    _lastSettings: { sub, top, cnt, mode, ord, cust, mc, mn, scramble }
  };
  buildQuizNav();
  showPage('quiz-page');
  renderQuestion();
  if (secPerQ !== null) startTimer();
}

function retakeQuiz() {
  if (!currentSession?._lastSettings) return;
  const ls = currentSession._lastSettings;
  document.getElementById('filter-subject').value = ls.sub;
  const topSel = document.getElementById('filter-topic');
  topSel.innerHTML = '<option value="">All Topics</option>';
  getTopics(ls.sub).forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t; topSel.appendChild(o); });
  topSel.value = ls.top;
  document.getElementById('q-count').value    = ls.cnt;
  document.getElementById('quiz-mode').value  = ls.mode;
  document.getElementById('custom-time').value = ls.cust;
  document.getElementById('quiz-order').value = ls.ord;
  document.getElementById('mark-correct').value = ls.mc;
  document.getElementById('mark-neg').value   = ls.mn;
  document.getElementById('scramble-opts').checked = ls.scramble || false;
  document.getElementById('custom-time').style.display      = ls.mode === 'custom' ? '' : 'none';
  document.getElementById('custom-time-unit').style.display = ls.mode === 'custom' ? '' : 'none';
  startQuiz();
}

// ── Flag helpers ──────────────────────────────────────────────────────────────
function toggleFlag() {
  const s = currentSession; if (!s) return;
  s.flagged[s.currentIdx] = !s.flagged[s.currentIdx];
  updateNavDots(); updateFlagBtn(); updateFlagCountLabel();
  showToast(s.flagged[s.currentIdx] ? '⭐ Flagged' : 'Unflagged');
}
function updateFlagBtn() {
  const s = currentSession; if (!s) return;
  const btn = document.getElementById('flag-btn');
  btn.classList.toggle('flagged', !!s.flagged[s.currentIdx]);
  btn.title = s.flagged[s.currentIdx] ? 'Remove flag' : 'Flag for review (*)';
}
function updateFlagCountLabel() {
  const s = currentSession; if (!s) return;
  const cnt = s.flagged.filter(Boolean).length;
  document.getElementById('flag-count-label').textContent = cnt ? cnt + ' flagged ⭐' : '';
}

// ── Navigator dots ────────────────────────────────────────────────────────────
function buildQuizNav() {
  const grid = document.getElementById('q-nav-grid'); grid.innerHTML = '';
  currentSession.questions.forEach((_, i) => {
    const d = document.createElement('div');
    d.className = 'q-dot'; d.textContent = i + 1;
    d.addEventListener('click', () => jumpTo(i));
    grid.appendChild(d);
  });
}
function updateNavDots() {
  const s = currentSession;
  document.querySelectorAll('.q-dot').forEach((d, i) => {
    d.className = 'q-dot';
    if (i === s.currentIdx) d.classList.add('current');
    else if (s.answers[i] === -1) d.classList.add('skipped');
    else if (s.answers[i] !== null) d.classList.add(s.answers[i] === s.questions[i].correct ? 'answered' : 'wrong-answered');
    if (s.flagged[i]) d.classList.add('flagged');
  });
}

// ── Render one question ───────────────────────────────────────────────────────
function renderQuestion() {
  const s = currentSession, q = s.questions[s.currentIdx], total = s.questions.length;
  const answered = s.answers.filter(a => a !== null).length;
  document.getElementById('quiz-progress-bar').style.width = ((s.currentIdx + 1) / total * 100) + '%';
  document.getElementById('quiz-meta-left').textContent = 'Q ' + (s.currentIdx + 1) + '/' + total + '  ·  Done: ' + answered;
  document.getElementById('quiz-marking-badge').innerHTML =
    '<span class="pos">+' + s.markCorrect + ' correct</span>' +
    (s.markNeg > 0 ? '<span class="neg">\u2212' + s.markNeg + ' wrong</span>' : '<span>No negative</span>');
  document.getElementById('q-tag').textContent = [q.subject, q.topic].filter(Boolean).join(' › ');
  document.getElementById('q-english').textContent = q.qEnglish || '';
  document.getElementById('q-hindi').textContent   = q.qHindi   || '';
  const hasHindi = !!q.qHindi;
  document.getElementById('hindi-divider').style.display = hasHindi ? '' : 'none';
  document.getElementById('q-hindi').style.display       = hasHindi ? '' : 'none';
  const imgEl = document.getElementById('q-image');
  if (q.imageUrl) { imgEl.src = q.imageUrl; imgEl.style.display = ''; }
  else { imgEl.src = ''; imgEl.style.display = 'none'; }
  document.getElementById('match-container').innerHTML = buildMatchHtml(q);

  const optsEn = q.optionsEnglish || [], optsHi = q.optionsHindi || [];
  const ul = document.getElementById('options-list'); ul.innerHTML = '';
  const chosen = s.answers[s.currentIdx], revealed = s.revealed[s.currentIdx];
  optsEn.forEach((opt, i) => {
    const li = document.createElement('li'); li.className = 'option-item';
    if (revealed) {
      li.classList.add('disabled');
      if (i === q.correct) li.classList.add('correct');
      else if (i === chosen && chosen !== q.correct) li.classList.add('wrong');
    } else if (i === chosen) li.classList.add('selected');
    const hiOpt = optsHi[i] || '';
    li.innerHTML = '<span class="option-letter">' + String.fromCharCode(65 + i) + '</span>' +
      '<span class="option-texts"><span class="opt-english">' + esc(opt) + '</span>' +
      (hiOpt ? '<span class="opt-hindi">' + esc(hiOpt) + '</span>' : '') + '</span>';
    if (!revealed) li.addEventListener('click', () => selectOption(i));
    ul.appendChild(li);
  });

  const expBox = document.getElementById('explanation-box');
  if (revealed) {
    document.getElementById('exp-english').textContent = q.explanationEnglish || '';
    const expHi = document.getElementById('exp-hindi');
    expHi.textContent    = q.explanationHindi || '';
    expHi.style.display  = q.explanationHindi ? '' : 'none';
    expBox.classList.add('show');
  } else expBox.classList.remove('show');

  document.getElementById('prev-btn').disabled = s.currentIdx === 0;
  const isLast = s.currentIdx === total - 1;
  const nb = document.getElementById('next-btn');
  nb.textContent = isLast ? '✓ Finish' : 'Next →';
  // Handled via central listeners in DOMContentLoaded
  const skipBtn = document.getElementById('skip-btn');
  if (revealed) { skipBtn.style.display = 'none'; }
  else if (isLast) { skipBtn.textContent = '✓ Finish'; skipBtn.style.display = ''; }
  else { skipBtn.textContent = 'Skip'; skipBtn.style.display = ''; }

  if (s.secPerQ !== null) { s.timeLeft = s.secPerQ; updateTimerDisplay(); }
  updateNavDots(); updateFlagBtn(); updateFlagCountLabel();
}

function selectOption(i) {
  const s = currentSession; if (s.revealed[s.currentIdx]) return;
  s.answers[s.currentIdx]  = i;
  s.revealed[s.currentIdx] = true;
  renderQuestion();
  if (s.currentIdx < s.questions.length - 1) setTimeout(() => goQuestion(1), 1400);
}
function goQuestion(dir) {
  const s = currentSession, next = s.currentIdx + dir;
  if (next < 0 || next >= s.questions.length) return;
  s.currentIdx = next;
  if (s.secPerQ !== null) { clearInterval(s.timerInterval); s.timeLeft = s.secPerQ; startTimer(); }
  renderQuestion();
}
function jumpTo(i) {
  const s = currentSession; s.currentIdx = i;
  if (s.secPerQ !== null) { clearInterval(s.timerInterval); s.timeLeft = s.secPerQ; startTimer(); }
  renderQuestion();
}
function skipQuestion() {
  const s = currentSession;
  if (s.answers[s.currentIdx] === null) s.answers[s.currentIdx] = -1;
  goQuestion(1);
}
function endQuizEarly() { if (confirm('End quiz now and see results?')) finishQuiz(); }

// ── Timer ─────────────────────────────────────────────────────────────────────
function startTimer() {
  const s = currentSession; if (s.secPerQ === null) return;
  clearInterval(s.timerInterval);
  s.timerInterval = setInterval(() => {
    s.timeLeft--; updateTimerDisplay();
    if (s.timeLeft <= 0) {
      clearInterval(s.timerInterval);
      if (s.answers[s.currentIdx] === null) s.answers[s.currentIdx] = -1;
      s.revealed[s.currentIdx] = true; renderQuestion();
      if (s.currentIdx < s.questions.length - 1) setTimeout(() => goQuestion(1), 1100);
      else setTimeout(finishQuiz, 1100);
    }
  }, 1000);
}
function updateTimerDisplay() {
  const s = currentSession, el = document.getElementById('quiz-timer');
  if (s.secPerQ === null) { el.style.display = 'none'; return; }
  el.style.display = '';
  const t = s.timeLeft;
  el.textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  el.className = t > s.secPerQ * .5 ? '' : t > 10 ? 'warning' : 'danger';
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || document.activeElement.isContentEditable) return;
  if (!currentSession || !document.getElementById('quiz-page').classList.contains('active')) return;
  const s = currentSession;
  if (e.key === 'ArrowRight') { e.preventDefault(); goQuestion(1);  return; }
  if (e.key === 'ArrowLeft')  { e.preventDefault(); goQuestion(-1); return; }
  if ((e.key === 's' || e.key === 'S') && !s.revealed[s.currentIdx]) { e.preventDefault(); skipQuestion(); return; }
  if (e.key === 'f' || e.key === 'F') { e.preventDefault(); endQuizEarly(); return; }
  if (e.key === '*') { e.preventDefault(); toggleFlag(); return; }
  const n = parseInt(e.key);
  if (n >= 1 && n <= 4 && !s.revealed[s.currentIdx]) {
    const opts = s.questions[s.currentIdx].optionsEnglish || [];
    if (n - 1 < opts.length) { e.preventDefault(); selectOption(n - 1); }
  }
});

// ── Finish quiz ───────────────────────────────────────────────────────────────
function finishQuiz() {
  const s = currentSession; clearInterval(s.timerInterval);
  let correct = 0, wrong = 0, skipped = 0, totalScore = 0;
  const subjectStats = {};
  const maxScore = s.questions.length * s.markCorrect;
  s.questions.forEach((q, i) => {
    const a = s.answers[i], sub = q.subject || 'Other';
    if (!subjectStats[sub]) subjectStats[sub] = { correct: 0, total: 0 };
    subjectStats[sub].total++;
    if (a === -1 || a === null) skipped++;
    else if (a === q.correct) { correct++; subjectStats[sub].correct++; totalScore += s.markCorrect; }
    else { wrong++; totalScore -= s.markNeg; }
  });
  totalScore = Math.round(Math.max(0, totalScore) * 100) / 100;
  const pct     = Math.round(correct / s.questions.length * 100);
  const elapsed = Math.round((Date.now() - s.startTime) / 1000);
  const result  = {
    date: new Date().toISOString(), total: s.questions.length,
    correct, wrong, skipped, pct, totalScore, maxScore,
    markCorrect: s.markCorrect, markNeg: s.markNeg, elapsed,
    subject: s.subject, topic: s.topic, subjectStats,
    answers: [...s.answers], flagged: [...s.flagged],
    questions: s.questions.map(q => ({
      qEnglish: q.qEnglish, qHindi: q.qHindi, imageUrl: q.imageUrl || null,
      optionsEnglish: q.optionsEnglish, optionsHindi: q.optionsHindi,
      correct: q.correct, explanationEnglish: q.explanationEnglish,
      explanationHindi: q.explanationHindi, subject: q.subject, topic: q.topic,
      matchItemsEnglish: q.matchItemsEnglish, matchItemsHindi: q.matchItemsHindi,
      matchItems: q.matchItems, matchObjects: q.matchObjects, matchObjectsHindi: q.matchObjectsHindi
    }))
  };
  quizHistory.unshift(result);
  if (quizHistory.length > 50) quizHistory = quizHistory.slice(0, 50);
  saveHistory();
  currentSession._lastResult = result;
  showPage('results-page');
}

// ── Render results ────────────────────────────────────────────────────────────
function renderResults() {
  if (!currentSession?._lastResult) return;
  const r = currentSession._lastResult;
  document.getElementById('result-pct').textContent = r.pct + '%';
  const color = r.pct >= 80 ? '#16a34a' : r.pct >= 60 ? '#4f46e5' : '#dc2626';
  document.getElementById('score-ring').style.borderColor = color;
  document.getElementById('result-pct').style.color = color;
  document.getElementById('result-heading').textContent = r.pct >= 80 ? '🎉 Excellent!' : r.pct >= 60 ? '👍 Good Job!' : '💪 Keep Practicing!';
  document.getElementById('marks-display').innerHTML = 'Score: <span>' + r.totalScore + ' / ' + r.maxScore + '</span> marks &nbsp;·&nbsp; +' + r.markCorrect + ' correct' + (r.markNeg > 0 ? ', \u2212' + r.markNeg + ' wrong' : '');
  document.getElementById('result-summary').textContent = r.correct + ' correct · ' + r.wrong + ' wrong · ' + r.skipped + ' skipped · ' + fmtTime(r.elapsed);
  document.getElementById('result-bars').innerHTML = barRow('Correct', r.correct, r.total, '#16a34a') + barRow('Wrong', r.wrong, r.total, '#dc2626') + barRow('Skipped', r.skipped, r.total, '#d97706');
  const sb = document.getElementById('result-subject-breakdown');
  sb.innerHTML = '<div class="sub-row" style="font-weight:700;font-size:.76rem;color:var(--muted)"><span>Subject</span><span style="text-align:center">Acc.</span><span style="text-align:center">Qs</span></div>';
  Object.entries(r.subjectStats).forEach(([sub, st]) => {
    const p = Math.round(st.correct / st.total * 100);
    sb.innerHTML += '<div class="sub-row"><span class="sub-name">' + esc(sub) + '</span><span class="sub-pct">' + p + '%</span><span class="sub-total">' + st.total + '</span></div>';
  });
}

function barRow(label, val, total, color) {
  const pct = total ? Math.round(val / total * 100) : 0;
  return '<div class="result-bar-row"><span class="result-bar-label">' + label + '</span>' +
    '<div class="result-bar-track"><div class="result-bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>' +
    '<span class="result-bar-count">' + val + '</span></div>';
}

function copyResults() {
  const r = currentSession?._lastResult; if (!r) { showToast('No results yet'); return; }
  const lines = [
    '📊 Quiz Results — ' + r.subject,
    '━━━━━━━━━━━━━━━━━━━━━━━',
    '🎯 Score:   ' + r.pct + '%  (' + r.totalScore + '/' + r.maxScore + ' marks)',
    '✅ Correct: ' + r.correct + '/' + r.total,
    '❌ Wrong:   ' + r.wrong,
    '⏭️ Skipped: ' + r.skipped,
    '⏱️ Time:    ' + fmtTime(r.elapsed),
  ];
  Object.entries(r.subjectStats || {}).forEach(([sub, st]) => {
    lines.push('📚 ' + sub + ': ' + Math.round(st.correct / st.total * 100) + '% (' + st.correct + '/' + st.total + ')');
  });
  navigator.clipboard.writeText(lines.join('\\n'))
    .then(() => showToast('✅ Copied to clipboard!'))
    .catch(() => showToast('❌ Copy failed'));
}

// ── Review page ───────────────────────────────────────────────────────────────
function renderReview() {
  const filterSub  = document.getElementById('review-subject').value;
  const filterType = document.getElementById('review-filter').value;
  let items = [];
  if (currentSession?._lastResult) {
    const r = currentSession._lastResult;
    r.questions.forEach((q, i) => {
      const a = r.answers[i];
      const isFlagged = r.flagged?.[i] || false;
      const status = (a === -1 || a === null) ? 'skipped' : a === q.correct ? 'correct' : 'wrong';
      items.push({ q, a, status, flagged: isFlagged });
    });
  } else {
    ALL_QUESTIONS.forEach(q => items.push({ q, a: null, status: 'unanswered', flagged: false }));
  }
  const nC = items.filter(x => x.status === 'correct').length;
  const nW = items.filter(x => x.status === 'wrong').length;
  const nS = items.filter(x => x.status === 'skipped' || x.status === 'unanswered').length;
  const nF = items.filter(x => x.flagged).length;
  document.getElementById('review-summary-bar').innerHTML =
    '<span class="rsm-pill rsm-correct">✓ ' + nC + ' correct</span>' +
    (nW ? '<span class="rsm-pill rsm-wrong">✗ ' + nW + ' wrong</span>' : '') +
    (nS ? '<span class="rsm-pill rsm-skipped">→ ' + nS + ' skipped</span>' : '') +
    (nF ? '<span class="rsm-pill rsm-flagged">⭐ ' + nF + ' flagged</span>' : '');
  if (filterSub) items = items.filter(it => it.q.subject === filterSub);
  if (filterType === 'wrong')   items = items.filter(it => it.status === 'wrong');
  else if (filterType === 'correct') items = items.filter(it => it.status === 'correct');
  else if (filterType === 'skipped') items = items.filter(it => it.status === 'skipped' || it.status === 'unanswered');
  else if (filterType === 'flagged') items = items.filter(it => it.flagged);
  const list = document.getElementById('review-list');
  list.innerHTML = items.length
    ? items.map((it, n) => reviewCard(it, n + 1)).join('')
    : '<div class="empty-state"><div class="icon">🔍</div><p>No questions match this filter.</p></div>';
}

function reviewCard({ q, a, status, flagged }, n) {
  const optsEn = q.optionsEnglish || [], optsHi = q.optionsHindi || [];
  const optRows = optsEn.map((opt, i) => {
    let cls = '';
    if (i === q.correct) cls = 'correct-opt';
    else if (a != null && a !== -1 && i === a && a !== q.correct) cls = 'user-wrong';
    const icon  = i === q.correct ? '✓' : (a != null && a !== -1 && i === a) ? '✗' : '○';
    const hiOpt = optsHi[i] || '';
    return '<div class="review-option ' + cls + '"><span style="font-weight:700;flex-shrink:0;width:22px">' + icon + String.fromCharCode(65 + i) + '</span>' +
      '<span class="option-texts"><span class="opt-english">' + esc(opt) + '</span>' + (hiOpt ? '<span class="opt-hindi">' + esc(hiOpt) + '</span>' : '') + '</span></div>';
  }).join('');
  const badgeCls = status === 'correct' ? 'badge-correct' : status === 'wrong' ? 'badge-wrong' : 'badge-skipped';
  const badgeTxt = status === 'correct' ? 'Correct'       : status === 'wrong' ? 'Wrong'       : 'Skipped';
  const subTop   = [q.subject, q.topic].filter(Boolean).join(' › ');
  return '<div class="review-q">' +
    '<div class="q-number">Q' + n + ' — ' + esc(subTop) +
    ' <span class="badge ' + badgeCls + '">' + badgeTxt + '</span>' +
    (flagged ? ' <span class="badge badge-flagged">⭐ Flagged</span>' : '') + '</div>' +
    (q.imageUrl ? '<img src="' + esc(q.imageUrl) + '" class="q-image" alt=""/>' : '') +
    '<div class="q-english">' + esc(q.qEnglish || '') + '</div>' +
    (q.qHindi ? '<div class="q-hindi">' + esc(q.qHindi) + '</div>' : '') +
    buildMatchHtml(q) + optRows +
    '<div class="review-exp-wrap">' +
    (q.explanationEnglish ? '<div class="review-exp-en">💡 ' + esc(q.explanationEnglish) + '</div>' : '') +
    (q.explanationHindi   ? '<div class="review-exp-hi">💡 ' + esc(q.explanationHindi)   + '</div>' : '') +
    '</div></div>';
}

// ── Stats page ────────────────────────────────────────────────────────────────
function renderStatsPage() {
  if (!quizHistory.length) {
    document.getElementById('stats-grid').innerHTML = '';
    document.getElementById('stats-subject').innerHTML = '<div class="empty-state"><div class="icon">📊</div><p>Take a quiz first!</p></div>';
    document.getElementById('stats-history').innerHTML = '';
    return;
  }
  const totalQ  = quizHistory.reduce((s, r) => s + r.total, 0);
  const avgPct  = Math.round(quizHistory.reduce((s, r) => s + r.pct, 0) / quizHistory.length);
  const best    = Math.max(...quizHistory.map(r => r.pct));
  const bestMk  = Math.max(...quizHistory.map(r => r.totalScore || 0));
  document.getElementById('stats-grid').innerHTML =
    '<div class="stat-card"><div class="value">' + quizHistory.length + '</div><div class="label">Sessions</div></div>' +
    '<div class="stat-card"><div class="value">' + totalQ  + '</div><div class="label">Attempted</div></div>' +
    '<div class="stat-card"><div class="value">' + avgPct  + '%</div><div class="label">Avg Accuracy</div></div>' +
    '<div class="stat-card"><div class="value">' + best    + '%</div><div class="label">Best Score</div></div>' +
    '<div class="stat-card"><div class="value">' + bestMk  + '</div><div class="label">Best Marks</div></div>';
  const subAcc = {};
  quizHistory.forEach(r => Object.entries(r.subjectStats || {}).forEach(([sub, st]) => {
    if (!subAcc[sub]) subAcc[sub] = { correct: 0, total: 0 };
    subAcc[sub].correct += st.correct; subAcc[sub].total += st.total;
  }));
  const subEl = document.getElementById('stats-subject');
  subEl.innerHTML = '<div class="sub-row" style="font-weight:700;font-size:.76rem;color:var(--muted)"><span>Subject</span><span style="text-align:center">Acc.</span><span style="text-align:center">Qs</span></div>';
  Object.entries(subAcc).sort((a, b) => b[1].total - a[1].total).forEach(([sub, st]) => {
    const p = Math.round(st.correct / st.total * 100);
    subEl.innerHTML += '<div class="sub-row"><span class="sub-name">' + esc(sub) + '</span><span class="sub-pct">' + p + '%</span><span class="sub-total">' + st.total + '</span></div>';
  });
  document.getElementById('stats-history').innerHTML = quizHistory.slice(0, 20).map(r => {
    const d   = new Date(r.date);
    const ds  = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const clr = r.pct >= 80 ? '#16a34a' : r.pct >= 60 ? '#4f46e5' : '#dc2626';
    const mk  = r.totalScore !== undefined ? ' · ' + r.totalScore + '/' + r.maxScore + ' marks' : '';
    return '<div class="history-item"><span class="h-score" style="color:' + clr + '">' + r.pct + '%</span>' +
      '<span class="h-detail">' + r.correct + '/' + r.total + mk + ' · ' + esc(r.subject) + '</span>' +
      '<span class="h-date">' + ds + '</span></div>';
  }).join('');
}

// ── Home page ─────────────────────────────────────────────────────────────────
function renderHomePage() {
  loadHistory();
  const best = quizHistory.length ? Math.max(...quizHistory.map(r => r.pct)) : null;
  const avg  = quizHistory.length ? Math.round(quizHistory.reduce((s, r) => s + r.pct, 0) / quizHistory.length) : null;
  document.getElementById('home-stats').innerHTML =
    '<div class="stat-card"><div class="value">' + ALL_QUESTIONS.length + '</div><div class="label">Questions</div></div>' +
    '<div class="stat-card"><div class="value">' + getSubjects().length + '</div><div class="label">Subjects</div></div>' +
    '<div class="stat-card"><div class="value">' + quizHistory.length  + '</div><div class="label">Sessions</div></div>' +
    (best !== null ? '<div class="stat-card"><div class="value">' + best + '%</div><div class="label">Best</div></div>' : '') +
    (avg  !== null ? '<div class="stat-card"><div class="value">' + avg  + '%</div><div class="label">Avg</div></div>'  : '');
  const ov = document.getElementById('home-overview');
  if (!quizHistory.length) {
    ov.innerHTML = '<div class="empty-state"><div class="icon">🎯</div><p>No sessions yet. Click <strong>Quiz</strong> to start!</p></div>';
  } else {
    const last  = quizHistory[0];
    const color = last.pct >= 80 ? '#16a34a' : last.pct >= 60 ? '#4f46e5' : '#dc2626';
    const mk    = last.totalScore !== undefined ? ' · <strong>' + last.totalScore + '/' + last.maxScore + ' marks</strong>' : '';
    ov.innerHTML = '<p style="font-size:.86rem;color:var(--muted);margin-bottom:10px">Last: <strong style="color:' + color + '">' + last.pct + '%</strong>' + mk + ' — ' + last.correct + '/' + last.total + ' correct</p>' +
      barRow('Correct', last.correct, last.total, '#16a34a') + barRow('Wrong', last.wrong, last.total, '#dc2626') + barRow('Skipped', last.skipped, last.total, '#d97706');
  }
  document.getElementById('home-recent').innerHTML = quizHistory.length
    ? quizHistory.slice(0, 5).map(r => {
        const color = r.pct >= 80 ? '#16a34a' : r.pct >= 60 ? '#4f46e5' : '#dc2626';
        const mk    = r.totalScore !== undefined ? ' · ' + r.totalScore + ' marks' : '';
        return '<div class="history-item"><span class="h-score" style="color:' + color + '">' + r.pct + '%</span>' +
          '<span class="h-detail">' + r.correct + '/' + r.total + mk + ' · ' + esc(r.subject) + '</span>' +
          '<span class="h-date">' + new Date(r.date).toLocaleDateString() + '</span></div>';
      }).join('')
    : '<div style="color:var(--muted);font-size:.86rem">No sessions yet.</div>';
}

function fmtTime(s) { if (!s) return '—'; const m = Math.floor(s / 60); return m > 0 ? m + 'm ' + (s % 60) + 's' : s + 's'; }

// ── Wire up all buttons via addEventListener (no inline onclick) ──────────────
document.addEventListener('DOMContentLoaded', () => {
  const on = (id, event, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, fn);
    // [L4] silent no-op — missing UI elements are non-fatal
  };

  on('tab-home', 'click', () => showPage('home'));
  on('tab-quiz', 'click', () => showPage('quiz-setup'));
  on('tab-review', 'click', () => showPage('review-page'));
  on('tab-stats', 'click', () => showPage('stats-page'));

  on('dark-btn', 'click', toggleDark);
  on('start-quiz-btn', 'click', startQuiz);
  on('finish-early-btn', 'click', endQuizEarly);
  on('prev-btn', 'click', () => goQuestion(-1));
  on('next-btn', 'click', () => {
    const s = currentSession; if (!s) return;
    if (s.currentIdx === s.questions.length - 1) finishQuiz();
    else goQuestion(1);
  });
  on('skip-btn', 'click', () => {
    const s = currentSession; if (!s) return;
    if (s.currentIdx === s.questions.length - 1) finishQuiz();
    else skipQuestion();
  });
  on('flag-btn', 'click', toggleFlag);

  on('go-review-btn', 'click', () => showPage('review-page'));
  on('retake-btn', 'click', retakeQuiz);
  on('new-quiz-btn', 'click', () => showPage('quiz-setup'));
  on('copy-results-btn', 'click', copyResults);
  on('print-btn', 'click', () => window.print());
  on('results-home-btn', 'click', () => showPage('home'));
  on('clear-history-btn', 'click', clearHistory);

  on('review-subject', 'change', renderReview);
  on('review-filter', 'change', renderReview);

  const quizMode = document.getElementById('quiz-mode');
  if (quizMode) {
    quizMode.addEventListener('change', function () {
      const show = this.value === 'custom';
      const ct = document.getElementById('custom-time');
      const cu = document.getElementById('custom-time-unit');
      if (ct) ct.style.display = show ? '' : 'none';
      if (cu) cu.style.display = show ? '' : 'none';
    });
  }

  initDark();
  loadHistory();
  populateFilters();
  renderHomePage();
});
</script>
</body>
</html>`;
}

// ════════════════════════════════════════════════════════════
//  UPLOAD PAGE  (GET /)
// ════════════════════════════════════════════════════════════
const UPLOAD_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Quiz Generator</title>
<style>
:root{--p:#4f46e5;--pd:#3730a3;--bg:#f8fafc;--s:#fff;--b:#e2e8f0;--t:#1e293b;--m:#64748b;--err:#dc2626}
body.dark{--bg:#0f172a;--s:#1e293b;--b:#334155;--t:#f1f5f9;--m:#94a3b8}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--t);min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;transition:background .2s,color .2s}
.card{background:var(--s);border:1px solid var(--b);border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);padding:36px;max-width:540px;width:100%;position:relative}
h1{color:var(--p);font-size:1.6rem;margin-bottom:5px}
.sub{color:var(--m);font-size:.88rem;margin-bottom:22px}
.dark-toggle{position:absolute;top:18px;right:18px;background:none;border:1px solid var(--b);border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center;color:var(--t);transition:.15s}
.dark-toggle:hover{background:var(--b)}
.tg-banner{background:#e7f3ff;border:1px solid #93c5fd;border-radius:10px;padding:11px 14px;font-size:.82rem;color:#1e40af;margin-bottom:18px;line-height:1.5}
body.dark .tg-banner{background:#1e3a5f;border-color:#3b82f6;color:#93c5fd}
.drop-zone{border:2px dashed var(--b);border-radius:11px;padding:32px 18px;text-align:center;cursor:pointer;transition:.2s;background:var(--bg);user-select:none}
.drop-zone:hover,.drop-zone.over{border-color:var(--p);background:#ede9fe18}
.drop-zone .icon{font-size:2.2rem;margin-bottom:8px;pointer-events:none}
.drop-zone p{color:var(--m);font-size:.88rem;pointer-events:none}
.browse-lbl{color:var(--p);font-weight:700;text-decoration:underline;cursor:pointer;pointer-events:auto}
#fi{display:none}
#file-list{margin-top:10px;text-align:left;pointer-events:auto}
.ftag{display:inline-flex;align-items:center;gap:5px;background:#ede9fe;border-radius:99px;padding:3px 10px;margin:3px;font-size:.78rem;color:var(--p)}
body.dark .ftag{background:#312e81;color:#a5b4fc}
.ftag .qcount{font-size:.72rem;opacity:.75}
.ftag button{background:none;border:none;cursor:pointer;color:var(--p);font-size:.9rem;line-height:1;padding:0;pointer-events:auto}
.merge-note{margin-top:8px;font-size:.78rem;color:var(--m);text-align:center;display:none}
.dbstats{margin-top:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}
.dbstat{background:var(--bg);border:1px solid var(--b);border-radius:9px;padding:10px;text-align:center}
.dbstat .v{font-size:1.3rem;font-weight:800;color:var(--p)}
.dbstat .l{font-size:.7rem;color:var(--m);margin-top:2px}
.btn{display:block;width:100%;background:var(--p);color:#fff;border:none;border-radius:9px;padding:12px;font-size:.95rem;font-weight:700;cursor:pointer;margin-top:18px;transition:.15s}
.btn:hover{background:var(--pd)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.error{background:#fee2e2;border:1px solid #fca5a5;color:var(--err);border-radius:7px;padding:10px 13px;font-size:.87rem;margin-top:12px;display:none}
.spinner{display:none;text-align:center;margin-top:12px;color:var(--m);font-size:.88rem}
.prog-wrap{display:none;margin-top:14px}
.prog-header{display:flex;justify-content:space-between;font-size:.78rem;color:var(--m);margin-bottom:5px}
.prog-track{background:var(--b);border-radius:99px;height:9px;overflow:hidden}
.prog-bar{height:100%;width:0%;border-radius:99px;background:linear-gradient(90deg,var(--p),#818cf8);transition:width .45s ease,background .3s}
.prog-stage{font-size:.73rem;color:var(--m);margin-top:5px;text-align:center;min-height:1em}
.fmt{margin-top:20px;background:var(--bg);border-radius:9px;padding:14px;font-size:.78rem;color:var(--m)}
.fmt code{display:block;margin-top:6px;white-space:pre;font-size:.71rem;overflow-x:auto;line-height:1.5;color:var(--m)}
footer{margin-top:20px;font-size:.75rem;color:var(--m);text-align:center}
.qbank-card{margin-top:20px;background:var(--s);border:1px solid var(--b);border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);padding:28px;max-width:540px;width:100%}
.qbank-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.qbank-hdr strong{font-size:.97rem;color:var(--t)}
.qbank-hdr span{font-size:.75rem;color:var(--m)}
.qbank-subject{background:var(--bg);border:1px solid var(--b);border-radius:9px;margin-bottom:8px;overflow:hidden}
.qbank-subj-hd{display:flex;align-items:center;justify-content:space-between;padding:10px 13px;cursor:pointer;user-select:none;font-weight:600;font-size:.86rem;color:var(--t)}
.qbank-subj-hd:hover{background:var(--b)}
.qbank-subj-hd .arrow{transition:.2s;display:inline-block;font-style:normal}
.qbank-subj-bd{padding:4px 13px 10px;display:none}
.qbank-subj-bd.open{display:block}
.qbank-topic-row{display:flex;align-items:center;justify-content:space-between;padding:5px 0;font-size:.81rem;color:var(--t);border-bottom:1px solid var(--b)}
.qbank-topic-row:last-child{border-bottom:none}
.qbank-dl-btn{background:var(--p);color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:.7rem;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0}
.qbank-dl-btn:hover{background:var(--pd)}
.qbank-empty{font-size:.83rem;color:var(--m);text-align:center;padding:10px 0}
.save-toggle{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:.84rem;color:var(--t);cursor:pointer;user-select:none}
.save-toggle input[type=checkbox]{accent-color:var(--p);width:15px;height:15px;cursor:pointer;flex-shrink:0}
.save-toggle .nosave-hint{margin-left:auto;font-size:.72rem;color:var(--m);font-style:italic;display:none}
</style>
</head>
<body>
<div class="card">
  <button class="dark-toggle" id="dk" title="Toggle dark mode">🌙</button>
  <h1>🎓 Quiz Generator</h1>
  <p class="sub">Upload one or more JSON quiz files — merge &amp; generate an interactive bilingual HTML quiz.</p>
  <div class="tg-banner">
    📱 <strong>Telegram Bot:</strong> Send your <code>.json</code> file to get the quiz instantly. Use <code>/topics</code> to browse the question bank, <code>/download Subject | Topic</code> to get a quiz, or <code>/mystats</code> for your history.
  </div>

  <input type="file" id="fi" accept=".json,.txt" multiple/>

  <div class="drop-zone" id="dz">
    <div class="icon">📂</div>
    <p>Drop files here or <label for="fi" class="browse-lbl">click to browse</label></p>
    <div id="file-list"></div>
  </div>

  <div class="merge-note" id="mn">✨ Multiple files will be merged into one quiz</div>

  <label class="save-toggle">
    <input type="checkbox" id="save-to-bank" checked/>
    <span>💾 Save to Question Bank <span style="font-weight:400;color:var(--m)">(public GitHub repo)</span></span>
    <span class="nosave-hint" id="nosave-hint">⚡ Temp mode — no GitHub sync</span>
  </label>

  <div id="dbstats-wrap"></div>
  <div class="error" id="err"></div>
  <div class="spinner" id="sp">⚙️ Reading &amp; generating quiz…</div>
  <div class="prog-wrap" id="prog-wrap">
    <div class="prog-header">
      <span id="prog-label">Processing…</span>
      <span id="prog-pct">0%</span>
    </div>
    <div class="prog-track"><div class="prog-bar" id="prog-bar"></div></div>
    <div class="prog-stage" id="prog-stage"></div>
  </div>
  <button class="btn" id="sb" disabled>⬇️ Generate &amp; Download Quiz HTML</button>

  <div class="fmt">
    <strong>JSON format:</strong>
    <code>[{
  "qEnglish":"Question?", "qHindi":"प्रश्न?",
  "optionsEnglish":["A","B","C","D"],
  "optionsHindi":["अ","ब","स","द"],
  "correct":1,
  "explanationEnglish":"…", "explanationHindi":"…",
  "subject":"Physics", "topic":"Optics",
  "imageUrl":"https://…"  // optional image
}]

Match-type extra fields:
  "matchItemsEnglish":[["A. Transparent","i. Clear water"],…],
  "matchItemsHindi":[["A. पारदर्शी","i. साफ पानी"],…]</code>
  </div>
</div>
<footer>Self-contained output · No data stored client-side · Works fully offline after download</footer>

<div class="qbank-card" id="qbank-card">
  <div class="qbank-hdr">
    <strong>📚 Question Bank</strong>
    <span id="qbank-status">Loading…</span>
  </div>
  <div id="qbank-tree"><div class="qbank-empty" style="color:var(--m)">Fetching…</div></div>
</div>

<script>
function escQ(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}

async function loadQBank(){
  const tree=document.getElementById('qbank-tree');
  const status=document.getElementById('qbank-status');
  try{
    const r=await fetch('/api/browse');
    if(!r.ok){
      if(r.status===503){document.getElementById('qbank-card').style.display='none';return;}
      throw new Error('HTTP '+r.status);
    }
    const data=await r.json();
    const structure=data.structure||{};
    const subjects=Object.keys(structure).sort();
    if(!subjects.length){
      tree.innerHTML='<div class="qbank-empty">No questions stored yet — upload a .json file to start building the bank!</div>';
      status.textContent='Empty';return;
    }
    status.textContent=subjects.length+' subject'+(subjects.length!==1?'s':'')+' · '+data.totalTopics+' topic'+(data.totalTopics!==1?'s':'');
    tree.innerHTML=subjects.map(subj=>{
      const topics=(structure[subj]||[]).sort();
      const tid='qbs-'+subj.replace(/\\W/g,'_');
      return '<div class="qbank-subject">'+
        '<div class="qbank-subj-hd" data-tid="'+tid+'">'+
          '<span>📖 '+escQ(subj)+'</span>'+
          '<span><span class="arrow" id="arr-'+tid+'">▶</span> '+topics.length+' topic'+(topics.length!==1?'s':'')+'</span>'+
        '</div>'+
        '<div class="qbank-subj-bd" id="'+tid+'">'+
          topics.map(t=>'<div class="qbank-topic-row">'+
            '<span>'+escQ(t)+'</span>'+
            '<button class="qbank-dl-btn" data-subject="'+escQ(subj)+'" data-topic="'+escQ(t)+'">⬇ Download</button>'+
          '</div>').join('')+
        '</div>'+
      '</div>';
    }).join('');

    // Wire subject toggles
    tree.querySelectorAll('.qbank-subj-hd').forEach(hd=>{
      hd.addEventListener('click',()=>{
        const id=hd.dataset.tid;
        const bd=document.getElementById(id);
        const arr=document.getElementById('arr-'+id);
        const open=bd.classList.toggle('open');
        if(arr)arr.textContent=open?'▼':'▶';
      });
    });
    // Wire download buttons
    tree.querySelectorAll('.qbank-dl-btn').forEach(btn=>{
      btn.addEventListener('click',()=>dlTopic(btn.dataset.subject,btn.dataset.topic,btn));
    });
  }catch(e){
    tree.innerHTML='<div class="qbank-empty">Could not load question bank.</div>';
    status.textContent='Error';
  }
}

async function dlTopic(subject,topic,btn){
  const orig=btn.textContent;btn.textContent='⏳';btn.disabled=true;
  try{
    const r=await fetch('/api/download?subject='+encodeURIComponent(subject)+'&topic='+encodeURIComponent(topic));
    if(!r.ok){const j=await r.json().catch(()=>({}));alert(j.error||'Download failed');return;}
    const blob=await r.blob();
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    const cd=r.headers.get('Content-Disposition')||'';
    const m=cd.match(/filename="([^"]+)"/);
    a.download=m?m[1]:subject+'_'+topic+'_quiz.html';
    a.click();URL.revokeObjectURL(url);
  }finally{btn.textContent=orig;btn.disabled=false;}
}

loadQBank();

// Dark mode
function applyDark(on){document.body.classList.toggle('dark',on);document.getElementById('dk').textContent=on?'☀️':'🌙';localStorage.setItem('qg_theme',on?'dark':'light');}
function toggleDark(){applyDark(!document.body.classList.contains('dark'));}
document.getElementById('dk').addEventListener('click',toggleDark);
(function initDark(){const s=localStorage.getItem('qg_theme');if(s==='dark')applyDark(true);else if(s==='light')applyDark(false);else if(window.matchMedia('(prefers-color-scheme:dark)').matches)applyDark(true);})();

// File handling
const dz=document.getElementById('dz'),fi=document.getElementById('fi'),
      sb=document.getElementById('sb'),fl=document.getElementById('file-list'),
      er=document.getElementById('err'),sp=document.getElementById('sp'),
      mn=document.getElementById('mn');
let selectedFiles=[],fileCounts={};

dz.addEventListener('click',e=>{
  if(e.target.tagName==='LABEL'||e.target.tagName==='BUTTON'||e.target.closest('.ftag'))return;
  fi.click();
});

function renderList(){
  fl.innerHTML=selectedFiles.map((f,i)=>
    '<span class="ftag">📄 '+f.name+
    (fileCounts[f.name]?' <span class="qcount">('+fileCounts[f.name]+'q)</span>':'')+
    ' <button data-idx="'+i+'">✕</button></span>'
  ).join('');
  // Wire remove buttons
  fl.querySelectorAll('button[data-idx]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const i=parseInt(btn.dataset.idx);
      const f=selectedFiles.splice(i,1)[0];
      delete fileCounts[f.name];
      renderList();
    });
  });
  sb.disabled=!selectedFiles.length;
  mn.style.display=selectedFiles.length>1?'block':'none';
}

async function addFiles(files){
  for(const f of Array.from(files)){
    if(selectedFiles.find(x=>x.name===f.name))continue;
    selectedFiles.push(f);
    try{const d=JSON.parse(await f.text());if(Array.isArray(d))fileCounts[f.name]=d.length;}catch(e){}
  }
  renderList();
}
fi.addEventListener('change',async()=>{await addFiles(fi.files);fi.value='';});
dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('over');});
dz.addEventListener('dragleave',()=>dz.classList.remove('over'));
dz.addEventListener('drop',async e=>{e.preventDefault();dz.classList.remove('over');await addFiles(e.dataTransfer.files);});

async function readJson(file){
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=e=>{try{const d=JSON.parse(e.target.result);if(!Array.isArray(d))throw new Error('Not a JSON array');res(d);}catch(ex){rej(new Error(file.name+': '+ex.message));}};
    r.onerror=()=>rej(new Error('Could not read '+file.name));
    r.readAsText(file,'utf-8');
  });
}

// Show/hide temp-mode hint when checkbox is toggled
const saveChk=document.getElementById('save-to-bank');
const nosaveHint=document.getElementById('nosave-hint');
saveChk.addEventListener('change',()=>{
  nosaveHint.style.display=saveChk.checked?'none':'inline';
  // [H1] textContent does not decode HTML entities — use plain & not &amp;
  sp.textContent=saveChk.checked?'⚙️ Reading & generating quiz…':'⚡ Generating temporary quiz (no GitHub sync)…';
});

// Progress bar controller
// [M3] Pass saveToBank so AI stage is hidden when save is disabled
function startProgress(saveToBank){
  const wrap=document.getElementById('prog-wrap'),bar=document.getElementById('prog-bar'),
    lbl=document.getElementById('prog-label'),pct=document.getElementById('prog-pct'),
    stg=document.getElementById('prog-stage');
  // AI + bank stages only shown when save is on
  const ALL_STAGES=[
    {p:15,l:'Reading file…',s:'⏳ Parsing questions'},
    {p:35,l:'Checking question bank…',s:'🔍 Fetching GitHub taxonomy',bankOnly:true},
    {p:62,l:'AI normalizing topics…',s:'🤖 Talking to gpt-oss-120b',bankOnly:true},
    {p:82,l:'Building quiz…',s:'⚙️ Applying topic mapping'},
    {p:95,l:'Almost there…',s:'📦 Generating HTML'},
  ];
  const STAGES=ALL_STAGES.filter(s=>!s.bankOnly||saveToBank);
  // Re-distribute percentages evenly when stages are skipped
  const n=STAGES.length;
  STAGES.forEach((s,i)=>{s.p=Math.round(15+(80/(n-1))*i)||(15+80);});
  STAGES[STAGES.length-1].p=95;
  wrap.style.display='block';bar.style.background='';
  let i=0;
  const iv=setInterval(()=>{
    if(i>=STAGES.length){clearInterval(iv);return;}
    const s=STAGES[i++];
    bar.style.width=s.p+'%';lbl.textContent=s.l;pct.textContent=s.p+'%';stg.textContent=s.s;
  },1200);
  return{
    done(){
      clearInterval(iv);bar.style.width='100%';lbl.textContent='Done!';pct.textContent='100%';
      stg.textContent='✅ Quiz ready — downloading';
      setTimeout(()=>{wrap.style.display='none';bar.style.width='0%';},2200);
    },
    fail(){
      clearInterval(iv);bar.style.background='#dc2626';bar.style.width='100%';
      lbl.textContent='Failed';stg.textContent='❌ Something went wrong';
      setTimeout(()=>{wrap.style.display='none';bar.style.background='';bar.style.width='0%';},3000);
    }
  };
}

async function generate(){
  if(!selectedFiles.length)return;
  er.style.display='none';sb.disabled=true;
  const saveToBank=saveChk.checked;
  const prog=startProgress(saveToBank); // [M3] pass flag so AI stage shows/hides
  try{
    let merged=[];
    for(const f of selectedFiles){const d=await readJson(f);merged=merged.concat(d);}
    if(!merged.length)throw new Error('No questions found in the selected files.');
    const firstName=selectedFiles[0].name.replace(/\.[^.]+$/,'');
    const outName=(selectedFiles.length===1?firstName:'merged')+'_quiz.html';
    const title=selectedFiles.length===1
      ?firstName.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())
      :'Merged Quiz ('+merged.length+' questions)';
    const blob=new Blob([JSON.stringify(merged)],{type:'application/json'});
    const fd=new FormData();
    fd.append('file',blob,selectedFiles.length===1?selectedFiles[0].name:'merged.json');
    fd.append('title',title);fd.append('outname',outName);
    fd.append('saveToGithub',saveToBank?'true':'false');
    const r=await fetch('/generate',{method:'POST',body:fd});
    if(!r.ok){const j=await r.json().catch(()=>({error:'Generation failed'}));throw new Error(j.error||'Generation failed');}
    const dlBlob=await r.blob();
    const url=URL.createObjectURL(dlBlob);
    const a=document.createElement('a');a.href=url;a.download=outName;a.click();URL.revokeObjectURL(url);
    prog.done();
  }catch(e){prog.fail();er.textContent=e.message;er.style.display='block';}
  finally{sb.disabled=!selectedFiles.length;}
}

sb.addEventListener('click',generate);

(async function loadDbStats(){
  try{
    const r=await fetch('/dbstats');if(!r.ok)return;
    const d=await r.json();if(!d||d.error)return;
    document.getElementById('dbstats-wrap').innerHTML=
      '<div style="font-size:.72rem;color:var(--m);margin-top:14px;margin-bottom:6px;font-weight:600">📊 Platform Stats</div>'+
      '<div class="dbstats">'+
      '<div class="dbstat"><div class="v">'+d.total+'</div><div class="l">Quizzes Generated</div></div>'+
      '<div class="dbstat"><div class="v">'+d.totalQuestions+'</div><div class="l">Questions Processed</div></div>'+
      '<div class="dbstat"><div class="v">'+d.tgCount+'</div><div class="l">Via Telegram</div></div>'+
      '<div class="dbstat"><div class="v">'+d.telegramUsers+'</div><div class="l">Bot Users</div></div>'+
      '</div>';
  }catch(e){}
})();
</script>
</body>
</html>`;

// ════════════════════════════════════════════════════════════
//  UTILITIES
// ════════════════════════════════════════════════════════════
function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
function okResp() {
  return new Response("OK", { headers: { "Content-Type": "text/plain" } });
}

// ════════════════════════════════════════════════════════════
//  TELEGRAM HELPERS
// ════════════════════════════════════════════════════════════
async function tgApi(token, method, payload = {}) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.json();
  } catch (e) {
    console.error(`tgApi ${method} error:`, e.message);
    return { ok: false, description: e.message };
  }
}
async function tgSend(token, chatId, text, extra = {}) {
  return tgApi(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}
async function tgGetFileUrl(token, fileId) {
  const res = await tgApi(token, "getFile", { file_id: fileId });
  const path = res?.result?.file_path;
  return path ? `https://api.telegram.org/file/bot${token}/${path}` : null;
}
async function tgSendDocument(
  token,
  chatId,
  htmlContent,
  filename,
  caption = "",
) {
  // FIX: Telegram captions are limited to 1024 characters
  const safeCaption =
    caption.length > 1024 ? caption.slice(0, 1021) + "…" : caption;
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (safeCaption) form.append("caption", safeCaption);
  form.append("parse_mode", "HTML");
  form.append(
    "document",
    new Blob([htmlContent], { type: "text/html" }),
    filename,
  );
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendDocument`,
      {
        method: "POST",
        body: form,
      },
    );
    return res.json();
  } catch (e) {
    console.error("tgSendDocument error:", e.message);
    return { ok: false, description: e.message };
  }
}

// ════════════════════════════════════════════════════════════
//  TELEGRAM WEBHOOK HANDLER
// ════════════════════════════════════════════════════════════
const WELCOME_MSG = `👋 <b>Welcome to Quiz Generator!</b>

Send me a <code>.json</code> file and I'll return a fully interactive bilingual HTML quiz — and automatically save every question to the question bank.

💡 <b>Tip:</b> To skip saving, add <code>#nosave</code> to your file's caption when sending it.

<b>Commands:</b>
/topics — Browse all subjects &amp; topics in the question bank
/download Subject | Topic — Get a quiz from stored questions
/mystats — Your personal quiz generation history
/globalstats — Platform-wide stats

<b>Quiz features:</b>
✅ Bilingual EN + हिं · 🔗 Match tables
⭐ Flag questions · ⌨️ Keyboard shortcuts
🔀 Scramble options · 🖼 Image support
🌙 Dark mode · 🏅 Custom marking

<b>JSON format:</b>
<pre>[{
  "qEnglish":"Question?",
  "qHindi":"प्रश्न?",
  "optionsEnglish":["A","B","C","D"],
  "optionsHindi":["अ","ब","स","द"],
  "correct":1,
  "explanationEnglish":"Because…",
  "subject":"Physics", "topic":"Optics"
}]</pre>`;

async function handleTelegram(request, env, ctx) {
  const token = env.TELEGRAM_TOKEN;

  // S2: Verify Telegram webhook secret token (TELEGRAM_WEBHOOK_SECRET env var)
  const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET;
  if (webhookSecret) {
    const incoming = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
    if (incoming !== webhookSecret) {
      console.warn("handleTelegram: invalid or missing webhook secret — request rejected");
      return new Response("Forbidden", { status: 403 });
    }
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return okResp();
  }

  const message = update.message || update.channel_post || {};
  const chatId = message?.chat?.id;
  if (!chatId) return okResp();

  // FIX: channel posts have no `from` field — guard safely
  const from = message.from || {};
  const username = from.username || null;
  const firstName = from.first_name || null;
  const text = message.text || "";

  if (text.startsWith("/start") || text.startsWith("/help")) {
    await tgSend(token, chatId, WELCOME_MSG);
    return okResp();
  }

  if (text.startsWith("/mystats")) {
    if (!hasDb(env)) {
      await tgSend(token, chatId, "⚠️ Database not configured on this server.");
      return okResp();
    }
    const stats = await getUserStats(env, chatId);
    if (!stats) {
      await tgSend(
        token,
        chatId,
        "📊 No stats yet — send a <code>.json</code> file to generate your first quiz!",
      );
    } else {
      await tgSend(
        token,
        chatId,
        `📊 <b>Your Stats</b>\n\n` +
          `🎓 Quizzes generated: <b>${stats.totalQuizzes}</b>\n` +
          `📅 First quiz: ${stats.firstSeen.slice(0, 10)}\n` +
          `🕐 Last quiz:  ${stats.lastSeen.slice(0, 10)}`,
      );
    }
    return okResp();
  }

  if (text.startsWith("/globalstats")) {
    if (!hasDb(env)) {
      await tgSend(token, chatId, "⚠️ Database not configured on this server.");
      return okResp();
    }
    const stats = await getDbStats(env);
    if (!stats) {
      await tgSend(
        token,
        chatId,
        "📊 No data yet — run <code>/initdb</code> first if this is a fresh deployment.",
      );
    } else {
      await tgSend(
        token,
        chatId,
        `🌍 <b>Platform Stats</b>\n\n` +
          `🎓 Total quizzes:     <b>${stats.total}</b>\n` +
          `📋 Questions handled: <b>${stats.totalQuestions}</b>\n` +
          `🌐 Via Web:      ${stats.webCount}\n` +
          `📱 Via Telegram: ${stats.tgCount}\n` +
          `👥 Bot users:    ${stats.telegramUsers}`,
      );
    }
    return okResp();
  }

  if (text.startsWith("/topics")) {
    if (!hasGithub(env)) {
      await tgSend(
        token,
        chatId,
        "⚠️ Question bank not configured on this server.",
      );
      return okResp();
    }
    await tgSend(token, chatId, "🔍 Fetching question bank…");
    const structure = await ghListTopics(env);
    if (!structure) {
      await tgSend(
        token,
        chatId,
        "📭 Question bank is empty. Send a <code>.json</code> file to start building it!",
      );
      return okResp();
    }
    const subjects = Object.keys(structure).sort();
    let msg = `📚 <b>Question Bank</b> — ${subjects.length} subject${subjects.length !== 1 ? "s" : ""}\n`;
    for (const subject of subjects) {
      const topics = structure[subject].sort();
      msg += `\n📖 <b>${escHtml(subject)}</b> (${topics.length} topic${topics.length !== 1 ? "s" : ""})\n`;
      msg += topics.map((t) => `  • ${escHtml(t)}`).join("\n") + "\n";
    }
    msg += `\n💡 <i>Use /download &lt;Subject&gt; | &lt;Topic&gt; to get a quiz</i>`;
    await tgSend(token, chatId, msg);
    return okResp();
  }

  if (text.startsWith("/download")) {
    if (!hasGithub(env)) {
      await tgSend(
        token,
        chatId,
        "⚠️ Question bank not configured on this server.",
      );
      return okResp();
    }
    const arg = text.replace(/^\/download\s*/i, "").trim();
    if (!arg) {
      await tgSend(
        token,
        chatId,
        "📥 Usage: <code>/download Subject | Topic</code>\n\nExample:\n<code>/download Physics | Optics</code>\n\nUse /topics to see available subjects and topics.",
      );
      return okResp();
    }
    let subject, topic;
    if (arg.includes("|")) {
      [subject, topic] = arg.split("|").map((s) => s.trim());
    } else {
      const parts = arg.split(/\s{2,}|\s*\|\s*/);
      if (parts.length >= 2) {
        subject = parts[0].trim();
        topic = parts.slice(1).join(" ").trim();
      } else {
        await tgSend(
          token,
          chatId,
          "❌ Please use the format: <code>/download Subject | Topic</code>",
        );
        return okResp();
      }
    }
    if (!subject || !topic) {
      await tgSend(
        token,
        chatId,
        "❌ Both subject and topic are required.\nExample: <code>/download Biology | Cell Biology</code>",
      );
      return okResp();
    }
    await tgSend(
      token,
      chatId,
      `⚙️ Fetching <b>${escHtml(subject)} › ${escHtml(topic)}</b>…`,
    );
    const questions = await ghGetQuestions(env, subject, topic);
    if (!questions || !questions.length) {
      await tgSend(
        token,
        chatId,
        `❌ No questions found for <b>${escHtml(subject)} › ${escHtml(topic)}</b>.\n\nUse /topics to see available subjects and topics.`,
      );
      return okResp();
    }
    const title = `${subject} — ${topic}`;
    const htmlOut = generateHtml(questions, title);
    const outName = `${safeName(subject)}_${safeName(topic)}_quiz.html`;
    const caption = `✅ <b>${escHtml(title)}</b>\n📋 ${questions.length} question${questions.length !== 1 ? "s" : ""} · EN + हिं\n⭐ Flag · 🔀 Scramble · 🌙 Dark mode`;
    const result = await tgSendDocument(
      token,
      chatId,
      htmlOut,
      outName,
      caption,
    );
    if (!result?.ok)
      await tgSend(
        token,
        chatId,
        `⚠️ Could not send file: ${escHtml(result?.description || "unknown error")}`,
      );
    return okResp();
  }

  // File handler
  const doc = message.document;
  if (doc) {
    const filename = doc.file_name || "quiz.json";
    const ext = filename.split(".").pop().toLowerCase();
    if (!["json", "txt"].includes(ext)) {
      await tgSend(
        token,
        chatId,
        "❌ Please send a <b>.json</b> or <b>.txt</b> file.",
      );
      return okResp();
    }

    // [H3] Reject oversized files before downloading — Telegram Bot API limit is 20 MB
    if (doc.file_size && doc.file_size > 20 * 1024 * 1024) {
      await tgSend(
        token, chatId,
        `❌ File too large (${(doc.file_size / 1024 / 1024).toFixed(1)} MB). Maximum is 20 MB.`,
      );
      return okResp();
    }

    // Opt-out: caption containing #nosave or nosave (case-insensitive)
    const caption = message.caption || "";
    const shouldSaveToRepo = !/nosave/i.test(caption);

    // Send initial status message — we will edit it in-place as stages complete
    const statusMsg = await tgSend(token, chatId, "⏳ Reading file… [▓░░░░] 20%");
    const statusMsgId = statusMsg?.result?.message_id;
    async function setStatus(text) {
      if (!statusMsgId) return;
      return tgApi(token, "editMessageText", {
        chat_id: chatId, message_id: statusMsgId, text, parse_mode: "HTML",
      });
    }

    const fileUrl = await tgGetFileUrl(token, doc.file_id);
    if (!fileUrl) {
      await setStatus("❌ Could not access your file. Please try again.");
      return okResp();
    }
    let content;
    try {
      const fileResp = await fetch(fileUrl);
      if (!fileResp.ok) throw new Error(`HTTP ${fileResp.status}`);
      content = await fileResp.text();
    } catch (e) {
      await setStatus(`❌ Failed to download the file: ${escHtml(e.message)}`);
      return okResp();
    }
    let questions;
    try {
      questions = JSON.parse(content);
    } catch (e) {
      await setStatus(`❌ Invalid JSON: ${escHtml(e.message)}`);
      return okResp();
    }
    if (!Array.isArray(questions) || !questions.length) {
      await setStatus("❌ JSON must be a non-empty array of question objects.");
      return okResp();
    }

    // [H4] Drop null/non-object/structureless entries
    questions = validateQuestions(questions);
    if (!questions.length) {
      await setStatus("❌ No valid question objects found. Each item must have a text field (qEnglish, qHindi, question, etc.).");
      return okResp();
    }

    // S6: Question count cap
    if (questions.length > 500) {
      await setStatus(`❌ Too many questions (${questions.length}). Maximum 500 per upload.`);
      return okResp();
    }

    // Stage 2 — fetch GitHub taxonomy (parallel to above work already done)
    await setStatus("🔍 Checking question bank… [▓▓░░░] 40%");
    let githubStructure = null;
    if (shouldSaveToRepo && hasGithub(env)) {
      githubStructure = await ghListTopics(env);
    }

    // Stage 3 — AI normalization
    if (shouldSaveToRepo && githubStructure) {
      await setStatus("🤖 AI normalizing topics… [▓▓▓░░] 60%");
      questions = await normalizeQuestions(env, questions, githubStructure);
    }

    // Stage 4 — build quiz
    await setStatus("⚙️ Building quiz… [▓▓▓▓░] 80%");
    const title = filename
      .replace(/\.\w+$/, "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    const htmlOut = generateHtml(questions, title);
    const outName = filename.replace(/\.\w+$/, "") + "_quiz.html";
    const saveNote = shouldSaveToRepo
      ? "\n💾 Saved to Question Bank"
      : "\n⚡ Temporary (not saved to bank)";
    const docCaption = `✅ <b>${escHtml(title)}</b>\n📋 ${questions.length} questions · EN + हिं\n⭐ Flag · ⌨️ Shortcuts · 🔀 Scramble · 🌙 Dark mode${saveNote}`;
    // [H2] Send the document first — only mark Done after we know the outcome
    const result = await tgSendDocument(
      token,
      chatId,
      htmlOut,
      outName,
      docCaption,
    );
    if (result?.ok) {
      await setStatus("✅ Done! Quiz delivered. [▓▓▓▓▓] 100%");
    } else {
      await setStatus(`❌ Quiz built but delivery failed: ${escHtml(result?.description || "unknown error")}`);
    }
    ctx.waitUntil(
      Promise.all([
        // Always track for analytics
        trackGeneration(env, {
          source: "telegram",
          title,
          questionsCount: questions.length,
          chatId,
          username,
          firstName,
        }),
        // Only save to GitHub when user has not opted out
        ...(shouldSaveToRepo
          ? [saveQuestionsToGithub(env, questions, "telegram")]
          : []),
      ]),
    );
    return okResp();
  }

  await tgSend(
    token,
    chatId,
    "📄 Send a <b>.json</b> quiz file, or type /help for instructions.",
  );
  return okResp();
}

// ════════════════════════════════════════════════════════════
//  WEBHOOK SETUP  (GET /setup)
// ════════════════════════════════════════════════════════════
async function setupWebhook(request, env) {
  // S4: Admin guard — set ADMIN_SECRET env var to lock this endpoint
  if (!isAdminAuthorized(request, env))
    return jsonResponse({ error: "Forbidden — ADMIN_SECRET required." }, 403);

  const token = env.TELEGRAM_TOKEN;
  const base = new URL(request.url).origin;
  const webhook = `${base}/telegram`;

  // S3: Register webhook secret so Telegram signs every callback
  const webhookParams = { url: webhook, allowed_updates: ["message", "channel_post"] };
  if (env.TELEGRAM_WEBHOOK_SECRET) {
    webhookParams.secret_token = env.TELEGRAM_WEBHOOK_SECRET;
  }

  const result = await tgApi(token, "setWebhook", webhookParams);
  return jsonResponse(
    {
      ok: result.ok,
      webhook,
      telegram: result.description,
      secretRegistered: !!env.TELEGRAM_WEBHOOK_SECRET,
      // [M1] Warn operators when admin protection is not enabled
      adminProtected: !!env.ADMIN_SECRET,
      warnings: [
        ...(!env.TELEGRAM_WEBHOOK_SECRET ? ["TELEGRAM_WEBHOOK_SECRET not set — webhook is unauthenticated"] : []),
        ...(!env.ADMIN_SECRET ? ["ADMIN_SECRET not set — /setup and /initdb are publicly accessible"] : []),
      ],
      note: result.ok
        ? "✅ Bot ready! Send a .json file to your bot in Telegram."
        : "❌ Failed. Check TELEGRAM_TOKEN.",
    },
    result.ok ? 200 : 500,
  );
}

// ════════════════════════════════════════════════════════════
//  WEB: POST /generate
// ════════════════════════════════════════════════════════════
async function handleGenerate(request, env, ctx) {
  // S5: Reject oversized requests before reading body
  const contentLength = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (contentLength > 10 * 1024 * 1024)
    return jsonResponse({ error: "Request too large. Maximum 10 MB per upload." }, 413);

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return jsonResponse({ error: "Could not parse form data." }, 400);
  }
  const file = formData.get("file");
  if (!file) return jsonResponse({ error: "No file uploaded." }, 400);

  const content = await file.text();

  // S5: Also guard on actual content size after reading
  if (content.length > 10 * 1024 * 1024)
    return jsonResponse({ error: "File too large. Maximum 10 MB." }, 413);

  const rawFilename = formData.get("outname") || file.name || "quiz.json";
  const filename = rawFilename.slice(0, 200); // S7: cap filename length
  const rawTitle =
    formData.get("title") ||
    filename
      .replace(/\.\w+$/, "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  const title = rawTitle.slice(0, 200); // S7: cap title to 200 chars

  let questions;
  try {
    questions = JSON.parse(content);
  } catch (e) {
    return jsonResponse({ error: `Invalid JSON: ${e.message}` }, 400);
  }
  if (!Array.isArray(questions) || !questions.length)
    return jsonResponse({ error: "JSON must be a non-empty array." }, 400);

  // [H4] Drop null/non-object/structureless entries before any further processing
  questions = validateQuestions(questions);
  if (!questions.length)
    return jsonResponse({ error: "No valid question objects found. Each item must have qEnglish, qHindi, question, text, or q field." }, 400);

  // S6: Question count cap
  if (questions.length > 500)
    return jsonResponse({ error: "Too many questions. Maximum 500 per upload." }, 400);

  // Parse opt-out flag — FormData sends strings; anything other than the
  // explicit string "false" keeps saving enabled (default-on behaviour).
  const shouldSaveToRepo = (formData.get("saveToGithub") ?? "true") !== "false";

  // AI topic normalization — fetch GitHub taxonomy then normalize
  let normalizedQuestions = questions;
  if (shouldSaveToRepo && hasGithub(env)) {
    const githubStructure = await ghListTopics(env);
    normalizedQuestions = await normalizeQuestions(env, questions, githubStructure);
  }

  const htmlOut = generateHtml(normalizedQuestions, title);
  const safeFilename = filename.endsWith(".html")
    ? filename
    : filename.replace(/\.\w+$/, "") + "_quiz.html";
  const encodedFilename = encodeURIComponent(safeFilename).replace(/'/g, "%27");

  ctx.waitUntil(
    Promise.all([
      // Always track generation for analytics
      trackGeneration(env, {
        source: "web",
        title,
        questionsCount: questions.length,
      }),
      // Only save to GitHub if the user chose to
      ...(shouldSaveToRepo
        ? [saveQuestionsToGithub(env, normalizedQuestions, "web")]
        : []),
    ]),
  );

  return new Response(htmlOut, {
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Content-Disposition": `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`,
    },
  });
}

// ════════════════════════════════════════════════════════════
//  WEB: GET /dbstats
// ════════════════════════════════════════════════════════════
async function handleDbStats(env) {
  // FIX: return 503 when DB is not configured or has no data yet
  if (!hasDb(env))
    return jsonResponse({ error: "Database not configured." }, 503);
  const stats = await getDbStats(env);
  if (!stats)
    return jsonResponse({ error: "No data yet — run /initdb first." }, 503);
  return jsonResponse(stats);
}

// ════════════════════════════════════════════════════════════
//  WEB: GET /api/browse
// ════════════════════════════════════════════════════════════
async function handleApiBrowse(env) {
  if (!hasGithub(env))
    return jsonResponse({ error: "Question bank not configured." }, 503);
  const structure = await ghListTopics(env);
  if (!structure)
    return jsonResponse({ structure: {}, subjects: 0, totalTopics: 0 });
  const subjects = Object.keys(structure).length;
  const totalTopics = Object.values(structure).reduce(
    (a, t) => a + t.length,
    0,
  );
  return jsonResponse({ structure, subjects, totalTopics });
}

// ════════════════════════════════════════════════════════════
//  WEB: GET /api/download?subject=X&topic=Y
// ════════════════════════════════════════════════════════════
async function handleApiDownload(request, env) {
  if (!hasGithub(env))
    return jsonResponse({ error: "Question bank not configured." }, 503);
  const url = new URL(request.url);
  const subject = (url.searchParams.get("subject") || "").trim();
  const topic = (url.searchParams.get("topic") || "").trim();
  if (!subject || !topic)
    return jsonResponse(
      { error: "subject and topic query params are required." },
      400,
    );
  const questions = await ghGetQuestions(env, subject, topic);
  if (!questions || !questions.length)
    return jsonResponse(
      { error: `No questions found for "${subject} › ${topic}".` },
      404,
    );
  const title = `${subject} — ${topic}`;
  const htmlOut = generateHtml(questions, title);
  const filename = `${safeName(subject)}_${safeName(topic)}_quiz.html`;
  const encodedFilename = encodeURIComponent(filename).replace(/'/g, "%27");
  return new Response(htmlOut, {
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodedFilename}`,
    },
  });
}

// ════════════════════════════════════════════════════════════
//  ENTRY POINT
// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
//  SECURITY HELPERS
// ════════════════════════════════════════════════════════════
function applySecurityHeaders(response) {
  const h = new Headers(response.headers);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  h.set("X-XSS-Protection", "1; mode=block");
  if (!h.has("Content-Security-Policy")) {
    h.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
      "img-src * data: blob:; connect-src *; frame-ancestors 'none'",
    );
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
}

function isAdminAuthorized(request, env) {
  const adminSecret = env.ADMIN_SECRET;
  if (!adminSecret) return true; // not set → open (backward compatible)
  const url = new URL(request.url);
  const qs  = url.searchParams.get("secret");
  const hdr = request.headers.get("X-Admin-Secret");
  return qs === adminSecret || hdr === adminSecret;
}

export default {
  async fetch(request, env, ctx) {
    const response = await this._handle(request, env, ctx);
    return applySecurityHeaders(response);
  },

  async _handle(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (method === "POST" && path === "/telegram")
      return env.TELEGRAM_TOKEN ? handleTelegram(request, env, ctx) : okResp();

    if (method === "GET" && path === "/setup")
      return env.TELEGRAM_TOKEN
        ? setupWebhook(request, env)
        : jsonResponse({ error: "TELEGRAM_TOKEN not set." }, 400);

    if (method === "GET" && path === "/initdb") {
      // S4: Admin guard
      if (!isAdminAuthorized(request, env))
        return jsonResponse({ error: "Forbidden — ADMIN_SECRET required." }, 403);
      if (!hasDb(env))
        return jsonResponse(
          { error: "TURSO_DB_URL and TURSO_AUTH_TOKEN not set." },
          400,
        );
      await initDb(env);
      return jsonResponse({
        ok: true,
        message: "Tables created (or already exist).",
      });
    }

    if (method === "POST" && path === "/generate")
      return handleGenerate(request, env, ctx);
    if (method === "GET" && path === "/dbstats") return handleDbStats(env);
    if (method === "GET" && path === "/api/browse") return handleApiBrowse(env);
    if (method === "GET" && path === "/api/download")
      return handleApiDownload(request, env);

    if (method === "GET" && path === "/")
      return new Response(UPLOAD_PAGE, {
        headers: { "Content-Type": "text/html; charset=UTF-8" },
      });

    return new Response("Not found", { status: 404 });
  },
};
