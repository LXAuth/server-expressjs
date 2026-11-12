import { createHash } from "node:crypto";
import type { Config, ProviderCode } from "../config.js";
import { PROVIDERS } from "../oauth/providers.js";
import { ENDPOINT_GROUPS, type AuthKind, type EndpointDoc } from "./endpoints.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const AUTH_LABEL: Record<AuthKind, string> = {
  client: "Client credentials",
  session: "Session token",
  owner: "Owner (Basic)",
};

const STYLE = `
:root {
  color-scheme: dark;
  --bg: #0e1014;
  --surface: #151820;
  --surface-2: #1b1f29;
  --border: #272c38;
  --text: #e4e7ec;
  --muted: #98a1b0;
  --accent: #8ab4ff;
  --accent-ink: #0e1014;
  --code-bg: #10131a;
  --get: #7ddc9a; --post: #8ab4ff; --put: #f2c46d; --patch: #f2c46d; --delete: #ff8f8f;
  --radius: 8px;
  --font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
}
:root[data-theme="light"] {
  color-scheme: light;
  --bg: #f7f8fa;
  --surface: #ffffff;
  --surface-2: #f1f3f6;
  --border: #e1e4ea;
  --text: #161a21;
  --muted: #586274;
  --accent: #2a56d6;
  --accent-ink: #ffffff;
  --code-bg: #f3f5f8;
  --get: #17803d; --post: #2a56d6; --put: #9a6400; --patch: #9a6400; --delete: #c42b2b;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 400 16px/1.55 var(--font);
  transition: background-color 200ms ease, color 200ms ease;
}
:root:not([data-theme="light"]) body { font-weight: 380; }
a { color: var(--accent); text-underline-offset: 3px; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
code, pre { font-family: var(--mono); font-size: 13px; }
p code, li code, td code { background: var(--surface-2); padding: 2px 6px; border-radius: 4px; }
pre code { background: none; padding: 0; border-radius: 0; }
pre {
  margin: 0; padding: 16px; overflow-x: auto; line-height: 1.6;
  background: var(--code-bg); border: 1px solid var(--border); border-radius: var(--radius);
}

.topbar {
  position: sticky; top: 0; z-index: 10;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(8px); border-bottom: 1px solid var(--border);
}
.topbar-inner {
  max-width: 1120px; margin: 0 auto; padding: 16px 24px;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
}
.brand { display: flex; align-items: baseline; gap: 8px; font-weight: 600; font-size: 17px; letter-spacing: -0.01em; }
.brand small { color: var(--muted); font: 400 13px/1 var(--mono); }
.theme-toggle {
  display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
  padding: 8px 16px; border-radius: 999px; border: 1px solid var(--border);
  background: var(--surface); color: var(--text); font: 500 13px/1 var(--font);
  transition: border-color 150ms ease, background-color 150ms ease;
}
.theme-toggle:hover { border-color: var(--muted); }
.theme-toggle .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--text); box-shadow: inset -3px -1px 0 var(--bg); }

.layout { max-width: 1120px; margin: 0 auto; padding: 48px 24px 96px; display: grid; gap: 48px; }
@media (min-width: 960px) { .layout { grid-template-columns: 200px minmax(0, 1fr); } }
nav.toc { display: none; }
@media (min-width: 960px) {
  nav.toc { display: block; position: sticky; top: 96px; align-self: start; }
}
nav.toc ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
nav.toc a { display: block; padding: 4px 8px; border-radius: 4px; color: var(--muted); text-decoration: none; font-size: 14px; }
nav.toc a:hover { color: var(--text); background: var(--surface-2); }
nav.toc .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0 0 8px 8px; }

main { min-width: 0; max-width: 780px; }
h1 { font-size: 32px; line-height: 1.15; letter-spacing: -0.02em; margin: 0 0 16px; font-weight: 650; }
h2 { font-size: 22px; line-height: 1.25; letter-spacing: -0.01em; margin: 0 0 8px; font-weight: 600; }
h3 { font-size: 17px; line-height: 1.35; margin: 0; font-weight: 600; }
.lede { font-size: 17px; color: var(--muted); margin: 0 0 24px; max-width: 64ch; }
section { margin-top: 64px; scroll-margin-top: 88px; }
main > section:first-child { margin-top: 0; }
section > p { color: var(--muted); max-width: 68ch; margin: 0 0 24px; }

.pill-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 8px; }
.pill {
  display: inline-flex; align-items: center; gap: 8px; padding: 4px 12px;
  border: 1px solid var(--border); border-radius: 999px; font-size: 13px; color: var(--muted); background: var(--surface);
}
.pill b { color: var(--text); font-weight: 600; }
.status-on::before, .status-off::before { content: ""; width: 8px; height: 8px; border-radius: 50%; }
.status-on::before { background: var(--get); }
.status-off::before { border: 1px solid var(--muted); }

.cards { display: grid; gap: 16px; }
@media (min-width: 720px) { .cards { grid-template-columns: repeat(3, 1fr); } }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; }
.card h3 { margin-bottom: 8px; }
.card p { margin: 0; color: var(--muted); font-size: 15px; }
.card code { display: block; margin-top: 8px; font-size: 12px; color: var(--text); overflow-wrap: anywhere; }

ol.steps { margin: 0; padding: 0; list-style: none; counter-reset: step; display: grid; gap: 24px; }
ol.steps > li { counter-increment: step; display: grid; gap: 8px; }
ol.steps > li > span::before {
  content: counter(step); display: inline-grid; place-items: center; width: 24px; height: 24px; margin-right: 8px;
  border-radius: 50%; background: var(--accent); color: var(--accent-ink); font: 600 13px/1 var(--font);
}

.endpoint { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); margin-bottom: 16px; }
.endpoint > summary {
  list-style: none; cursor: pointer; padding: 16px; display: grid; gap: 8px;
  grid-template-columns: auto minmax(0, 1fr); align-items: baseline;
}
.endpoint > summary::-webkit-details-marker { display: none; }
.endpoint > summary:hover { background: var(--surface-2); border-radius: var(--radius); }
.endpoint[open] > summary { border-bottom: 1px solid var(--border); border-radius: var(--radius) var(--radius) 0 0; }
.method {
  font: 700 12px/1 var(--mono); letter-spacing: 0.04em; min-width: 64px; text-align: center;
  padding: 6px 8px; border-radius: 4px; border: 1px solid currentColor;
}
.m-get { color: var(--get); } .m-post { color: var(--post); } .m-put { color: var(--put); }
.m-patch { color: var(--patch); } .m-delete { color: var(--delete); }
.path { font: 500 14px/1.4 var(--mono); overflow-wrap: anywhere; }
.summary { grid-column: 2; color: var(--muted); font-size: 15px; }
.endpoint-body { padding: 16px; display: grid; gap: 16px; }
.endpoint-body h4 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 600; }
.note { margin: 0; font-size: 15px; color: var(--muted); }

table { width: 100%; border-collapse: collapse; font-size: 15px; }
th, td { text-align: left; padding: 8px 16px 8px 0; border-bottom: 1px solid var(--border); vertical-align: top; }
th { font-size: 13px; color: var(--muted); font-weight: 600; }
td:first-child { font-variant-numeric: tabular-nums; font-family: var(--mono); font-size: 14px; white-space: nowrap; }

footer { margin-top: 96px; color: var(--muted); font-size: 13px; }

@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;

// Runs in <head> so the saved theme applies before first paint. Dark is the default.
const SCRIPT = `
(function () {
  var KEY = "lxauth-theme";
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  root.dataset.theme = saved === "light" ? "light" : "dark";
  document.addEventListener("DOMContentLoaded", function () {
    var button = document.getElementById("theme-toggle");
    var label = document.getElementById("theme-label");
    function render() {
      var light = root.dataset.theme === "light";
      label.textContent = light ? "Dark theme" : "Light theme";
      button.setAttribute("aria-label", light ? "Switch to dark theme" : "Switch to light theme");
    }
    button.addEventListener("click", function () {
      root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
      try { localStorage.setItem(KEY, root.dataset.theme); } catch (e) {}
      render();
    });
    render();
  });
})();
`;

const hash = (s: string) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;

/** CSP for the page: nothing loads from anywhere, and only these exact inline blocks run. */
export const DOCS_CSP = [
  "default-src 'none'",
  `style-src ${hash(STYLE)}`,
  `script-src ${hash(SCRIPT)}`,
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

function json(value: object): string {
  return escapeHtml(JSON.stringify(value, null, 2));
}

function renderEndpoint(e: EndpointDoc): string {
  const method = e.method.toLowerCase();
  const auth =
    e.auth.length === 0 ? "None" : e.auth.map((a) => escapeHtml(AUTH_LABEL[a])).join(" + ");
  return `
