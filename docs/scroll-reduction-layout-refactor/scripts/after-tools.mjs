import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire('/tmp/mibbeacon-scan/');
const { chromium } = require('playwright-core');

const OUT = '/home/facuarmo/openmibcatalog_2/docs/scroll-reduction-layout-refactor/after';
const URL = 'http://localhost:8899/#/tools';
const EXEC = process.env.HOME + '/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';

const viewports = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Click smallest element whose text matches. scopeSel optional -> only within that element.
async function clickByText(page, texts, opts = {}) {
  const arr = Array.isArray(texts) ? texts : [texts];
  const res = await page.evaluate(({ arr, exact, scopeSel }) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    let root = document;
    if (scopeSel) {
      const nodes = [...document.querySelectorAll(scopeSel)];
      // pick the biggest (backdrop covers viewport)
      root = nodes.sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0] || document;
    }
    const candidates = [...root.querySelectorAll('div[role="button"], button, [role="button"], a, div[tabindex], span, div')];
    for (const t of arr) {
      let best = null;
      for (const el of candidates) {
        const txt = norm(el.textContent);
        const match = exact ? txt === t : txt.includes(t);
        if (!match) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.bottom < 0 || r.top > window.innerHeight) continue;
        if (!best || el.textContent.length < best.el.textContent.length) best = { el, r };
      }
      if (best) return { x: best.r.left + best.r.width / 2, y: best.r.top + best.r.height / 2, text: t };
    }
    return null;
  }, { arr, exact: opts.exact || false, scopeSel: opts.scopeSel || null });
  if (!res) return false;
  await page.mouse.click(res.x, res.y);
  return true;
}

// Page (underlying) main scroller metrics. When dialog open, exclude scrollers inside the dialog.
async function pageMetrics(page) {
  return await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[aria-label="Add an SNMP target"]')];
    const dialog = dialogs.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    })[0] || null;
    const scrollables = [...document.querySelectorAll('div')].filter(
      (d) => d.scrollHeight > d.clientHeight + 50
    );
    let main = null;
    for (const d of scrollables) {
      if (dialog && dialog.contains(d)) continue;
      if (!main || d.scrollHeight > main.scrollHeight) main = d;
    }
    const scrollHeight = main ? main.scrollHeight : document.documentElement.scrollHeight;
    const clientHeight = main ? main.clientHeight : window.innerHeight;
    return { scrollHeight, clientHeight, ratio: +(scrollHeight / clientHeight).toFixed(2) };
  });
}

// Dialog body scroller + footer submit button visibility.
async function dialogMetrics(page) {
  return await page.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const vpW = window.innerWidth, vpH = window.innerHeight;
    const dialogs = [...document.querySelectorAll('[aria-label="Add an SNMP target"]')];
    const dialog = dialogs.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    })[0] || null;
    if (!dialog) return { present: false };
    const dr = dialog.getBoundingClientRect();
    // sheet vs center: sheet card is anchored to bottom of screen (card bottom ~= vpH)
    // body scroller: div inside dialog with overflowY auto/scroll, largest scrollHeight
    let body = null;
    for (const d of dialog.querySelectorAll('div')) {
      const oy = getComputedStyle(d).overflowY;
      if (oy === 'auto' || oy === 'scroll') {
        if (!body || d.scrollHeight > body.scrollHeight) body = d;
      }
    }
    let bodyM = null;
    if (body) {
      bodyM = {
        scrollHeight: body.scrollHeight,
        clientHeight: body.clientHeight,
        scrollable: body.scrollHeight > body.clientHeight + 4,
        ratio: +(body.scrollHeight / body.clientHeight).toFixed(2),
      };
    }
    // card = the sheet: largest direct-ish descendant view; approximate with dialog child that holds heading+footer
    // footer submit button
    const labels = ['Save and use target', 'Save and add target', 'Save target'];
    let submit = null, submitText = null;
    const cands = [...dialog.querySelectorAll('div[role="button"], button, [role="button"]')];
    for (const l of labels) {
      let best = null;
      for (const el of cands) {
        if (norm(el.textContent) === l) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (!best || el.textContent.length < best.el.textContent.length) best = { el, r };
        }
      }
      if (best) { submit = best.r; submitText = l; break; }
    }
    let footerVisible = false, submitRect = null;
    if (submit) {
      submitRect = { top: Math.round(submit.top), bottom: Math.round(submit.bottom), left: Math.round(submit.left), right: Math.round(submit.right) };
      footerVisible = submit.top >= 0 && submit.bottom <= vpH + 0.5 && submit.left >= 0 && submit.right <= vpW + 0.5;
    }
    // card bottom anchor (sheet detection): find the Card = element whose rect ~ dr but with borderRadius; use dialog's first child View bottom
    const cardBottom = Math.round(dr.bottom);
    return {
      present: true,
      viewport: { w: vpW, h: vpH },
      dialogRect: { top: Math.round(dr.top), bottom: Math.round(dr.bottom), left: Math.round(dr.left), right: Math.round(dr.right), width: Math.round(dr.width), height: Math.round(dr.height) },
      body: bodyM,
      submitText,
      submitRect,
      footerSubmitVisible: footerVisible,
    };
  });
}

