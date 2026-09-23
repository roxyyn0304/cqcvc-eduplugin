#!/usr/bin/env node
/**
 * 真实课表抓取验收（复刻插件 schedule 管线，只读）
 * 用法: node tools/fetch-schedule.mjs [env文件路径] [--term=2026-2027-1]
 * 输出脱敏：含课程名/星期/节次/周次/教室（供验收核对），不含教师名与任何身份字段。
 */
import {readFileSync} from 'node:fs';
import {publicEncrypt, constants} from 'node:crypto';

const ORIGIN = 'https://jw.cqcvc.edu.cn';
const RSA_PUBLIC_KEY = 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCwC58ftEM2SJHu2H/IIF7DfAi74AtaQSXjGy9PWEb5qD2s0+uh+n1YZBEKDBwwLWZL6T2wVC26pGJuniTOPzGxe5ARTwMATsGKkDTKVNNxkZWxZJS8tuxlJoNP9RD5/u9H3wYJKxcv4VsnH1CwFqlEq7NihIjxvwk7F0omsIbphwIDAQAB';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0';

const args = process.argv.slice(2);
const ENV = args.find(a => !a.startsWith('--')) ?? './credentials.env';
const TERM = (args.find(a => a.startsWith('--term=')) ?? '').split('=')[1] || '';

// ---- env（两行：学号/密码）----
const buf = readFileSync(ENV);
let text = (buf[0] === 0xff && buf[1] === 0xfe) ? buf.toString('utf16le') : buf.toString('utf8');
const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const username = lines[0] ?? '';
const password = lines[1] ?? '';
if (!username || !password) { console.error('!! env 需两行：第一行学号，第二行密码'); process.exit(2); }

// ---- cookie jar + fetch ----
const jar = new Map();
const absorb = (r) => {
  const sc = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
  for (const c of sc) { const m = /^([^=]+)=([^;]*)/.exec(c); if (m) jar.set(m[1], m[2]); }
};
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
const req = async (path, {method = 'GET', body, headers = {}} = {}) => {
  const url = /^https?:\/\//i.test(path) ? path : ORIGIN + path;
  const r = await fetch(url, {
    method, redirect: 'manual',
    headers: {'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9', ...(jar.size ? {Cookie: cookie()} : {}), ...headers},
    body
  });
  absorb(r);
  return r;
};

// ---- 登录 ----
await req('/admin/login', {headers: {Accept: 'text/html'}});
const enc = publicEncrypt(
  {key: Buffer.from(RSA_PUBLIC_KEY, 'base64'), format: 'der', type: 'spki', padding: constants.RSA_PKCS1_PADDING},
  Buffer.from(password)
).toString('base64');
const lr = await req('/admin/login', {
  method: 'POST',
  headers: {'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html'},
  body: new URLSearchParams({username, password: enc, jcaptchaCode: '', rememberMe: '1'}).toString()
});
if (lr.status >= 400 || ![301, 302, 303, 307, 308].includes(lr.status)) { console.error(`!! 登录失败 status=${lr.status}`); process.exit(3); }
console.log('[登录] ' + lr.status + ' ' + (lr.headers.get('location') ?? ''));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await sleep(300);

// ---- 学期 ----
const curR = await req('/admin/xsd/xsdcjcx/getCurrentXnxq', {headers: {'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json'}});
const term = TERM || String((await curR.json()).data ?? '');
console.log('[学期] ' + term);
await sleep(200);

// ---- 开学日期推算（与插件 calendar 一致：Date 头本周一 − (dqzc-1) 周）----
{
  const gzR = await req('/admin/api/getZclistByXnxq', {headers: {'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json'}});
  const gz = await gzR.json();
  const dateHdr = gzR.headers.get('date') ?? '';
  const dq = Number(gz?.data?.dqzc);
  const ms = Date.parse(dateHdr);
  if (Number.isFinite(dq) && dq >= 1 && Number.isFinite(ms)) {
    const cn = ms + 8 * 3600 * 1000;
    const wm = cn - ((new Date(cn).getUTCDay() + 6) % 7) * 86400000 - (dq - 1) * 7 * 86400000;
    const d = new Date(wm);
    const p2 = (n) => String(n).padStart(2, '0');
    console.log(`[开学日期] Date头=${JSON.stringify(dateHdr)}, dqzc=${dq} → 第一周周一=${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`);
  } else {
    console.log(`[开学日期] 推算失败 Date=${JSON.stringify(dateHdr)} dqzc=${gz?.data?.dqzc}`);
  }
}
await sleep(200);

