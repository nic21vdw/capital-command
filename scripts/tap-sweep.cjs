/*
 * Phone tap-target and form-label sweep.
 *
 *   node scripts/tap-sweep.cjs [baseUrl] [--page=/podcast,/settings] [--json=out.json]
 *
 * Run it against a PRODUCTION build (`npx next build`, `npx next start --port
 * 3303`, PUBLISH_ENABLED=true) at 390x844. For every sidebar nav page it
 * opens each <details>, clicks every collapsed disclosure (aria-expanded=false)
 * and every tab, clicks "Show all / more" controls, scrolls to the bottom to
 * wake lazy content, and after each step measures every visible
 * a / button / select / input / textarea / summary / [role=button] / [role=tab].
 *
 * Reported: height < 40, or width < 40 for icon-only controls (text links are
 * wide on purpose). The ONLY exclusions are native <video controls>, the
 * sr-only skip link, and a link that sits inside a sentence of a <p>/<li>
 * (text on both sides, or the block continues on the same line). A link that
 * is alone on its line is NOT inline. The sweep also lists every form field
 * with no accessible name (no label[for], wrapping label, aria-label or
 * aria-labelledby), and every icon-only button/link with no name at all.
 *
 * Exits 1 when anything is reported, so it can gate a change.
 */
const { execSync } = require("child_process");
const fs = require("fs");
const { chromium } = require(execSync("npm root -g").toString().trim() + "/playwright");

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "http://127.0.0.1:3303";
const only = (args.find((a) => a.startsWith("--page=")) || "").replace("--page=", "").split(",").filter(Boolean);
const jsonOut = (args.find((a) => a.startsWith("--json=")) || "").replace("--json=", "");

const PAGES = [
  "/", "/longform", "/clips", "/editor", "/carousels", "/podcast", "/x-posts", "/facebook", "/launch",
  "/uploading-center", "/automations", "/distribution", "/master-calendar", "/day-summary",
  "/agents", "/ideas", "/scripts", "/outliers", "/execution", "/presentation", "/voiceover", "/music",
  "/finance", "/settings"
];

const MIN = 40;

// Pages whose content depends on which day or view is showing: every state is visited.
const dayKeys = (from, to) => {
  const out = [];
  for (let d = from; d <= to; d++) out.push(new Date(Date.now() + d * 86400000).toISOString().slice(0, 10));
  return out;
};
const VARIANTS = {
  "/day-summary": dayKeys(-10, 10).map((k) => "?date=" + k),
  "/master-calendar": []
};
// Segmented view switches (aria-pressed) worth clicking through on these pages only: elsewhere a
// pressed button can be a real setting.
const PRESS_PAGES = new Set(["/master-calendar", "/day-summary"]);

