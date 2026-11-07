import { randomBytes } from "node:crypto";
import { publisherConfig } from "@/lib/publisher/config";
import { mediaHost } from "@/lib/publisher/hosting";
import { dayHeading as dayLabel, draftThreadsLabel, slotLabel } from "@/lib/x-drafts/display";
import type { XDraftsState } from "@/lib/x-drafts/types";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function newPhoneKey(): string {
  return randomBytes(18).toString("base64url");
}

export function phoneKeyPath(key: string): string {
  return `x-drafts/${key}/index.html`;
}

export function renderPhonePage(state: XDraftsState, input: { today: string; timeZone: string; generatedAt: Date }): string {
  const upcoming = state.drafts.filter((draft) => draft.batchDate >= input.today && draft.status !== "dismissed");
  const days = [...new Set(upcoming.map((draft) => draft.batchDate))].sort();
  const sections = days
    .map((date) => {
      const cards = upcoming
        .filter((draft) => draft.batchDate === date)
        .sort((a, b) => a.slot - b.slot)
        .map((draft) => {
          const reply = draft.reply ? `<p class="reply"><b>Reply under it:</b> ${escapeHtml(draft.reply)}</p>` : "";
          return `<article data-id="${escapeHtml(draft.id)}">
<header><span class="slot">${slotLabel(draft.time)} on X</span><span class="meta">${escapeHtml(draftThreadsLabel(draft, input.timeZone))}</span></header>
<pre>${escapeHtml(draft.text)}</pre>${reply}
<div class="row"><button class="copy">Copy</button><button class="done">Posted on X</button></div>
</article>`;
        })
        .join("\n");
      return `<h2>${escapeHtml(dayLabel(date))}</h2>\n${cards}`;
    })
    .join("\n");
  const empty = days.length ? "" : "<p>No drafts waiting. New ones are written every evening.</p>";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>X drafts</title>
<style>
:root{--bg:#f6f6f4;--card:#fff;--fg:#151515;--muted:#666;--line:#e3e3df;--accent:#1d6fe0}
@media (prefers-color-scheme:dark){:root{--bg:#111;--card:#1b1b1b;--fg:#eee;--muted:#9a9a9a;--line:#2c2c2c;--accent:#5b9bff}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;padding:16px}
main{max-width:640px;margin:0 auto}h1{font-size:22px;margin:4px 0}h2{font-size:15px;color:var(--muted);margin:24px 0 8px;text-transform:uppercase;letter-spacing:.04em}
.sub{color:var(--muted);font-size:13px;margin:0 0 8px}
article{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin:0 0 12px}
article.posted{opacity:.45}
header{display:flex;justify-content:space-between;gap:8px;font-size:13px;margin-bottom:8px}.slot{font-weight:600}.meta{color:var(--muted);text-align:right}
pre{white-space:pre-wrap;word-wrap:break-word;font:inherit;margin:0}
.reply{font-size:14px;color:var(--muted);margin:10px 0 0}
.row{display:flex;gap:8px;margin-top:12px}
button{flex:1;font:inherit;font-size:15px;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
button.copy{background:var(--accent);border-color:var(--accent);color:#fff}
</style></head><body><main>
<h1>X drafts</h1>
<p class="sub">Copy the ones you like to X. Every draft not marked "Not posting anywhere" also goes to Threads on its own. Updated ${escapeHtml(new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone, hour: "numeric", minute: "2-digit" }).format(input.generatedAt))}, ${escapeHtml(dayLabel(input.today))}.</p>
${empty}${sections}
</main>
<script>
var KEY="x-drafts-posted";
function load(){try{return JSON.parse(localStorage.getItem(KEY)||"{}")}catch(e){return {}}}
function save(v){try{localStorage.setItem(KEY,JSON.stringify(v))}catch(e){}}
var posted=load();
document.querySelectorAll("article").forEach(function(card){
  var id=card.getAttribute("data-id");
  if(posted[id])card.classList.add("posted");
  card.querySelector(".copy").addEventListener("click",function(e){
    var text=card.querySelector("pre").textContent;var b=e.currentTarget;
    function ok(){b.textContent="Copied";setTimeout(function(){b.textContent="Copy"},1500)}
    if(navigator.clipboard){navigator.clipboard.writeText(text).then(ok,function(){})}else{var t=document.createElement("textarea");t.value=text;document.body.appendChild(t);t.select();document.execCommand("copy");t.remove();ok()}
  });
  card.querySelector(".done").addEventListener("click",function(){
    posted[id]=!posted[id];save(posted);card.classList.toggle("posted",!!posted[id]);
  });
});
</script></body></html>`;
}

export function phonePageUrl(key: string): string | null {
  const base = publisherConfig().s3.publicBaseUrl?.replace(/\/+$/, "");
  return base ? `${base}/${phoneKeyPath(key)}` : null;
}

export async function uploadPhonePage(key: string, html: string): Promise<{ url?: string; error?: string }> {
  const url = phonePageUrl(key);
  const host = mediaHost();
  if (!host || !url) {
    return { error: "The phone page needs the R2 bucket's public address. Set it on the Podcast page (Public address of the bucket)." };
  }
  try {
    await host.putObjectText(phoneKeyPath(key), html, "text/html; charset=utf-8");
    return { url };
  } catch (error) {
    return { error: `The phone page could not be uploaded (${error instanceof Error ? error.message : String(error)}).` };
  }
}