<details class="endpoint">
  <summary>
    <span class="method m-${method}">${e.method}</span>
    <span class="path">${escapeHtml(e.path)}</span>
    <span class="summary">${escapeHtml(e.summary)}</span>
  </summary>
  <div class="endpoint-body">
    <div><h4>Authentication</h4><p class="note">${auth}</p></div>
    ${e.body ? `<div><h4>Request body</h4><pre><code>${json(e.body)}</code></pre></div>` : ""}
    <div><h4>Response · ${e.response.status}</h4>${
      e.response.body ? `<pre><code>${json(e.response.body)}</code></pre>` : `<p class="note">No body.</p>`
    }</div>
    ${e.notes ? `<p class="note">${escapeHtml(e.notes)}</p>` : ""}
  </div>
</details>`;
}

export function renderDocsPage(config: Config, version: string): string {
  const base = escapeHtml(config.publicBaseUrl);
  const providers = (Object.keys(PROVIDERS) as ProviderCode[])
    .map((p) => {
      const on = config.providers[p] !== undefined;
      return `<span class="pill ${on ? "status-on" : "status-off"}"><b>${PROVIDERS[p].display}</b> ${
        on ? "configured" : "not configured"
      }</span>`;
    })
    .join("");

  const toc = [
    ["overview", "Overview"],
    ["credentials", "Credentials"],
    ["quick-start", "Quick start"],
    ...ENDPOINT_GROUPS.map((g) => [g.id, g.title]),
    ["errors", "Errors"],
  ]
    .map(([id, title]) => `<li><a href="#${id}">${escapeHtml(title!)}</a></li>`)
    .join("");

  const groups = ENDPOINT_GROUPS.map(
    (g) => `