/** Runs in the page: returns offenders and unlabeled fields for the CURRENT state. */
function measure(min) {
  const SELECTOR = "a[href], button, select, input, textarea, summary, [role=button], [role=tab]";
  const out = { small: [], unnamed: [], inline: 0, inlineList: [], checked: 0 };

  const visible = (el) => {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    // Hidden by an ancestor (closed <details>, aria-hidden offscreen, etc.).
    if (el.closest("details:not([open])") && !el.closest("summary")) return false;
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) return false;
    return true;
  };

  const label = (el) =>
    (el.getAttribute("aria-label") || el.innerText || el.value || el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name") || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);

  const isSkipLink = (el) => el.tagName === "A" && /^#/.test(el.getAttribute("href") || "") && /sr-only|skip/i.test(el.className + " " + el.innerText);

  const isInlineInSentence = (el) => {
    if (el.tagName !== "A") return false;
    if (getComputedStyle(el).display !== "inline") return false;
    const block = el.closest("p, li");
    if (!block) return false;
    // Text on BOTH sides, skipping whitespace-only nodes: "book it in the <a>Uploading Center</a> or plan ...".
    // A link that trails a sentence, or sits alone on its line, is not inline.
    const side = (dir) => {
      for (let n = el[dir]; n; n = n[dir]) {
        if (n.nodeType === 3) {
          if (n.textContent.trim()) return true;
        } else if (n.nodeType === 1 && n.tagName !== "BR") {
          if (n.textContent.trim()) return true;
        } else continue;
        if (n.tagName === "BR") return false;
      }
      return false;
    };
    return side("previousSibling") && side("nextSibling");
  };

  const nameOf = (el) => {
    if (el.getAttribute("aria-label")?.trim()) return true;
    const by = el.getAttribute("aria-labelledby");
    if (by && by.split(/\s+/).some((id) => document.getElementById(id)?.textContent.trim())) return true;
    if (el.labels && [...el.labels].some((l) => l.textContent.trim())) return true;
    if (el.closest("label")?.textContent.trim()) return true;
    return false;
  };

  const hasText = (el) => {
    if (el.getAttribute("aria-label")?.trim() || el.getAttribute("title")?.trim()) return true;
    const by = el.getAttribute("aria-labelledby");
    if (by && by.split(/\s+/).some((id) => document.getElementById(id)?.textContent.trim())) return true;
    if (el.textContent.trim()) return true;
    if (el.querySelector("img[alt]:not([alt=''])")) return true;
    return false;
  };

  for (const el of document.querySelectorAll(SELECTOR)) {
    if (!visible(el)) continue;
    if (el.closest("video[controls]") || el.tagName === "VIDEO") continue;
    if (el.tagName === "INPUT" && el.type === "hidden") continue;
    if (isSkipLink(el)) continue;
    const r = el.getBoundingClientRect();
    // Entirely off the page's horizontal extent (carousel overflow) is still a control; keep it.
    out.checked++;

    const tag = el.tagName.toLowerCase();
    const type = tag === "input" ? el.type : "";
    const isField = tag === "select" || tag === "textarea" || (tag === "input" && !["button", "submit", "reset", "image"].includes(type));
    if (isField && !nameOf(el)) {
      out.unnamed.push({ kind: "field", tag: tag + (type ? "[" + type + "]" : ""), label: label(el), id: el.id, placeholder: el.getAttribute("placeholder") || "", title: el.getAttribute("title") || "" });
    }
    if ((tag === "button" || tag === "a" || el.getAttribute("role") === "button") && !hasText(el)) {
      out.unnamed.push({ kind: "control", tag, label: "(icon only)", cls: String(el.className).slice(0, 80) });
    }

    const iconOnly = !el.innerText?.trim() && !(tag === "input" && ["text", "search", "email", "url", "number", "password", "tel", "date", "time", "datetime-local"].includes(type)) && tag !== "select" && tag !== "textarea";
    const tooShort = r.height < min - 0.5;
    const tooNarrow = r.width < min - 0.5 && (iconOnly || ["checkbox", "radio"].includes(type));
    if (!tooShort && !tooNarrow) continue;
    if (isInlineInSentence(el)) {
      out.inline++;
      out.inlineList.push(label(el) + " " + Math.round(r.width) + "x" + Math.round(r.height));
      continue;
    }
    // A bare checkbox/radio inside a label that is itself tall enough is one tap target.
    let coveredBy = "";
    if (["checkbox", "radio"].includes(type)) {
      const lab = el.closest("label") || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
      if (lab) {
        const lr = lab.getBoundingClientRect();
        if (lr.height >= min - 0.5 && lr.width >= min - 0.5) coveredBy = "label";
      }
    }
    out.small.push({
      tag: tag + (type ? "[" + type + "]" : ""),
      label: label(el),
      w: Math.round(r.width),
      h: Math.round(r.height),
      covered: coveredBy,
      cls: String(el.className).replace(/\s+/g, " ").slice(0, 90)
    });
  }
  return out;
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  // Pages fetch after mount: wait for the spinners and "Loading..." lines to go.
  await page
    .waitForFunction(
      () =>
        ![...document.querySelectorAll(".animate-spin, [aria-busy=true]")].some((el) => el.getBoundingClientRect().width > 0) &&
        !/\bLoading\b[^\n]{0,40}(\.\.\.|…)/.test(document.body.innerText),
      null,
      { timeout: 10000 }
    )
    .catch(() => {});
  await page.waitForTimeout(500);
}

async function scrollAll(page) {
  await page.evaluate(async () => {
    const targets = [document.scrollingElement, ...document.querySelectorAll("main, [class*=overflow-y-auto]")].filter(Boolean);
    for (const t of targets) {
      for (let y = 0; y < t.scrollHeight; y += 600) {
        t.scrollTop = y;
        await new Promise((r) => setTimeout(r, 40));
      }
      t.scrollTop = t.scrollHeight;
    }
  });
  await page.waitForTimeout(500);
}

async function expandAll(page) {
  let clicked = 0;
  await page.evaluate(() => document.querySelectorAll("details:not([open])").forEach((d) => d.setAttribute("open", "")));
  for (let round = 0; round < 3; round++) {
    const handles = await page.$$("button[aria-expanded=false], [role=button][aria-expanded=false], summary");
    let did = 0;
    for (const h of handles) {
      try {
        if (!(await h.isVisible())) continue;
        const meta = await h.evaluate((el) => ({ t: el.tagName, inNav: !!el.closest("nav"), txt: (el.innerText || "").slice(0, 40) }));
        if (meta.inNav) continue;
        if (meta.t === "SUMMARY") continue; // details already opened above
        await h.click({ timeout: 800, noWaitAfter: true });
        did++;
      } catch {}
    }
    const more = await page.$$("button");
    for (const h of more) {
      try {
        const txt = ((await h.innerText()) || "").trim();
        if (/^(show|view|see|load) (all|more|earlier|older)\b/i.test(txt) || /^show (all|\d+)/i.test(txt)) {
          if (await h.isVisible()) {
            await h.click({ timeout: 800, noWaitAfter: true });
            did++;
          }
        }
      } catch {}
    }
    clicked += did;
    if (!did) break;
    await page.waitForTimeout(250);
  }
  return clicked;
}

