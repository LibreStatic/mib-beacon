import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire('/tmp/mibbeacon-scan/');
const { chromium } = require('playwright-core');

const OUT = '/home/facuarmo/openmibcatalog_2/docs/scroll-reduction-layout-refactor/baseline';
const URL = 'http://localhost:8899/#/tools';
const EXEC = process.env.HOME + '/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';

const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Click an element whose visible text matches (exact-ish) predicate. Returns true if clicked.
async function clickByText(page, texts, opts = {}) {
  const arr = Array.isArray(texts) ? texts : [texts];
  const res = await page.evaluate(({ arr, exact }) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const candidates = [...document.querySelectorAll('div[role="button"], button, [role="button"], a, div[tabindex], span')];
    for (const t of arr) {
      // prefer smallest element containing the text
      let best = null;
      for (const el of candidates) {
        const txt = norm(el.textContent);
        const match = exact ? txt === t : txt.includes(t);
        if (!match) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (!best || (el.textContent.length < best.el.textContent.length)) best = { el, r };
      }
      if (best) {
        best.el.scrollIntoView({ block: 'center' });
        return { x: best.r.left + best.r.width / 2, y: best.r.top + best.r.height / 2, text: t };
      }
    }
    return null;
  }, { arr, exact: opts.exact || false });
  if (!res) return false;
  await page.mouse.click(res.x, res.y);
  return true;
}

async function collectMetrics(page, screen, width) {
  return await page.evaluate(({ screen, width }) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const scrollables = [...document.querySelectorAll('div')].filter(
      (d) => d.scrollHeight > d.clientHeight + 50
    );
    let main = null;
    for (const d of scrollables) if (!main || d.scrollHeight > main.scrollHeight) main = d;
    const scrollHeight = main ? main.scrollHeight : document.documentElement.scrollHeight;
    const clientHeight = main ? main.clientHeight : window.innerHeight;
    const scrollTop = main ? main.scrollTop : 0;

    // section map: headings/labels of interest
    const wanted = [
      '1. Choose where to poll', 'Choose where to poll',
      'Add an SNMP target', 'Add target',
      '2. Configure the series', 'Configure the series',
      '3.', 'Host', 'Community', 'Version', 'Port',
      'Save and use target', 'Save target',
      'Username', 'Auth', 'Priv', 'Context',
      'No targets', 'Reachability', 'Results', 'Series',
    ];
    const seen = new Set();
    const sections = [];
    const all = [...document.querySelectorAll('div, span, h1, h2, h3, h4, label, button, [role="button"]')];
    for (const el of all) {
      const txt = norm(el.textContent);
      if (!txt || txt.length > 60) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // only leaf-ish (avoid huge wrappers): direct text
      const hasChildText = [...el.children].some((c) => norm(c.textContent) === txt);
      if (hasChildText) continue;
      for (const w of wanted) {
        if (txt === w || txt.startsWith(w)) {
          const key = txt;
          if (seen.has(key)) break;
          seen.add(key);
          const y = Math.round(r.top + scrollTop);
          sections.push({ title: txt, y });
          break;
        }
      }
    }
    sections.sort((a, b) => a.y - b.y);
    return {
      screen, width,
      scrollHeight, clientHeight,
      ratio: +(scrollHeight / clientHeight).toFixed(2),
      sections,
    };
  }, { screen, width });
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

async function capture(page, state, width) {
  await scrollTopContainer(page, 'top');
  await sleep(300);
  const metrics = await collectMetrics(page, state, width);
  writeFileSync(`${OUT}/${state}-${width}.json`, JSON.stringify(metrics, null, 2));
  await page.screenshot({ path: `${OUT}/${state}-${width}.png` });
  if (metrics.scrollHeight > 1.5 * metrics.clientHeight) {
    await scrollTopContainer(page, 'bottom');
    await sleep(400);
    await page.screenshot({ path: `${OUT}/${state}-${width}-bottom.png` });
    await scrollTopContainer(page, 'top');
  }
  return metrics;
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
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  // wait for tools chips
  let ready = false;
  for (let i = 0; i < 40; i++) {
    const has = await page.evaluate(() => {
      const t = document.body.innerText || '';
      return t.includes('Graphs') && t.includes('Compare') && t.includes('Ports');
    });
    if (has) { ready = true; break; }
    await sleep(500);
  }
  await sleep(1200);
  summary[vp.name] = { ready };

  for (const s of sections) {
    try {
      const clicked = await clickByText(page, s.chip, { exact: true });
      summary[vp.name][s.chip] = { chipClicked: clicked };
      await sleep(900);
      const baseM = await capture(page, s.base, vp.width);
      summary[vp.name][s.chip].base = { ratio: baseM.ratio, sh: baseM.scrollHeight, ch: baseM.clientHeight, sections: baseM.sections.length };

      // open form
      const formBtn = await clickByText(page, ['Add an SNMP target', 'Add target', 'Add a target', 'Configure a target']);
      summary[vp.name][s.chip].formBtnClicked = formBtn;
      await sleep(800);
      // try switch to v3
      const v3 = await clickByText(page, 'v3', { exact: true });
      summary[vp.name][s.chip].v3Clicked = v3;
      await sleep(700);
      const formM = await capture(page, s.form, vp.width);
      summary[vp.name][s.chip].form = { ratio: formM.ratio, sh: formM.scrollHeight, ch: formM.clientHeight, sections: formM.sections.length };
    } catch (e) {
      summary[vp.name][s.chip] = { error: String(e).slice(0, 200) };
    }
  }
  await ctx.close();
}

await browser.close();
writeFileSync(`${OUT}/_run-summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
