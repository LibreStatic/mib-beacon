import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire('/tmp/mibbeacon-scan/');
const { chromium } = require('playwright-core');

const BASE = 'http://localhost:8899';
const OUT = '/home/facuarmo/openmibcatalog_2/docs/scroll-reduction-layout-refactor/baseline';
const executablePath = process.env.HOME + '/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';

const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

const states = [
  { screen: 'mibs', hash: '#/mibs', waitText: ['Import', 'Modules', 'MIB', 'Library'] },
  { screen: 'query', hash: '#/results', waitText: ['Agent', 'Operation', 'Results', 'Run', 'Walk'] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function collectScrollers(page) {
  return page.evaluate(() => {
    const divs = [...document.querySelectorAll('div')].filter(d => d.scrollHeight > d.clientHeight + 50);
    // dedupe nested: keep those that are significant, sort by scrollHeight desc
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
    // Find nearest scrollable ancestor scrollTop
    function scrollTopOf(el) {
      let n = el.parentElement;
      while (n) {
        if (n.scrollHeight > n.clientHeight + 50) return n.scrollTop;
        n = n.parentElement;
      }
      return window.scrollY || 0;
    }
    const results = [];
    const seen = new Set();
    // Collect headings, labels, buttons, and text nodes that look like section markers
    const candidates = [...document.querySelectorAll('*')].filter(el => {
      const t = (el.textContent || '').trim();
      if (!t || t.length > 60) return false;
      // leaf-ish: no element children with same text
      const directText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
      if (!directText) return false;
      return true;
    });
    const keywords = ['import', 'url', 'paste', 'drop', 'module', 'library', 'agent', 'operation',
      'run', 'walk', 'get', 'set', 'result', 'artifact', 'progress', 'review', 'request', 'host',
      'community', 'oid', 'target', 'varbind', 'snmp', 'file', 'browse'];
    for (const el of candidates) {
      const t = (el.textContent || '').trim();
      const low = t.toLowerCase();
      if (!keywords.some(k => low.includes(k))) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const y = Math.round(r.top + scrollTopOf(el));
      const key = t + '@' + y;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ title: t, y });
    }
    results.sort((a, b) => a.y - b.y);
    return results;
  });
}

async function run() {
  const browser = await chromium.launch({ headless: true, executablePath });
  const summary = {};
  for (const vp of viewports) {
    for (const st of states) {
      const key = `${st.screen}-${vp.width}`;
      try {
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
        const page = await ctx.newPage();
        await page.goto(`${BASE}/${st.hash}`, { waitUntil: 'load' });
        // wait for boot: any of waitText appears
        let booted = false;
        for (let i = 0; i < 40; i++) {
          const found = await page.evaluate((texts) => {
            const body = document.body.innerText || '';
            return texts.some(t => body.includes(t));
          }, st.waitText);
          if (found) { booted = true; break; }
          await sleep(300);
        }
        await sleep(1200); // settle

        // For query: try clicking "Set" operation chip
        let setNote = null;
        if (st.screen === 'query') {
          setNote = await page.evaluate(() => {
            const els = [...document.querySelectorAll('*')].filter(el => {
              const t = (el.textContent || '').trim();
              return t === 'Set' && [...el.childNodes].some(n => n.nodeType === 3);
            });
            return els.length;
          });
          if (setNote > 0) {
            try {
              // click the smallest element with text "Set"
              const handle = await page.evaluateHandle(() => {
                const els = [...document.querySelectorAll('*')].filter(el => {
                  const t = (el.textContent || '').trim();
                  return t === 'Set' && [...el.childNodes].some(n => n.nodeType === 3);
                });
                els.sort((a,b) => (a.getBoundingClientRect().width*a.getBoundingClientRect().height) - (b.getBoundingClientRect().width*b.getBoundingClientRect().height));
                return els[0];
              });
              const elem = handle.asElement();
              if (elem) { await elem.click(); await sleep(800); }
            } catch (e) { /* ignore */ }
          }
        }

        const scrollers = await collectScrollers(page);
        const sections = await collectSections(page);

        // capture set review area after clicking (query)
        let setReview = null;
        if (st.screen === 'query') {
          setReview = await page.evaluate(() => {
            const body = document.body.innerText || '';
            const hits = [];
            for (const kw of ['Review Set', 'Set request', 'varbind', 'Staged', 'Add varbind']) {
              if (body.includes(kw)) {
                const el = [...document.querySelectorAll('*')].find(e => (e.textContent||'').includes(kw) && [...e.childNodes].some(n=>n.nodeType===3 && n.textContent.includes(kw.split(' ')[0])));
                const r = el ? el.getBoundingClientRect() : null;
                hits.push({ kw, y: r ? Math.round(r.top) : null });
              }
            }
            return hits;
          });
        }

        // screenshot top
        await page.evaluate(() => window.scrollTo(0, 0));
        await sleep(200);
        await page.screenshot({ path: `${OUT}/${st.screen}-${vp.width}.png` });

        // scroll main container to bottom if tall
        const mainScroller = scrollers[0];
        if (mainScroller && mainScroller.scrollHeight > mainScroller.clientHeight * 1.5) {
          await page.evaluate(() => {
            const divs = [...document.querySelectorAll('div')].filter(d => d.scrollHeight > d.clientHeight + 50);
            divs.sort((a,b)=>b.scrollHeight-a.scrollHeight);
            if (divs[0]) divs[0].scrollTop = divs[0].scrollHeight;
          });
          await sleep(500);
          await page.screenshot({ path: `${OUT}/${st.screen}-${vp.width}-bottom.png` });
        }

        const metrics = { screen: st.screen, width: vp.width, booted, scrollers, sections };
        if (st.screen === 'query') { metrics.setChipCount = setNote; metrics.setReview = setReview; }
        writeFileSync(`${OUT}/${st.screen}-${vp.width}.json`, JSON.stringify(metrics, null, 2));
        summary[key] = { booted, scrollers: scrollers.slice(0,3), sectionCount: sections.length };
        console.log(`DONE ${key} booted=${booted} scrollers=${scrollers.length} sections=${sections.length}`);
        await ctx.close();
      } catch (e) {
        console.log(`ERROR ${key}: ${e.message}`);
        summary[key] = { error: e.message };
      }
    }
  }
  await browser.close();
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
}

run();
