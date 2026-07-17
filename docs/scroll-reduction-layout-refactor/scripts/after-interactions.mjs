import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire('/tmp/mibbeacon-scan/');
const { chromium } = require('playwright-core');

const BASE = 'http://localhost:8899';
const OUT = '/home/facuarmo/openmibcatalog_2/docs/scroll-reduction-layout-refactor/after';
const executablePath = process.env.HOME + '/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = {};

async function boot(page, texts) {
  for (let i = 0; i < 40; i++) {
    const found = await page.evaluate((ts) => { const b = document.body.innerText || ''; return ts.some(t => b.includes(t)); }, texts);
    if (found) return true; await sleep(300);
  }
  return false;
}
async function clickExact(page, text) {
  const loc = page.getByText(text, { exact: true });
  if (await loc.count()) { await loc.first().click(); return true; }
  return false;
}
// dialog geometry: find a dialog/overlay element
async function dialogInfo(page) {
  return page.evaluate(() => {
    const cands = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')];
    let el = cands[0];
    if (!el) {
      // heuristic: fixed/absolute element near bottom containing "Import MIB" or "Confirm"
      el = [...document.querySelectorAll('div')].find(d => {
        const t = (d.textContent || '');
        const r = d.getBoundingClientRect();
        const cs = getComputedStyle(d);
        return (cs.position === 'fixed' || cs.position === 'absolute') && r.height > 200 && r.width > 200 && /Import MIB|Confirm Set|Send Set/.test(t);
      });
    }
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height), vh: window.innerHeight, vw: window.innerWidth, anchoredBottom: Math.abs(r.bottom - window.innerHeight) < 4 };
  });
}
async function hasBackdrop(page) {
  return page.evaluate(() => {
    return [...document.querySelectorAll('div')].some(d => {
      const cs = getComputedStyle(d); const r = d.getBoundingClientRect();
      const bg = cs.backgroundColor || '';
      const m = bg.match(/rgba?\(([^)]+)\)/);
      let alpha = 1; if (m) { const p = m[1].split(',').map(s => s.trim()); alpha = p.length === 4 ? parseFloat(p[3]) : 1; }
      return (cs.position === 'fixed') && r.width >= window.innerWidth - 2 && r.height >= window.innerHeight - 2 && alpha > 0.05 && alpha < 1;
    });
  });
}

const MIB = `AFTERSCAN-MIB DEFINITIONS ::= BEGIN
IMPORTS enterprises FROM SNMPv2-SMI;
afterScan OBJECT IDENTIFIER ::= { enterprises 99999 }
END`;

