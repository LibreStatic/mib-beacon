import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire('/tmp/mibbeacon-scan/');
const { chromium } = require('playwright-core');

const BASE = 'http://localhost:8899';
const OUT = '/home/facuarmo/openmibcatalog_2/docs/scroll-reduction-layout-refactor/after';
mkdirSync(OUT, { recursive: true });
const exe = process.env.HOME + '/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

async function waitBoot(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  for (let i = 0; i < 40; i++) {
    const txt = await page.evaluate(() => document.body.innerText || '');
    if (txt.length > 200 && !/loading/i.test(txt.slice(0, 40))) break;
    await sleep(250);
  }
  await sleep(700);
}

async function clickText(page, text, { exact = true, which = 'last', timeout = 3000 } = {}) {
  const loc = page.getByText(text, { exact });
  const n = await loc.count();
  if (n === 0) return false;
  const target = which === 'last' ? loc.last() : loc.first();
  try { await target.click({ timeout }); return true; } catch { return false; }
}

async function pageMetrics(page) {
  return await page.evaluate(() => {
    const overlay = [...document.querySelectorAll('*')].find((el) => {
      const cs = getComputedStyle(el);
      return cs.position === 'fixed' && (parseInt(cs.zIndex) || 0) >= 100 &&
        /Cancel/.test(el.textContent || '') && el.getBoundingClientRect().width > innerWidth * 0.5;
    });
    const divs = [...document.querySelectorAll('div')].filter(
      (d) => d.scrollHeight > d.clientHeight + 30 && !(overlay && overlay.contains(d))
    );
    let main = null;
    for (const d of divs) if (!main || d.scrollHeight > main.scrollHeight) main = d;
    const scrollHeight = main ? main.scrollHeight : document.documentElement.scrollHeight;
    const clientHeight = main ? main.clientHeight : window.innerHeight;
    return { scrollHeight, clientHeight, ratio: +(scrollHeight / clientHeight).toFixed(2) };
  });
}

async function dialogInfo(page, headerReSrc) {
  return await page.evaluate((headerReSrc) => {
    const vw = innerWidth, vh = innerHeight;
    const headerRe = new RegExp(headerReSrc, 'i');
    const leaf = [...document.querySelectorAll('div,span')].filter(
      (e) => ![...e.children].some((c) => c.tagName === 'DIV' || c.tagName === 'SPAN')
    );
    const headerEl = leaf.find((e) => headerRe.test((e.textContent || '').trim()) && (e.textContent || '').trim().length < 40);
    const btns = [...document.querySelectorAll('div,button,[role="button"],span')];
    let cancelEl = null;
    for (const b of btns) { if ((b.textContent || '').trim() === 'Cancel' && b.getBoundingClientRect().width > 0) { cancelEl = b; break; } }
    if (!headerEl || !cancelEl) return { open: false };
    const primNames = ['Send trap', 'Send inform', 'Create profile', 'Save changes', 'Save', 'Send'];
    let primaryEl = null;
    for (const b of btns) { const t = (b.textContent || '').trim(); if (primNames.includes(t) && b.getBoundingClientRect().width > 0) { primaryEl = b; break; } }
    const anc = new Set(); let c = headerEl; while (c) { anc.add(c); c = c.parentElement; }
    let card = cancelEl; while (card && !anc.has(card)) card = card.parentElement;
    if (!card) card = cancelEl.parentElement;
    const cardR = card.getBoundingClientRect();
    let footer = cancelEl;
    if (primaryEl) { const a2 = new Set(); let x = cancelEl; while (x) { a2.add(x); x = x.parentElement; } let f = primaryEl; while (f && !a2.has(f)) f = f.parentElement; if (f) footer = f; }
    const footerR = footer.getBoundingClientRect();
    const divs = [...card.querySelectorAll('div')];
    let sc = null; for (const d of divs) { const o = d.scrollHeight - d.clientHeight; if (o > 10) { if (!sc || o > (sc.scrollHeight - sc.clientHeight)) sc = d; } }
    const scroller = sc
      ? { overflow: true, scrollHeight: sc.scrollHeight, clientHeight: sc.clientHeight, ratio: +(sc.scrollHeight / sc.clientHeight).toFixed(2) }
      : { overflow: false, scrollHeight: 0, clientHeight: 0, ratio: 1 };
    const primR = primaryEl ? primaryEl.getBoundingClientRect() : footerR;
    return {
      open: true, vw, vh,
      card: { top: Math.round(cardR.top), bottom: Math.round(cardR.bottom), left: Math.round(cardR.left), right: Math.round(cardR.right), width: Math.round(cardR.width), height: Math.round(cardR.height) },
      footer: { top: Math.round(footerR.top), bottom: Math.round(footerR.bottom), height: Math.round(footerR.height) },
      footerFullyVisible: footerR.bottom <= vh + 1 && footerR.top >= -1,
      primaryFullyVisible: primR.bottom <= vh + 1 && primR.top >= -1,
      scroller,
      bottomAnchored: Math.abs(cardR.bottom - vh) <= 2,
      fullWidth: Math.round(cardR.width) >= vw - 2,
    };
  }, headerReSrc);
}