async function scrollTopContainer(page, to) {
  await page.evaluate((to) => {
    const scrollables = [...document.querySelectorAll('div')].filter(
      (d) => d.scrollHeight > d.clientHeight + 50
    );
    let main = null;
    for (const d of scrollables) if (!main || d.scrollHeight > main.scrollHeight) main = d;
    if (main) main.scrollTop = to === 'bottom' ? main.scrollHeight : 0;
    else window.scrollTo(0, to === 'bottom' ? document.body.scrollHeight : 0);
  }, to);
}

const sections = [
  { chip: 'Graphs', base: 'tools-graphs', form: 'tools-graphs-form' },
  { chip: 'Compare', base: 'tools-compare', form: 'tools-compare-form' },
  { chip: 'Ports', base: 'tools-ports', form: 'tools-ports-form' },
];

const summary = {};
const browser = await chromium.launch({ headless: true, executablePath: EXEC });

for (const vp of viewports) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  let ready = false;
  for (let i = 0; i < 40; i++) {
    const has = await page.evaluate(() => {
      const t = document.body.innerText || '';
      return t.includes('Graphs') && t.includes('Compare') && t.includes('Ports');
    });
    if (has) { ready = true; break; }
    await sleep(500);
  }
  await sleep(1000);
  summary[vp.width] = { ready };

  for (const s of sections) {
    const rec = {};
    try {
      const chipClicked = await clickByText(page, s.chip, { exact: true });
      rec.chipClicked = chipClicked;
      await sleep(800);

      // BASE (no dialog)
      await scrollTopContainer(page, 'top');
      await sleep(250);
      const baseM = await pageMetrics(page);
      writeFileSync(`${OUT}/${s.base}-${vp.width}.json`, JSON.stringify({ screen: s.base, width: vp.width, page: baseM }, null, 2));
      await page.screenshot({ path: `${OUT}/${s.base}-${vp.width}.png` });
      rec.base = baseM;

      // FORM: open dialog
      const opened = await clickByText(page, ['Add an SNMP target', 'Add target', 'Add a target', 'Configure a target']);
      rec.dialogOpened = opened;
      await sleep(700);
      // v3 chip inside dialog
      const v3 = await clickByText(page, 'v3', { exact: true, scopeSel: '[aria-label="Add an SNMP target"]' });
      rec.v3Clicked = v3;
      await sleep(500);
      // authPriv chip if visible
      const authPriv = await clickByText(page, ['authPriv'], { exact: true, scopeSel: '[aria-label="Add an SNMP target"]' });
      rec.authPrivClicked = authPriv;
      await sleep(500);

      const pageM = await pageMetrics(page);
      const dM = await dialogMetrics(page);
      const out = { screen: s.form, width: vp.width, page: pageM, dialog: dM };
      writeFileSync(`${OUT}/${s.form}-${vp.width}.json`, JSON.stringify(out, null, 2));
      await page.screenshot({ path: `${OUT}/${s.form}-${vp.width}.png` });
      rec.form = { pageRatio: pageM.ratio, body: dM.body, footerSubmitVisible: dM.footerSubmitVisible, present: dM.present };

      // close dialog for next section (Escape)
      await page.keyboard.press('Escape');
      await sleep(500);
    } catch (e) {
      rec.error = String(e).slice(0, 300);
      try { await page.keyboard.press('Escape'); } catch {}
      await sleep(300);
    }
    summary[vp.width][s.chip] = rec;
  }
  await ctx.close();
}

await browser.close();
writeFileSync(`${OUT}/_after-run-summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
