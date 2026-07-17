import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire('/tmp/mibbeacon-scan/');
const { chromium } = require('playwright-core');

const BASE = 'http://localhost:8899';
const OUT = '/home/facuarmo/openmibcatalog_2/docs/scroll-reduction-layout-refactor/baseline';
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

const exe = process.env.HOME + '/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Return metrics for main scroll container + section map
async function collectMetrics(page, screen, width) {
  return await page.evaluate(({ screen, width }) => {
    const divs = [...document.querySelectorAll('div')].filter(
      (d) => d.scrollHeight > d.clientHeight + 50
    );
    let main = null;
    for (const d of divs) {
      if (!main || d.scrollHeight > main.scrollHeight) main = d;
    }
    const scrollHeight = main ? main.scrollHeight : document.documentElement.scrollHeight;
    const clientHeight = main ? main.clientHeight : window.innerHeight;
    const scrollTop = main ? main.scrollTop : 0;

    // section map: headings, buttons, labels
    const wanted = new Set(['H1', 'H2', 'H3', 'H4', 'BUTTON']);
    const seen = new Set();
    const sections = [];
    const all = [...document.querySelectorAll('*')];
    for (const el of all) {
      const tag = el.tagName;
      const role = el.getAttribute && el.getAttribute('role');
      const isButton = tag === 'BUTTON' || role === 'button';
      const isHeading = wanted.has(tag) || (role && role.startsWith('heading'));
      // React Native Web: text nodes are often in divs/spans with dir=auto
      if (!isButton && !isHeading) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      // get direct text
      let text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
      if (!text || text.length > 80) continue;
      const y = Math.round(rect.top + scrollTop);
      const key = text + '@' + y;
      if (seen.has(key)) continue;
      seen.add(key);
      sections.push({ title: text, y, kind: isButton ? 'button' : 'heading' });
    }
    // Also capture RNW text elements that look like card titles / labels (short bold-ish text)
    sections.sort((a, b) => a.y - b.y);
    return {
      screen,
      width,
      scrollHeight,
      clientHeight,
      scrollTop,
      ratio: +(scrollHeight / clientHeight).toFixed(2),
      sections,
    };
  }, { screen, width });
}

// Broader text-based section map for RNW (captures non-heading labels)
async function collectTextMap(page) {
  return await page.evaluate(() => {
    const divs = [...document.querySelectorAll('div')].filter(
      (d) => d.scrollHeight > d.clientHeight + 50
    );
    let main = null;
    for (const d of divs) if (!main || d.scrollHeight > main.scrollHeight) main = d;
    const scrollTop = main ? main.scrollTop : 0;
    const results = [];
    const seen = new Set();
    const els = [...document.querySelectorAll('div,span')];
    for (const el of els) {
      // leaf-ish text nodes
      const hasElementChild = [...el.children].some((c) => c.tagName === 'DIV' || c.tagName === 'SPAN');
      if (hasElementChild) continue;
      let text = (el.textContent || '').trim().replace(/\s+/g, ' ');
      if (!text || text.length > 60) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const y = Math.round(rect.top + scrollTop);
      const key = text + '@' + y;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ title: text, y });
    }
    results.sort((a, b) => a.y - b.y);
    return results;
  });
}

async function scrollMainTo(page, pos) {
  await page.evaluate((pos) => {
    const divs = [...document.querySelectorAll('div')].filter(
      (d) => d.scrollHeight > d.clientHeight + 50
    );
    let main = null;
    for (const d of divs) if (!main || d.scrollHeight > main.scrollHeight) main = d;
    if (main) main.scrollTop = pos === 'bottom' ? main.scrollHeight : 0;
    else window.scrollTo(0, pos === 'bottom' ? document.body.scrollHeight : 0);
  }, pos);
}

async function waitBoot(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  // wait for some real UI text
  for (let i = 0; i < 40; i++) {
    const txt = await page.evaluate(() => document.body.innerText || '');
    if (txt.length > 200 && !/loading/i.test(txt.slice(0, 40))) break;
    await sleep(250);
  }
  await sleep(800);
}

