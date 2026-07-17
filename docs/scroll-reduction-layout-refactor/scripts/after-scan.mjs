import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire('/tmp/mibbeacon-scan/');
const { chromium } = require('playwright-core');

const BASE = 'http://localhost:8899';
const OUT = '/home/facuarmo/openmibcatalog_2/docs/scroll-reduction-layout-refactor/after';
const executablePath = process.env.HOME + '/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';

const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ==== baseline-identical collectors ====
async function collectScrollers(page) {
  return page.evaluate(() => {
    const divs = [...document.querySelectorAll('div')].filter(d => d.scrollHeight > d.clientHeight + 50);
    return divs.map(d => ({
      scrollHeight: d.scrollHeight,
      clientHeight: d.clientHeight,
      ratio: +(d.scrollHeight / d.clientHeight).toFixed(2),
      cls: (d.className || '').toString().slice(0, 40),
    })).sort((a, b) => b.scrollHeight - a.scrollHeight);
  });
}
async function collectSections(page) {
  return page.evaluate(() => {
    function scrollTopOf(el) {
      let n = el.parentElement;
      while (n) { if (n.scrollHeight > n.clientHeight + 50) return n.scrollTop; n = n.parentElement; }
      return window.scrollY || 0;
    }
    const results = []; const seen = new Set();
    const candidates = [...document.querySelectorAll('*')].filter(el => {
      const t = (el.textContent || '').trim();
      if (!t || t.length > 60) return false;
      const directText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
      return directText;
    });
    const keywords = ['import', 'url', 'paste', 'drop', 'module', 'library', 'agent', 'operation',
      'run', 'walk', 'get', 'set', 'result', 'artifact', 'progress', 'review', 'request', 'host',
      'community', 'oid', 'target', 'varbind', 'snmp', 'file', 'browse', 'loaded'];
    for (const el of candidates) {
      const t = (el.textContent || '').trim(); const low = t.toLowerCase();
      if (!keywords.some(k => low.includes(k))) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const y = Math.round(r.top + scrollTopOf(el));
      const key = t + '@' + y; if (seen.has(key)) continue; seen.add(key);
      results.push({ title: t, y });
    }
    results.sort((a, b) => a.y - b.y);
    return results;
  });
}
async function boot(page, texts) {
  for (let i = 0; i < 40; i++) {
    const found = await page.evaluate((ts) => { const b = document.body.innerText || ''; return ts.some(t => b.includes(t)); }, texts);
    if (found) return true;
    await sleep(300);
  }
  return false;
}
async function shotBottom(page, path, scrollers) {
  const main = scrollers[0];
  if (main && main.scrollHeight > main.clientHeight * 1.5) {
    await page.evaluate(() => {
      const divs = [...document.querySelectorAll('div')].filter(d => d.scrollHeight > d.clientHeight + 50);
      divs.sort((a, b) => b.scrollHeight - a.scrollHeight);
      if (divs[0]) divs[0].scrollTop = divs[0].scrollHeight;
    });
    await sleep(400);
    await page.screenshot({ path });
    await page.evaluate(() => { const d=[...document.querySelectorAll('div')].filter(x=>x.scrollHeight>x.clientHeight+50).sort((a,b)=>b.scrollHeight-a.scrollHeight)[0]; if(d) d.scrollTop=0; });
    await sleep(200);
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true, executablePath });
  const summary = {};
  for (const vp of viewports) {
    // ---- MIBS ----
    {
      const key = `mibs-${vp.width}`;
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/#/mibs`, { waitUntil: 'load' });
      const booted = await boot(page, ['Import', 'Modules', 'MIB', 'Library']);
      await sleep(1200);
      const scrollers = await collectScrollers(page);
      const sections = await collectSections(page);
      // desktop/tablet: detect inline import pane presence
      const inlineImport = await page.evaluate(() => {
        const b = document.body.innerText || '';
        return { hasDropZone: /drop files|Choose files|Files, folders/i.test(b), hasFromUrl: /From URL/i.test(b), hasPaste: /paste MIB/i.test(b), hasImportBtn: /Import MIBs/i.test(b) };
      });
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(200);
      await page.screenshot({ path: `${OUT}/mibs-${vp.width}.png` });
      await shotBottom(page, `${OUT}/mibs-${vp.width}-bottom.png`, scrollers);
      const loaded = sections.find(s => /loaded modules/i.test(s.title));
      const metrics = { screen: 'mibs', width: vp.width, booted, scrollers, sections, inlineImport, loadedModulesY: loaded ? loaded.y : null };
      writeFileSync(`${OUT}/mibs-${vp.width}.json`, JSON.stringify(metrics, null, 2));
      summary[key] = { booted, ratio: scrollers[0]?.ratio ?? null, loadedModulesY: loaded?.y ?? null, inlineImport };
      console.log(`DONE ${key} ratio=${scrollers[0]?.ratio} loadedY=${loaded?.y}`);
      await ctx.close();
    }
    // ---- QUERY (as-is) ----
    {
      const key = `query-${vp.width}`;
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/#/results`, { waitUntil: 'load' });
      const booted = await boot(page, ['Agent', 'Operation', 'Results', 'Run', 'Walk']);
      await sleep(1200);
      const scrollers = await collectScrollers(page);
      const sections = await collectSections(page);
      const resultsHdr = sections.filter(s => s.title === 'Results');
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(200);
      await page.screenshot({ path: `${OUT}/query-${vp.width}.png` });
      await shotBottom(page, `${OUT}/query-${vp.width}-bottom.png`, scrollers);
      const metrics = { screen: 'query', width: vp.width, booted, scrollers, sections, resultsHeaderYs: resultsHdr.map(s => s.y) };
      writeFileSync(`${OUT}/query-${vp.width}.json`, JSON.stringify(metrics, null, 2));
      summary[key] = { booted, ratio: scrollers[0]?.ratio ?? null, resultsHeaderYs: resultsHdr.map(s => s.y) };
      console.log(`DONE ${key} ratio=${scrollers[0]?.ratio}`);
      await ctx.close();
    }
    // ---- QUERY-SET (Set chip selected) ----
    {
      const key = `query-set-${vp.width}`;
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/#/results`, { waitUntil: 'load' });
      const booted = await boot(page, ['Agent', 'Operation', 'Results', 'Run', 'Walk']);
      await sleep(1200);
      // click Set chip (smallest element with exact text "Set")
      let setClicked = false;
      try {
        const handle = await page.evaluateHandle(() => {
          const els = [...document.querySelectorAll('*')].filter(el => (el.textContent || '').trim() === 'Set' && [...el.childNodes].some(n => n.nodeType === 3));
          els.sort((a, b) => (a.getBoundingClientRect().width * a.getBoundingClientRect().height) - (b.getBoundingClientRect().width * b.getBoundingClientRect().height));
          return els[0];
        });
        const el = handle.asElement();
        if (el) { await el.click(); setClicked = true; await sleep(800); }
      } catch (e) { console.log('set click err', e.message); }
      const scrollers = await collectScrollers(page);
      const sections = await collectSections(page);
      const resultsHdr = sections.filter(s => s.title === 'Results');
      // detect inline review block vs button
      const reviewInfo = await page.evaluate(() => {
        const b = document.body.innerText || '';
        const hasReviewText = /Review Set request/i.test(b);
        // find element exactly "Review Set request"
        const btns = [...document.querySelectorAll('button,[role="button"],div,span')].filter(e => (e.textContent || '').trim() === 'Review Set request');
        let btnInfo = null;
        if (btns.length) {
          const el = btns[0];
          const r = el.getBoundingClientRect();
          const disabled = el.disabled === true || el.getAttribute('aria-disabled') === 'true' || el.getAttribute('disabled') !== null;
          btnInfo = { y: Math.round(r.top), tag: el.tagName, disabled };
        }
        // dialog / confirm block present inline?
        const hasStaged = /staged|old.*new|WRITE/i.test(b);
        return { hasReviewText, btnInfo, hasStaged };
      });
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(200);
      await page.screenshot({ path: `${OUT}/query-set-${vp.width}.png` });
      await shotBottom(page, `${OUT}/query-set-${vp.width}-bottom.png`, scrollers);
      const metrics = { screen: 'query-set', width: vp.width, booted, setClicked, scrollers, sections, resultsHeaderYs: resultsHdr.map(s => s.y), reviewInfo };
      writeFileSync(`${OUT}/query-set-${vp.width}.json`, JSON.stringify(metrics, null, 2));
      summary[key] = { booted, setClicked, ratio: scrollers[0]?.ratio ?? null, resultsHeaderYs: resultsHdr.map(s => s.y), reviewInfo };
      console.log(`DONE ${key} ratio=${scrollers[0]?.ratio} review=${JSON.stringify(reviewInfo)}`);
      await ctx.close();
    }
  }
  await browser.close();
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
}
run();