async function setInputByLabel(page, label, value) {
  return await page.evaluate(({ label, value }) => {
    const overlay = [...document.querySelectorAll('*')].find((el) => {
      const cs = getComputedStyle(el);
      return cs.position === 'fixed' && (parseInt(cs.zIndex) || 0) >= 100 && /Cancel/.test(el.textContent || '') && el.getBoundingClientRect().width > innerWidth * 0.5;
    });
    const scope = overlay || document;
    const leaf = [...scope.querySelectorAll('div,span')].filter((e) => ![...e.children].some((c) => c.tagName === 'DIV' || c.tagName === 'SPAN'));
    const labels = leaf.filter((e) => (e.textContent || '').trim() === label).map((e) => e.getBoundingClientRect());
    const inputs = [...scope.querySelectorAll('input,textarea')];
    let best = null;
    for (const inp of inputs) {
      const r = inp.getBoundingClientRect();
      for (const lr of labels) {
        if (lr.bottom <= r.top + 8 && r.top - lr.bottom < 40 && lr.left >= r.left - 6 && lr.left <= r.right) {
          const d = r.top - lr.bottom;
          if (!best || d < best.d) best = { d, inp };
        }
      }
    }
    if (!best) return { ok: false, reason: 'no input for label ' + label };
    const inp = best.inp;
    const setter = Object.getOwnPropertyDescriptor(inp.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, value);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    inp.blur && inp.blur();
    return { ok: true, value: inp.value };
  }, { label, value });
}

async function isDialogOpen(page, headerReSrc) {
  return await page.evaluate((headerReSrc) => {
    const re = new RegExp(headerReSrc, 'i');
    const overlay = [...document.querySelectorAll('*')].find((el) => {
      const cs = getComputedStyle(el);
      return cs.position === 'fixed' && (parseInt(cs.zIndex) || 0) >= 100 && /Cancel/.test(el.textContent || '') && el.getBoundingClientRect().width > innerWidth * 0.5;
    });
    if (!overlay) return false;
    return re.test(overlay.textContent || '');
  }, headerReSrc);
}

// ---------- CAPTURE ----------
async function capture(browser) {
  const cap = {};
  for (const vp of VIEWPORTS) {
    const w = vp.width;
    // traps-send
    {
      const ctx = await browser.newContext({ viewport: vp });
      const page = await ctx.newPage();
      await page.goto(BASE + '/#/traps', { waitUntil: 'domcontentloaded' });
      await waitBoot(page);
      await clickText(page, 'Send', { which: 'first' });
      await sleep(700);
      await page.screenshot({ path: `${OUT}/traps-send-${w}.png` });
      const pm = await pageMetrics(page);
      writeFileSync(`${OUT}/traps-send-${w}.json`, JSON.stringify({ screen: 'traps-send', width: w, page: pm }, null, 2));
      cap[`traps-send-${w}`] = { pageRatio: pm.ratio, sh: pm.scrollHeight, ch: pm.clientHeight };
      // traps-send-form (reuse same page)
      await clickText(page, 'Compose trap', { which: 'first' });
      await sleep(1000);
      await clickText(page, 'v3', { which: 'last' });
      await sleep(700);
      const hadAuthPriv = await clickText(page, 'authPriv', { which: 'last' });
      await sleep(600);
      await page.screenshot({ path: `${OUT}/traps-send-form-${w}.png` });
      const di = await dialogInfo(page, 'compose notification');
      const pm2 = await pageMetrics(page);
      writeFileSync(`${OUT}/traps-send-form-${w}.json`, JSON.stringify({ screen: 'traps-send-form', width: w, page: pm2, dialog: di, authPrivClicked: hadAuthPriv }, null, 2));
      cap[`traps-send-form-${w}`] = { pageRatio: pm2.ratio, dialog: di, authPriv: hadAuthPriv };
      await ctx.close();
    }
    // agents
    {
      const ctx = await browser.newContext({ viewport: vp });
      const page = await ctx.newPage();
      await page.goto(BASE + '/#/agents', { waitUntil: 'domcontentloaded' });
      await waitBoot(page);
      await page.screenshot({ path: `${OUT}/agents-${w}.png` });
      const pm = await pageMetrics(page);
      writeFileSync(`${OUT}/agents-${w}.json`, JSON.stringify({ screen: 'agents', width: w, page: pm }, null, 2));
      cap[`agents-${w}`] = { pageRatio: pm.ratio, sh: pm.scrollHeight, ch: pm.clientHeight };
      // agents-form
      let opened = await clickText(page, 'New profile', { which: 'first' });
      if (!opened) opened = await clickText(page, 'Add profile', { which: 'first' });
      await sleep(1000);
      await clickText(page, 'v3', { which: 'last' });
      await sleep(700);
      await page.screenshot({ path: `${OUT}/agents-form-${w}.png` });
      const di = await dialogInfo(page, 'add profile|edit profile');
      const pm2 = await pageMetrics(page);
      writeFileSync(`${OUT}/agents-form-${w}.json`, JSON.stringify({ screen: 'agents-form', width: w, page: pm2, dialog: di }, null, 2));
      cap[`agents-form-${w}`] = { pageRatio: pm2.ratio, dialog: di };
      await ctx.close();
    }
    console.log(`captured ${w}`);
  }
  return cap;
}

