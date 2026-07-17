import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire('/tmp/mibbeacon-scan/');
const { chromium } = require('playwright-core');

const OUT = '/home/facuarmo/openmibcatalog_2/docs/scroll-reduction-layout-refactor/baseline';
const URL = 'http://localhost:8899/#/tools';
const EXEC = process.env.HOME + '/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function collectMetrics(page, screen, width) {
  return await page.evaluate(({ screen, width }) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const scrollables = [...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 50);
    let main = null; for (const d of scrollables) if (!main || d.scrollHeight > main.scrollHeight) main = d;
    const scrollHeight = main ? main.scrollHeight : document.documentElement.scrollHeight;
    const clientHeight = main ? main.clientHeight : window.innerHeight;
    const scrollTop = main ? main.scrollTop : 0;
    const wanted = ['1. Choose where to poll','Add an SNMP target','Add target','2. Configure the series','Host','Community','Version','Port','Save and use target','Username','Auth','Priv','Context','Results','Name','Security'];
    const seen = new Set(); const sections = [];
    for (const el of [...document.querySelectorAll('div, span, label, button, [role="button"]')]) {
      const txt = norm(el.textContent); if (!txt || txt.length > 60) continue;
      const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
      if ([...el.children].some((c) => norm(c.textContent) === txt)) continue;
      for (const w of wanted) { if (txt === w || txt.startsWith(w)) { if (seen.has(txt)) break; seen.add(txt); sections.push({ title: txt, y: Math.round(r.top + scrollTop) }); break; } }
    }
    sections.sort((a, b) => a.y - b.y);
    return { screen, width, scrollHeight, clientHeight, ratio: +(scrollHeight / clientHeight).toFixed(2), sections };
  }, { screen, width });
}
async function scrollC(page, to) { await page.evaluate((to) => { const s=[...document.querySelectorAll('div')].filter(d=>d.scrollHeight>d.clientHeight+50); let m=null; for(const d of s) if(!m||d.scrollHeight>m.scrollHeight) m=d; if(m) m.scrollTop = to==='bottom'?m.scrollHeight:0; else window.scrollTo(0,to==='bottom'?9e9:0); }, to); }
async function capture(page, state, width) {
  await scrollC(page,'top'); await sleep(300);
  const m = await collectMetrics(page, state, width);
  writeFileSync(`${OUT}/${state}-${width}.json`, JSON.stringify(m,null,2));
  await page.screenshot({ path: `${OUT}/${state}-${width}.png` });
  if (m.scrollHeight > 1.5*m.clientHeight) { await scrollC(page,'bottom'); await sleep(400); await page.screenshot({ path: `${OUT}/${state}-${width}-bottom.png` }); await scrollC(page,'top'); }
  return m;
}

const browser = await chromium.launch({ headless: true, executablePath: EXEC });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
for (let i=0;i<40;i++){ const h=await page.evaluate(()=>{const t=document.body.innerText||'';return t.includes('Graphs')&&t.includes('Ports');}); if(h)break; await sleep(500);} await sleep(1200);

const out = {};
for (const [chip, form] of [['Graphs','tools-graphs-form'],['Compare','tools-compare-form'],['Ports','tools-ports-form']]) {
  await page.getByText(chip, { exact: true }).first().click(); await sleep(900);
  // open form
  for (const b of ['Add an SNMP target','Add target']) { const loc = page.getByText(b, { exact: true }); if (await loc.count()) { await loc.first().click(); break; } }
  await sleep(800);
  // click v3 chip robustly
  const v3 = page.getByText('v3', { exact: true });
  let v3ok = false;
  if (await v3.count()) { await v3.first().scrollIntoViewIfNeeded(); await v3.first().click(); v3ok = true; }
  await sleep(700);
  const applied = await page.evaluate(()=> (document.body.innerText||'').includes('Authentication protocol') || (document.body.innerText||'').includes('Privacy protocol'));
  const m = await capture(page, form, 390);
  out[chip] = { v3ok, v3applied: applied, ratio: m.ratio, sh: m.scrollHeight, ch: m.clientHeight, sections: m.sections.map(s=>`${s.y}:${s.title}`) };
}
await ctx.close(); await browser.close();
console.log(JSON.stringify(out, null, 2));