async function run() {
  const browser = await chromium.launch({ headless: true, executablePath });

  // ============ 1) MOBILE MIBS DIALOG (390) ============
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#/mibs`, { waitUntil: 'load' });
    await boot(page, ['Import', 'MIB', 'Loaded']);
    await sleep(1200);
    const r = { openDialog: false, esc: {}, backdrop: {}, paste: {} };

    // open dialog
    r.openDialog = await clickExact(page, 'Import MIBs');
    await sleep(700);
    let dInfo = await dialogInfo(page);
    r.dialogInfo = dInfo;
    r.bottomSheetAnchored = dInfo?.anchoredBottom ?? false;
    // page ratio with dialog open
    r.dialogBackdropPresent = await hasBackdrop(page);
    // dialog body sections
    r.dialogHasImportFlow = await page.evaluate(() => { const b = document.body.innerText || ''; return { dropZone: /Choose files|drop files|Files, folders/i.test(b), fromUrl: /From URL/i.test(b), paste: /paste MIB/i.test(b), progress: /progress|Importing|Ready|Queued/i.test(b) }; });
    await page.screenshot({ path: `${OUT}/mibs-form-390.png` });
    // metrics json for dialog
    const pageRatio = await page.evaluate(() => { const d = [...document.querySelectorAll('div')].filter(x => x.scrollHeight > x.clientHeight + 50).sort((a, b) => b.scrollHeight - a.scrollHeight)[0]; return d ? +(d.scrollHeight / d.clientHeight).toFixed(2) : null; });
    writeFileSync(`${OUT}/mibs-form-390.json`, JSON.stringify({ screen: 'mibs-form', width: 390, dialogInfo: dInfo, bottomSheetAnchored: r.bottomSheetAnchored, backdropPresent: r.dialogBackdropPresent, importFlow: r.dialogHasImportFlow, pageRatio }, null, 2));

    // ESC closes
    await page.keyboard.press('Escape');
    await sleep(500);
    r.esc.closed = (await dialogInfo(page)) === null && !(await page.evaluate(() => /Confirm Set|From URL[\s\S]*paste MIB/i.test(document.body.innerText || '') && !!document.querySelector('[role="dialog"]')));
    r.esc.dialogGone = (await page.evaluate(() => !document.querySelector('[role="dialog"]')));

    // reopen + backdrop click closes
    await clickExact(page, 'Import MIBs');
    await sleep(600);
    r.reopened = (await page.evaluate(() => !!document.querySelector('[role="dialog"]') || /From URL/.test(document.body.innerText)));
    // click backdrop top-left corner (outside sheet)
    await page.mouse.click(5, 5);
    await sleep(500);
    r.backdrop.dialogGone = (await page.evaluate(() => !document.querySelector('[role="dialog"]')));

    // ============ 2) PASTE IMPORT FLOW ============
    await clickExact(page, 'Import MIBs');
    await sleep(600);
    // find paste textarea
    const pasted = await page.evaluate((txt) => {
      const tas = [...document.querySelectorAll('textarea')];
      // prefer one near "paste MIB"
      let ta = tas.find(t => /paste/i.test((t.placeholder || '') + (t.getAttribute('aria-label') || ''))) || tas[tas.length - 1];
      if (!ta) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, txt);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, MIB);
    r.paste.textareaFilled = pasted;
    await sleep(400);
    r.paste.importClicked = await clickExact(page, 'Import pasted text');
    await sleep(2500);
    // progress inside dialog?
    r.paste.dialogAfter = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const dlgText = dlg ? dlg.innerText : '';
      return { dialogStillOpen: !!dlg, mentionsAfterscan: /AFTERSCAN/i.test(dlgText || document.body.innerText), progressWords: /import|queued|ready|done|complete|success|added|parsed|error|fail/i.test(dlgText) };
    });
    await page.screenshot({ path: `${OUT}/mibs-form-390-imported.png` });
    // close dialog
    await page.keyboard.press('Escape'); await sleep(400);
    await page.mouse.click(5, 5); await sleep(600);
    // check module list + summary status
    r.paste.afterClose = await page.evaluate(() => {
      const b = document.body.innerText || '';
      return { afterscanInList: /AFTERSCAN-MIB/i.test(b), summaryText: (b.match(/Import MIB[\s\S]{0,120}/i) || [''])[0].replace(/\s+/g, ' ').slice(0, 140) };
    });
    await page.screenshot({ path: `${OUT}/mibs-390-after-import.png` });
    report.mobileMibs = r;
    await ctx.close();
  }

  // ============ 3) DESKTOP MIBS SPLIT VIEW (1440) ============
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#/mibs`, { waitUntil: 'load' });
    await boot(page, ['Import', 'MIB', 'Loaded']);
    await sleep(1200);
    const d = { };
    // Try clicking the "Import" tab/segment to reveal inline import pane
    d.beforeClick = await page.evaluate(() => { const b = document.body.innerText || ''; return { dropZone: /Choose files|drop files|Files, folders/i.test(b), fromUrl: /From URL/i.test(b), paste: /paste MIB/i.test(b), importMibsBtn: /Import MIBs/i.test(b) }; });
    await clickExact(page, 'Import');
    await sleep(800);
    d.afterClickImport = await page.evaluate(() => {
      const b = document.body.innerText || '';
      const hasDialog = !!document.querySelector('[role="dialog"]');
      return { dropZone: /Choose files|drop files|Files, folders/i.test(b), fromUrl: /From URL/i.test(b), paste: /paste MIB/i.test(b), importMibsBtn: /Import MIBs/i.test(b), hasDialog };
    });
    await page.screenshot({ path: `${OUT}/mibs-1440-import-pane.png` });
    report.desktopMibs = d;
    await ctx.close();
  }

  // ============ 4) QUERY-SET REVIEW DIALOG (390) ============
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#/results`, { waitUntil: 'load' });
    await boot(page, ['Agent', 'Operation', 'Results']);
    await sleep(1200);
    const q = {};
    // select Set
    q.setClicked = await page.evaluate(() => {
      const els = [...document.querySelectorAll('*')].filter(el => (el.textContent || '').trim() === 'Set' && [...el.childNodes].some(n => n.nodeType === 3));
      els.sort((a, b) => (a.getBoundingClientRect().width * a.getBoundingClientRect().height) - (b.getBoundingClientRect().width * b.getBoundingClientRect().height));
      if (els[0]) { els[0].click(); return true; } return false;
    });
    await sleep(700);
    // find Review Set request button state
    q.reviewBtn = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button,[role="button"]')].filter(e => /Review Set request/i.test((e.textContent || '').trim()));
      if (!btns.length) return null;
      const el = btns[0]; const cs = getComputedStyle(el);
      const disabled = el.disabled === true || el.getAttribute('aria-disabled') === 'true' || el.getAttribute('disabled') !== null || cs.pointerEvents === 'none' || parseFloat(cs.opacity) < 0.5;
      return { disabled, opacity: cs.opacity };
    });
    if (q.reviewBtn && !q.reviewBtn.disabled) {
      // scroll into view & click
      const clicked = await page.evaluate(() => {
        const el = [...document.querySelectorAll('button,[role="button"]')].find(e => /Review Set request/i.test((e.textContent || '').trim()));
        if (el) { el.scrollIntoView({ block: 'center' }); el.click(); return true; } return false;
      });
      await sleep(700);
      const dInfo = await dialogInfo(page);
      q.dialogOpened = !!dInfo || (await page.evaluate(() => /Confirm Set request/i.test(document.body.innerText || '')));
      q.dialogInfo = dInfo;
      q.confirmContent = await page.evaluate(() => { const b = document.body.innerText || ''; return { title: /Confirm Set request/i.test(b), writePill: /WRITE/i.test(b), sendSet: /Send Set/i.test(b), cancel: /Cancel/i.test(b) }; });
      q.footerSendVisible = await page.evaluate(() => {
        const el = [...document.querySelectorAll('button,[role="button"]')].find(e => /Send Set/i.test((e.textContent || '').trim()));
        if (!el) return false; const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight + 1 && r.height > 0;
      });
      if (q.dialogOpened) await page.screenshot({ path: `${OUT}/query-set-form-390.png` });
      // Esc close
      await page.keyboard.press('Escape'); await sleep(500);
      q.escClosed = await page.evaluate(() => !/Confirm Set request/i.test(document.body.innerText || '') || !document.querySelector('[role="dialog"]'));
      // reopen + backdrop
      await page.evaluate(() => { const el = [...document.querySelectorAll('button,[role="button"]')].find(e => /Review Set request/i.test((e.textContent || '').trim())); if (el) el.click(); });
      await sleep(600);
      await page.mouse.click(5, 5); await sleep(500);
      q.backdropClosed = await page.evaluate(() => !document.querySelector('[role="dialog"]'));
    } else {
      q.note = 'Review Set request button disabled (no valid agent/OID staged) — dialog open skipped';
    }
    report.querySet = q;
    await ctx.close();
  }

  await browser.close();
  writeFileSync(`${OUT}/_interactions.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
run();