// ---- 周数 ----
const pkR = await req('/admin/getCurrentPkZc', {headers: {'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json'}});
const pkData = (await pkR.json()).data ?? [];
let maxWeeks = 16;
{ let m = 0; for (const w of pkData) { const n = Number(w); if (Number.isFinite(n) && n > m) m = n; } if (m >= 1) maxWeeks = Math.min(25, m); }
console.log('[周数] maxWeeks=' + maxWeeks);
await sleep(200);

// ---- 网格 ----
const sykbR = await req('/admin/getXsdSykb', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json'}, body: ''});
let sykb = null;
try { sykb = JSON.parse(await sykbR.text()); } catch { console.error('!! getXsdSykb 非 JSON status=' + sykbR.status); process.exit(4); }
const grid = Array.isArray(sykb?.data?.jcKcxx) ? sykb.data.jcKcxx : [];
console.log('[网格] 节次块=' + grid.length);
await sleep(200);

// ---- 课表页隐藏域 ----
const pageR = await req(`/admin/pkgl/xskb/queryKbForXsd?xnxq=${encodeURIComponent(term)}&zxzc=&zdzc=&xskbxslx=0`, {headers: {Accept: 'text/html'}});
const pageHtml = await pageR.text();
const hiddenValue = (id) => {
  for (const tag of (pageHtml.match(/<input[^>]*>/gi) ?? [])) {
    if (new RegExp(`id=["']${id}["']`, 'i').test(tag)) { const v = /value=["']([^"']*)["']/.exec(tag); if (v) return v[1]; }
  }
  return '';
};
const xhid = hiddenValue('xhid'), xqdm = hiddenValue('xqdm');
console.log(`[隐藏域] status=${pageR.status}, xhid长度=${xhid.length}, xqdm=${JSON.stringify(xqdm)}`);
if (!xhid) { console.error('!! 未取到 xhid（登录态失效或页面结构变化）'); process.exit(5); }
await sleep(200);

// ---- 真周次源 ----
const skR = await req(`/admin/pkgl/xskb/sdpkkbList?xnxq=${encodeURIComponent(term)}&xhid=${encodeURIComponent(xhid)}&xqdm=${encodeURIComponent(xqdm)}&zdzc=&zxzc=&xskbxslx=0`, {headers: {'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json'}});
let sk = null;
try { sk = JSON.parse(await skR.text()); } catch { console.error('!! sdpkkbList 非 JSON status=' + skR.status); process.exit(6); }
const skRows = Array.isArray(sk?.data) ? sk.data : [];
console.log('[周次源] 行数=' + skRows.length);

// ---- parseWeeks（与插件一致）----
function parseWeeks(raw, cap0) {
  const cap = Math.min(25, Math.max(1, cap0));
  const all = () => { const o = []; for (let w = 1; w <= cap; w++) o.push(w); return o; };
  const t = typeof raw === 'string' ? raw.replace(/\s+/g, '') : '';
  if (!t || t === '-' || t === '全部' || t === '整学期') return all();
  const set = new Set();
  for (const tok of t.split(/[,，、]/)) {
    if (!tok) continue;
    let m = /^(\d+)-(\d+)(双|单)周?$/.exec(tok);
    if (m) { const a = +m[1], b = +m[2], even = m[3] === '双'; for (let w = a; w <= b; w++) if (w >= 1 && w <= cap && (even ? w % 2 === 0 : w % 2 === 1)) set.add(w); continue; }
    m = /^(\d+)-(\d+)(?:周|星期)?$/.exec(tok);
    if (m) { const a = +m[1], b = +m[2]; for (let w = a; w <= b; w++) if (w >= 1 && w <= cap) set.add(w); continue; }
    m = /^(\d+)周?$/.exec(tok);
    if (m) { const w = +m[1]; if (w >= 1 && w <= cap) set.add(w); }
  }
  if (!set.size) return all();
  return [...set].sort((x, y) => x - y);
}

// ---- 组装（与插件一致：网格 + weeksFor 连接 + 合并）----
const skCells = [];
for (const row of skRows) {
  const day = Number(row?.xingqi), period = Number(row?.djc),
    kcmc = String(row?.kcmc ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  if (!Number.isFinite(day) || day < 1 || day > 7 || !Number.isFinite(period) || period < 1 || !kcmc) continue;
  skCells.push({day, period, kcmc, weeks: parseWeeks(row?.zcstr ?? row?.zc, maxWeeks)});
}
const weeksFor = (day, period, kcmc) => {
  let best = null;
  for (const c of skCells) if (c.day === day && c.kcmc === kcmc && c.period <= period && (!best || c.period > best.period)) best = c;
  return best ? best.weeks : null;
};
console.log('\n[诊断] 周次源前3格:', JSON.stringify(skCells.slice(0, 3)));
let cellTotal = 0, cellHit = 0;
const drafts = [];
const diagCells = [];
for (const block of grid) {
  const period = Number(block?.jc);
  if (!Number.isFinite(period) || period < 1 || period > 30) continue;
  for (const d of (Array.isArray(block?.kbxx) ? block.kbxx : [])) {
    const day = Number(d?.yzxq);
    if (!Number.isFinite(day) || day < 1 || day > 7) continue;
    for (const k of (Array.isArray(d?.kcxx) ? d.kcxx : [])) {
      const name = String(k?.kcmc ?? '').trim();
      if (!name || name === '-') continue;
      cellTotal++;
      if (diagCells.length < 3) diagCells.push({day, period, name: JSON.stringify(name)});
      const joined = weeksFor(day, period, name);
      if (joined) cellHit++;
      const location = String(k?.classroom ?? '').trim();
      const e = {name, day, startPeriod: period, endPeriod: period, weeks: joined ?? parseWeeks(k?.zcstr, maxWeeks), _hit: !!joined};
      if (location) e.location = location;
      drafts.push(e);
    }
  }
}
drafts.sort((x, y) => x.day - y.day || x.startPeriod - y.startPeriod || x.name.localeCompare(y.name));
console.log('[诊断] 网格前3格:', JSON.stringify(diagCells));
{
  const skNames = [...new Set(skCells.map(c => c.kcmc))];
  const grNames = [...new Set(drafts.map(d => d.name))];
  console.log('[诊断] 仅在周次源(前5):', JSON.stringify(skNames.filter(n => !grNames.includes(n)).slice(0, 5)));
  console.log('[诊断] 仅在网格(前5):', JSON.stringify(grNames.filter(n => !skNames.includes(n)).slice(0, 5)));
  console.log('[诊断] 名字交集数:', grNames.filter(n => skNames.includes(n)).length, '/', grNames.length);
}
const merged = [];
for (const dr of drafts) {
  const prev = merged[merged.length - 1];
  if (prev && prev.day === dr.day && prev.endPeriod + 1 === dr.startPeriod && prev.name === dr.name &&
      (prev.location ?? '') === (dr.location ?? '') && prev.weeks.join(',') === dr.weeks.join(',') && prev._hit === dr._hit)
    prev.endPeriod = dr.endPeriod;
  else merged.push({...dr, weeks: [...dr.weeks]});
}

// ---- 输出（脱敏：不含教师名/身份字段）----
console.log('\n=== 抓取结果（课程名/周次供核对，教师与身份字段已略去）===');
console.log(`网格课程格=${cellTotal}  周次行=${skCells.length}  周次命中=${cellHit}/${cellTotal} (${cellTotal ? (cellHit * 100 / cellTotal).toFixed(0) : 0}%)`);
console.log(`合并后条目=${merged.length}\n`);
const dayName = ['一', '二', '三', '四', '五', '六', '日'];
for (const e of merged) {
  const weeksDesc = e.weeks.length >= maxWeeks ? `全学期(1-${maxWeeks})` : `${e.weeks.join(',')}（${e.weeks.length}周·断周!）`;
  console.log(`周${dayName[e.day - 1]} 第${e.startPeriod}${e.endPeriod !== e.startPeriod ? '-' + e.endPeriod : ''}节 | ${e.name} | ${weeksDesc}${e.location ? ' | ' + e.location : ''}`);
}
const partial = [...new Map(merged.filter(e => e.weeks.length < maxWeeks).map(e => [e.name, e.weeks])).entries()];
console.log(`\n=== 断周课程 ${partial.length} 门 ===`);
for (const [n, w] of partial) console.log(`  ${n}: ${w.join(',')}（${w.length}周）`);
console.log(`\n判定: ${cellHit === cellTotal ? '✅ 全部课程格都连上了真周次' : `⚠️ ${cellTotal - cellHit} 格回退全学期（请看上面是否有课程周次不对）`}`);
