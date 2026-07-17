import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire('/tmp/mibbeacon-scan/');
const { chromium } = require('playwright-core');

const URL = 'http://localhost:8899/#/tools';
const EXEC = process.env.HOME + '/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/home/facuarmo/openmibcatalog_2/docs/scroll-reduction-layout-refactor/after';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickByText(page, texts, opts = {}) {
  const arr = Array.isArray(texts) ? texts : [texts];
  const res = await page.evaluate(({ arr, exact, scopeSel }) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    let root = document;
    if (scopeSel) {
      const nodes = [...document.querySelectorAll(scopeSel)];
      root = nodes.sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return rb.width * rb.height - ra.width * ra.height; })[0] || document;
    }
    const cands = [...root.querySelectorAll('div[role="button"], button, [role="button"], a, div[tabindex], span, div')];
    for (const t of arr) {
      let best = null;
      for (const el of cands) {
        const txt = norm(el.textContent);
        const match = exact ? txt === t : txt.includes(t);
        if (!match) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.bottom < 0 || r.top > window.innerHeight) continue;
        if (!best || el.textContent.length < best.el.textContent.length) best = { el, r };
      }
      if (best) return { x: best.r.left + best.r.width / 2, y: best.r.top + best.r.height / 2 };
    }
    return null;
  }, { arr, exact: opts.exact || false, scopeSel: opts.scopeSel || null });
  if (!res) return false;
  await page.mouse.click(res.x, res.y);
  return true;
}

async function dialogOpen(page) {
  return await page.evaluate(() =>
    [...document.querySelectorAll('[aria-label="Add an SNMP target"]')].some((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 100 && r.height > 100;
    })
  );
}

async function fillField(page, label, value) {
  const box = await page.evaluate((label) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const dialog = [...document.querySelectorAll('[aria-label="Add an SNMP target"]')].sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return rb.width * rb.height - ra.width * ra.height; })[0];
    if (!dialog) return null;
    const labels = [...dialog.querySelectorAll('div, span')].filter((e) => norm(e.textContent) === label && e.children.length === 0);
    for (const lab of labels) {
      let node = lab;
      for (let i = 0; i < 4 && node; i++) {
        node = node.parentElement;
        if (!node) break;
        const inp = node.querySelector('input, textarea');
        if (inp) {
          const r = inp.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
      }
    }
    return null;
  }, label);
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  await sleep(120);
  await page.keyboard.type(value, { delay: 12 });
  return true;
}

async function run(width, height) {
  const res = { width };
  const browser = await chromium.launch({ headless: true, executablePath: EXEC });
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 40; i++) {
    const has = await page.evaluate(() => (document.body.innerText || '').includes('Graphs') && (document.body.innerText || '').includes('Compare'));
    if (has) break; await sleep(500);
  }
  await sleep(1000);
  await clickByText(page, 'Graphs', { exact: true });
  await sleep(700);

  // Check 1: Escape closes
  await clickByText(page, ['Add an SNMP target', 'Add target']);
  await sleep(600);
  const open1 = await dialogOpen(page);
  await page.keyboard.press('Escape');
  await sleep(600);
  res.esc = { openedBefore: open1, closedAfter: !(await dialogOpen(page)) };

  // Check 2: backdrop click closes
  await clickByText(page, ['Add an SNMP target', 'Add target']);
  await sleep(600);
  const open2 = await dialogOpen(page);
  const pt = width <= 639 ? { x: Math.round(width / 2), y: 18 } : { x: 10, y: 10 };
  await page.mouse.click(pt.x, pt.y);
  await sleep(600);
  res.backdrop = { openedBefore: open2, point: pt, closedAfter: !(await dialogOpen(page)) };

  // Check 4 (390 only): sticky footer visible with v3+authPriv while body scrolls
  if (width <= 639) {
    await clickByText(page, ['Add an SNMP target', 'Add target']);
    await sleep(600);
    await clickByText(page, 'v3', { exact: true, scopeSel: '[aria-label="Add an SNMP target"]' });
    await sleep(400);
    await clickByText(page, 'authPriv', { exact: true, scopeSel: '[aria-label="Add an SNMP target"]' });
    await sleep(400);
    await page.evaluate(() => {
      const dialog = [...document.querySelectorAll('[aria-label="Add an SNMP target"]')].sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return rb.width * rb.height - ra.width * ra.height; })[0];
      let body = null;
      for (const d of dialog.querySelectorAll('div')) { const oy = getComputedStyle(d).overflowY; if (oy === 'auto' || oy === 'scroll') { if (!body || d.scrollHeight > body.scrollHeight) body = d; } }
      if (body) body.scrollTop = Math.round(body.scrollHeight / 3);
    });
    await sleep(400);
    res.stickyFooter = await page.evaluate(() => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const dialog = [...document.querySelectorAll('[aria-label="Add an SNMP target"]')].sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return rb.width * rb.height - ra.width * ra.height; })[0];
      let body = null;
      for (const d of dialog.querySelectorAll('div')) { const oy = getComputedStyle(d).overflowY; if (oy === 'auto' || oy === 'scroll') { if (!body || d.scrollHeight > body.scrollHeight) body = d; } }
      const btn = [...dialog.querySelectorAll('div[role="button"], button, [role="button"]')].find((e) => norm(e.textContent) === 'Save and use target');
      const r = btn ? btn.getBoundingClientRect() : null;
      return {
        bodyScrollable: body ? body.scrollHeight > body.clientHeight + 4 : false,
        bodyScrollTop: body ? Math.round(body.scrollTop) : null,
        submitY: r ? Math.round(r.top) : null,
        submitBottom: r ? Math.round(r.bottom) : null,
        submitBelowViewport: r ? Math.round(r.top) < window.innerHeight : null,
        submitVisible: r ? (r.top >= 0 && r.bottom <= window.innerHeight + 0.5) : false,
        vpH: window.innerHeight,
      };
    });
    await page.screenshot({ path: `${OUT}/interaction-sticky-footer-${width}.png` });
    await page.keyboard.press('Escape');
    await sleep(500);
  }

  // Check 3: create a real target in Graphs (v2c)
  await clickByText(page, ['Add an SNMP target', 'Add target']);
  await sleep(600);
  const nameOk = await fillField(page, 'Name', 'After Scan Target');
  const hostOk = await fillField(page, 'Host', '127.0.0.1');
  await clickByText(page, 'v2c', { exact: true, scopeSel: '[aria-label="Add an SNMP target"]' });
  await sleep(300);
  const commOk = await fillField(page, 'Community', 'public');
  await sleep(200);
  await page.screenshot({ path: `${OUT}/interaction-save-filled-${width}.png` });
  const saveClicked = await clickByText(page, ['Save and use target'], { exact: true, scopeSel: '[aria-label="Add an SNMP target"]' });
  await sleep(1500);
  const afterSave = await page.evaluate(() => {
    const txt = document.body.innerText || '';
    return {
      dialogGone: ![...document.querySelectorAll('[aria-label="Add an SNMP target"]')].some((e) => { const r = e.getBoundingClientRect(); return r.width > 100 && r.height > 100; }),
      hasTargetChip: txt.includes('After Scan Target'),
      hasConfigureSeries: /Configure the series/i.test(txt),
    };
  });
  await page.screenshot({ path: `${OUT}/interaction-save-result-${width}.png` });
  res.save = { nameOk, hostOk, commOk, saveClicked, ...afterSave };

  await ctx.close();
  await browser.close();
  return res;
}

const r390 = await run(390, 844);
const r1440 = await run(1440, 900);
const report = { r390, r1440 };
writeFileSync(`${OUT}/_tools-interactions.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