// find and click text matching regex among clickable-ish elements
async function clickByText(page, patternSource, opts = {}) {
  return await page.evaluate(({ patternSource, flags, exact }) => {
    const re = new RegExp(patternSource, flags || 'i');
    const els = [...document.querySelectorAll('div,span,button,a,[role="button"]')];
    // prefer smallest element whose trimmed text matches
    const matches = [];
    for (const el of els) {
      const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
      if (!t) continue;
      if (exact ? t.toLowerCase() === patternSource.toLowerCase() : re.test(t)) {
        matches.push({ el, len: t.length });
      }
    }
    matches.sort((a, b) => a.len - b.len);
    if (!matches.length) return { clicked: false };
    const el = matches[0].el;
    const rect = el.getBoundingClientRect();
    el.scrollIntoView({ block: 'center' });
    // dispatch pointer + click
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
    });
    return { clicked: true, text: (el.textContent || '').trim().slice(0, 60) };
  }, { patternSource, flags: opts.flags, exact: opts.exact });
}

async function pageText(page) {
  return await page.evaluate(() => document.body.innerText || '');
}

async function scanState(context, vp, screen, setup) {
  const page = await context.newPage();
  const info = { screen, width: vp.width, clicks: [] };
  try {
    await page.goto(BASE + '/#/', { waitUntil: 'domcontentloaded' });
    await waitBoot(page);
    if (setup) {
      const r = await setup(page, info);
    }
    await sleep(500);
    await scrollMainTo(page, 'top');
    await sleep(300);

    const metrics = await collectMetrics(page, screen, vp.width);
    const textMap = await collectTextMap(page);
    metrics.textMapCount = textMap.length;

    // screenshot top
    await page.screenshot({ path: `${OUT}/${screen}-${vp.width}.png` });

    if (metrics.scrollHeight > 1.5 * metrics.clientHeight) {
      await scrollMainTo(page, 'bottom');
      await sleep(500);
      await page.screenshot({ path: `${OUT}/${screen}-${vp.width}-bottom.png` });
    }

    writeFileSync(
      `${OUT}/${screen}-${vp.width}.json`,
      JSON.stringify({ ...metrics, clicks: info.clicks }, null, 2)
    );
    // also dump a text map for analysis
    writeFileSync(
      `${OUT}/${screen}-${vp.width}.textmap.json`,
      JSON.stringify(textMap, null, 2)
    );
    return { metrics, textMap, clicks: info.clicks };
  } finally {
    await page.close();
  }
}

async function main() {
  const summary = {};
  const browser = await chromium.launch({ headless: true, executablePath: exe });

  for (const vp of VIEWPORTS) {
    // traps-receive
    for (const state of ['traps-receive', 'traps-send', 'agents']) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      let setup;
      if (state === 'traps-receive') {
        setup = async (page) => {
          await page.goto(BASE + '/#/traps', { waitUntil: 'domcontentloaded' });
          await waitBoot(page);
        };
      } else if (state === 'traps-send') {
        setup = async (page, info) => {
          await page.goto(BASE + '/#/traps', { waitUntil: 'domcontentloaded' });
          await waitBoot(page);
          // switch to Send workspace
          const s1 = await clickByText(page, 'Send', { exact: true });
          info.clicks.push({ action: 'Send toggle', ...s1 });
          await sleep(800);
          // click v3 version chip
          const s2 = await clickByText(page, '^v3$');
          info.clicks.push({ action: 'v3 chip', ...s2 });
          await sleep(800);
        };
      } else if (state === 'agents') {
        setup = async (page, info) => {
          await page.goto(BASE + '/#/agents', { waitUntil: 'domcontentloaded' });
          await waitBoot(page);
          const s2 = await clickByText(page, '^v3$');
          info.clicks.push({ action: 'v3 chip', ...s2 });
          await sleep(800);
        };
      }
      try {
        const res = await scanState(context, vp, state, setup);
        summary[`${state}-${vp.width}`] = {
          scrollHeight: res.metrics.scrollHeight,
          clientHeight: res.metrics.clientHeight,
          ratio: res.metrics.ratio,
          sections: res.metrics.sections.length,
          clicks: res.clicks,
        };
        console.log(`OK ${state}-${vp.width}: ratio=${res.metrics.ratio} sh=${res.metrics.scrollHeight} ch=${res.metrics.clientHeight} sections=${res.metrics.sections.length}`);
      } catch (e) {
        summary[`${state}-${vp.width}`] = { error: String(e).slice(0, 200) };
        console.log(`FAIL ${state}-${vp.width}: ${String(e).slice(0, 200)}`);
      } finally {
        await context.close();
      }
    }
  }
  await browser.close();
  writeFileSync(`${OUT}/_summary.json`, JSON.stringify(summary, null, 2));
  console.log('DONE');
}

main().catch((e) => { console.error(e); process.exit(1); });