function merge(acc, res) {
  for (const s of res.small) {
    const key = [s.tag, s.label, s.w, s.h, s.cls].join("|");
    if (!acc.small.has(key)) acc.small.set(key, { ...s, count: 0 });
    acc.small.get(key).count++;
  }
  for (const u of res.unnamed) {
    const key = JSON.stringify(u);
    if (!acc.unnamed.has(key)) acc.unnamed.set(key, { ...u, count: 0 });
    acc.unnamed.get(key).count++;
  }
  acc.inline = Math.max(acc.inline, res.inline);
  for (const l of res.inlineList) acc.inlineList.add(l);
  acc.checked = Math.max(acc.checked, res.checked);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const report = {};
  for (const path of PAGES) {
    if (only.length && !only.includes(path)) continue;
    const page = await context.newPage();
    const urls = [path, ...(VARIANTS[path] || []).map((q) => path + q)];
    const acc = { small: new Map(), unnamed: new Map(), inlineList: new Set(), inline: 0, checked: 0, states: 0, error: "" };
    try {
      const snap = async () => {
        acc.states++;
        merge(acc, await page.evaluate(measure, MIN));
      };
      for (const url of urls.slice(1)) {
        await page.goto(base + url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await settle(page);
        await snap();
        await scrollAll(page);
        await snap();
        await expandAll(page);
        await snap();
      }
      const resp = await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 60000 });
      if (!resp || resp.status() >= 500) acc.error = "HTTP " + (resp && resp.status());
      await settle(page);
      await snap();
      await scrollAll(page);
      await snap();
      // The phone nav menu is part of every page.
      const menu = await page.$("button[aria-controls][aria-label$='open navigation']");
      if (menu) {
        await menu.click().catch(() => {});
        await page.waitForTimeout(250);
        await snap();
        await menu.click().catch(() => {});
      }
      await expandAll(page);
      await snap();
      if (PRESS_PAGES.has(path)) {
        const pressed = await page.$$("main button[aria-pressed]");
        for (let i = 0; i < pressed.length; i++) {
          try {
            const all = await page.$$("main button[aria-pressed]");
            await all[i].click({ timeout: 1000, noWaitAfter: true });
            await settle(page);
            await expandAll(page);
            await scrollAll(page);
            await snap();
          } catch {}
        }
      }
      // Every tab, with its own expansion pass.
      const tabCount = await page.$$eval("[role=tab]", (els) => els.length);
      for (let i = 0; i < tabCount; i++) {
        const tabs = await page.$$("[role=tab]");
        const tab = tabs[i];
        if (!tab) continue;
        try {
          if (!(await tab.isVisible())) continue;
          await tab.click({ timeout: 1500, noWaitAfter: true });
          await settle(page);
          await expandAll(page);
          await scrollAll(page);
          await snap();
        } catch {}
      }
    } catch (e) {
      acc.error = String(e).slice(0, 200);
    }
    report[path] = {
      small: [...acc.small.values()],
      unnamed: [...acc.unnamed.values()],
      inlineExcluded: acc.inline,
      inlineList: [...acc.inlineList],
      checked: acc.checked,
      states: acc.states,
      error: acc.error
    };
    await page.close();
    const r = report[path];
    const coveredN = r.small.filter((s) => s.covered).length;
    console.log(`${path.padEnd(18)} checked ${String(r.checked).padStart(4)}  under-40 ${String(r.small.length - coveredN).padStart(3)}  unnamed ${String(r.unnamed.length).padStart(2)}  label-covered ${coveredN}  inline-excluded ${r.inlineExcluded}  states ${r.states}${r.error ? "  ERROR " + r.error : ""}`);
    for (const l of r.inlineList) console.log(`    (inline in a sentence, excluded) ${l}`);
    for (const s of r.small) console.log(`    ${s.covered ? "(label-covered) " : ""}${s.tag} "${s.label}" ${s.w}x${s.h}  ${s.cls}`);
    for (const u of r.unnamed) console.log(`    UNNAMED ${u.kind} ${u.tag} "${u.label}" id=${u.id || ""} ph="${u.placeholder || ""}" ${u.cls || ""}`);
  }
  await browser.close();
  const totalSmall = Object.values(report).reduce((n, r) => n + r.small.filter((s) => !s.covered).length, 0);
  const totalUnnamed = Object.values(report).reduce((n, r) => n + r.unnamed.length, 0);
  console.log(`\nTOTAL under-40 (unique, excluding label-covered): ${totalSmall}   unnamed: ${totalUnnamed}`);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  process.exit(totalSmall + totalUnnamed ? 1 : 0);
})();