<section id="${g.id}">
  <h2>${escapeHtml(g.title)}</h2>
  <p>${escapeHtml(g.intro)}</p>
  ${g.endpoints.map(renderEndpoint).join("")}
</section>`,
  ).join("");

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>LXAuth API</title>
<style>${STYLE}</style>
<script>${SCRIPT}</script>
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <div class="brand">LXAuth API <small>v${escapeHtml(version)}</small></div>
    <button type="button" id="theme-toggle" class="theme-toggle"><span class="dot" aria-hidden="true"></span><span id="theme-label">Light theme</span></button>
  </div>
</header>
<div class="layout">
  <nav class="toc" aria-label="On this page"><p class="label">On this page</p><ol>${toc}</ol></nav>
  <main>
    <section id="overview">
      <h1>One account, every app.</h1>
      <p class="lede">LXAuth is a central account server. Your applications ask it whether a login is correct; it answers with a status and a message, never with the user's data.</p>
      <div class="pill-row"><span class="pill status-on"><b>Email</b> always on</span>${providers}</div>
    </section>

    <section id="credentials">
      <h2>Credentials</h2>
      <p>Three kinds of credentials, each sent in headers. Every unknown URL answers <code>404 {"message":"Not found"}</code>, whatever is behind it.</p>
      <div class="cards">
        <div class="card"><h3>Client credentials</h3><p>Identify your application on every login-related call. Backend only.</p><code>X-Client-Id: lxc_…<br>X-Client-Secret: lxs_…</code></div>
        <div class="card"><h3>Session token</h3><p>Returned by login. Valid only together with the client that obtained it.</p><code>Authorization: Bearer lxa_…</code></div>
        <div class="card"><h3>Owner (Basic)</h3><p>Your own email and password, used only to manage the clients you own.</p><code>Authorization: Basic base64(email:password)</code></div>
      </div>
    </section>

    <section id="quick-start">
      <h2>Quick start</h2>
      <p>From nothing to a logged-in user in four calls.</p>
      <ol class="steps">
        <li><span>Create your developer account.</span><pre><code>curl -X POST ${base}/api/v1/accounts \\
  -H 'Content-Type: application/json' \\
  -d '{"email":"you@example.com","password":"a long passphrase"}'</code></pre></li>
        <li><span>Register a client and keep its secret on your server.</span><pre><code>curl -X POST ${base}/api/v1/clients \\
  -u 'you@example.com:a long passphrase' \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"My app","redirect_uri":"https://app.example.com/linked"}'</code></pre></li>
        <li><span>Log a user in from your backend.</span><pre><code>curl -X POST ${base}/api/v1/auth/login \\
  -H 'X-Client-Id: lxc_…' -H 'X-Client-Secret: lxs_…' \\
  -H 'Content-Type: application/json' \\
  -d '{"email":"user@example.com","password":"…"}'
# 200 {"message":"Login successful","session_token":"lxa_…"}</code></pre></li>
        <li><span>Check the session on later requests.</span><pre><code>curl ${base}/api/v1/auth/session \\
  -H 'X-Client-Id: lxc_…' -H 'X-Client-Secret: lxs_…' \\
  -H 'Authorization: Bearer lxa_…'
# 200 {"message":"Session is valid"}</code></pre></li>
      </ol>
    </section>

    ${groups}

    <section id="errors">
      <h2>Errors</h2>
      <p>Every error is a JSON object with a <code>message</code>. Validation errors add an <code>errors</code> list.</p>
      <table>
        <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td>400</td><td>The body or a parameter is invalid, or contains unknown fields.</td></tr>
          <tr><td>401</td><td>Missing or wrong credentials, or an expired session. Login failures are always <code>Invalid credentials</code>.</td></tr>
          <tr><td>403</td><td>The current password given for a sensitive change is wrong.</td></tr>
          <tr><td>404</td><td>Unknown URL, or something that does not exist or is not yours.</td></tr>
          <tr><td>405</td><td>Known URL, wrong method. See the <code>Allow</code> header.</td></tr>
          <tr><td>409</td><td>The address or provider identity is already in use.</td></tr>
          <tr><td>413</td><td>The body is larger than 10 kB.</td></tr>
          <tr><td>415</td><td>A body was sent that is not <code>application/json</code>.</td></tr>
          <tr><td>429</td><td>Rate limit reached. See the <code>RateLimit</code> headers.</td></tr>
        </tbody>
      </table>
    </section>

    <footer>LXAuth server ${escapeHtml(version)} · MIT licensed</footer>
  </main>
</div>
</body>
</html>`;
}