// ---------- INTERACTIONS ----------
async function interactions(browser, vp) {
  const w = vp.width;
  const R = { width: w };
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();

  // TRAPS
  await page.goto(BASE + '/#/traps', { waitUntil: 'domcontentloaded' });
  await waitBoot(page);
  await clickText(page, 'Send', { which: 'first' });
  await sleep(600);
  // 1a open
  await clickText(page, 'Compose trap', { which: 'first' });
  await sleep(900);
  const open1 = await isDialogOpen(page, 'compose notification');
  // 1b escape
  await page.keyboard.press('Escape');
  await sleep(700);
  const closedEsc = !(await isDialogOpen(page, 'compose notification'));
  // 1c reopen + backdrop
  await clickText(page, 'Compose trap', { which: 'first' });
  await sleep(900);
  const reopened = await isDialogOpen(page, 'compose notification');
  const di = await dialogInfo(page, 'compose notification');
  let bx, by;
  if (di.open && di.card.top > 8) { bx = Math.round(di.vw / 2); by = Math.max(4, Math.round(di.card.top / 2)); }
  else if (di.open && di.card.left > 8) { bx = Math.round(di.card.left / 2); by = Math.round(di.vh / 2); }
  else { bx = 5; by = 5; }
  await page.mouse.click(bx, by);
  await sleep(700);
  const closedBackdrop = !(await isDialogOpen(page, 'compose notification'));
  R.trapsDialog = { open: open1, closedEsc, reopened, closedBackdrop, backdropPoint: { bx, by } };

  // 2 send trap
  await clickText(page, 'Compose trap', { which: 'first' });
  await sleep(900);
  const setHost = await setInputByLabel(page, 'Host', '127.0.0.1');
  const setPort = await setInputByLabel(page, 'Port', '30162');
  const setComm = await setInputByLabel(page, 'Community', 'public');
  await sleep(400);
  const histBefore = await page.evaluate(() => (document.body.innerText.match(/No notifications sent/) ? 'empty' : 'has-entries'));
  await clickText(page, 'Send trap', { which: 'last' });
  await sleep(1500);
  const dialogClosedAfterSend = !(await isDialogOpen(page, 'compose notification'));
  const histAfter = await page.evaluate(() => {
    const empty = /No notifications sent/.test(document.body.innerText);
    const hasHost = /127\.0\.0\.1/.test(document.body.innerText);
    return { empty, hasHost, snippet: (document.body.innerText.match(/SEND HISTORY[\s\S]{0,200}/) || [''])[0].replace(/\n/g, ' | ') };
  });
  R.trapsSend = { setHost, setPort, setComm, histBefore, dialogClosedAfterSend, histAfter };

  // AGENTS
  await page.goto(BASE + '/#/agents', { waitUntil: 'domcontentloaded' });
  await waitBoot(page);
  // 3 create
  let opened = await clickText(page, 'New profile', { which: 'first' });
  if (!opened) opened = await clickText(page, 'Add profile', { which: 'first' });
  await sleep(900);
  const openAdd = await isDialogOpen(page, 'add profile');
  const setName = await setInputByLabel(page, 'Name', 'AfterScan Agent');
  const setAHost = await setInputByLabel(page, 'Host', '127.0.0.1');
  // keep v2c (default). set community
  const setAComm = await setInputByLabel(page, 'Community', 'public');
  await sleep(400);
  await clickText(page, 'Create profile', { which: 'last' });
  await sleep(1400);
  const createClosed = !(await isDialogOpen(page, 'add profile|edit profile'));
  const rowInfo = await page.evaluate(() => {
    const bt = document.body.innerText;
    return { hasRow: /AfterScan Agent/.test(bt), noProfiles: /No saved profiles yet/.test(bt) };
  });
  R.agentsCreate = { openAdd, setName, setAHost, setAComm, createClosed, rowInfo };

  // 4 test -> result inside row
  await clickText(page, 'Test', { which: 'first' });
  await sleep(2500);
  const testResult = await page.evaluate(() => {
    // find the row containing 'AfterScan Agent'
    const all = [...document.querySelectorAll('div')];
    const rows = all.filter((d) => /AfterScan Agent/.test(d.textContent || '') && d.getBoundingClientRect().height < 400 && d.getBoundingClientRect().height > 40);
    rows.sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height);
    // pick the smallest that still contains a result keyword
    const resultRe = /(reachable|unreachable|timeout|timed out|success|succeeded|failed|error|no response|Testing|responded|ok\b|latency|ms\b)/i;
    let rowWithResult = null;
    for (const r of rows.slice().sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)) {
      if (resultRe.test(r.textContent || '')) { rowWithResult = r; break; }
    }
    const cardTitleY = (() => {
      const el = [...document.querySelectorAll('div,span')].find((e) => /SAVED AGENTS/.test((e.textContent || '').trim()) && (e.textContent || '').trim().length < 30);
      return el ? Math.round(el.getBoundingClientRect().bottom) : null;
    })();
    // The full agent row (largest row containing agent name but bounded)
    const agentRow = rows.length ? rows[rows.length - 1] : null;
    const agentRowRect = agentRow ? agentRow.getBoundingClientRect() : null;
    // find where result text sits
    const resultLeaf = [...document.querySelectorAll('div,span')].filter((e) => ![...e.children].some((c) => c.tagName === 'DIV' || c.tagName === 'SPAN'))
      .find((e) => resultRe.test((e.textContent || '').trim()) && (e.textContent || '').trim().length < 120 && e.getBoundingClientRect().width > 0);
    const resultRect = resultLeaf ? resultLeaf.getBoundingClientRect() : null;
    const insideRow = (resultRect && agentRowRect) ? (resultRect.top >= agentRowRect.top - 2 && resultRect.bottom <= agentRowRect.bottom + 60) : null;
    return {
      resultText: resultLeaf ? (resultLeaf.textContent || '').trim().slice(0, 100) : null,
      resultY: resultRect ? Math.round(resultRect.top) : null,
      agentRow: agentRowRect ? { top: Math.round(agentRowRect.top), bottom: Math.round(agentRowRect.bottom) } : null,
      insideRow,
      bodySnippet: (document.body.innerText.match(/AfterScan Agent[\s\S]{0,180}/) || [''])[0].replace(/\n/g, ' | '),
    };
  });
  R.agentsTest = testResult;

  // 5 edit -> prefilled dialog
  await clickText(page, 'Edit', { which: 'first' });
  await sleep(900);
  const editInfo = await page.evaluate(() => {
    const overlay = [...document.querySelectorAll('*')].find((el) => {
      const cs = getComputedStyle(el);
      return cs.position === 'fixed' && (parseInt(cs.zIndex) || 0) >= 100 && /Cancel/.test(el.textContent || '') && el.getBoundingClientRect().width > innerWidth * 0.5;
    });
    if (!overlay) return { open: false };
    const t = overlay.textContent || '';
    const inputs = [...overlay.querySelectorAll('input,textarea')].map((i) => i.value);
    return { open: true, hasEditTitle: /edit profile/i.test(t), hasSaveChanges: /Save changes/.test(t), prefillHasName: inputs.some((v) => /AfterScan Agent/.test(v)), prefillHasHost: inputs.some((v) => /127\.0\.0\.1/.test(v)) };
  });
  await clickText(page, 'Cancel', { which: 'last' });
  await sleep(700);
  const editClosed = !(await isDialogOpen(page, 'add profile|edit profile'));
  R.agentsEdit = { ...editInfo, cancelClosed: editClosed };

  await ctx.close();
  return R;
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: exe });
  const cap = await capture(browser);
  const int390 = await interactions(browser, { width: 390, height: 844 });
  const int1440 = await interactions(browser, { width: 1440, height: 900 });
  await browser.close();
  const report = { capture: cap, interactions: { w390: int390, w1440: int1440 } };
  writeFileSync(`${OUT}/_after-report.json`, JSON.stringify(report, null, 2));
  console.log('=== REPORT ===');
  console.log(JSON.stringify(report, null, 2));
  console.log('DONE');
}
main().catch((e) => { console.error(e); process.exit(1); });
