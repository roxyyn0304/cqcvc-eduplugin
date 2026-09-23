#!/usr/bin/env node
/**
 * cqcvc 超星教务 · 真实学校协议探测（只读查询，无任何写入）
 *
 * 用法: node tools/live-probe.mjs [env文件路径]（默认 ./credentials.env）
 * env 文件支持: key=value（username/password/xh/学号/pwd/密码 等）、两行（账号/密码）、单行「账号:密码」
 *
 * 输出纪律: 只打印状态码、路径、字段名、数量、学期代码等结构性结论；
 * 学号、姓名、密码、密文、Cookie 值、成绩值一律不输出。
 */
import {readFileSync} from 'node:fs';
import {publicEncrypt, constants} from 'node:crypto';

const ENV_PATH = process.argv.slice(2).find(a => !a.startsWith('--')) ?? './credentials.env';
const ORIGIN = 'https://jw.cqcvc.edu.cn';
const RSA_PUBLIC_KEY = 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCwC58ftEM2SJHu2H/IIF7DfAi74AtaQSXjGy9PWEb5qD2s0+uh+n1YZBEKDBwwLWZL6T2wVC26pGJuniTOPzGxe5ARTwMATsGKkDTKVNNxkZWxZJS8tuxlJoNP9RD5/u9H3wYJKxcv4VsnH1CwFqlEq7NihIjxvwk7F0omsIbphwIDAQAB';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0';
const XHR = {'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/javascript, */*; q=0.01'};

const findings = [];
const note = (k, v) => { findings.push(`${k}: ${v}`); console.log(`  · ${k}: ${v}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const isLoginUrl = (u) => { try { const p = new URL(u, ORIGIN); return p.pathname.toLowerCase().endsWith('login'); } catch { return false; } };

function loadEnv(path) {
  const buf = readFileSync(path);
  let text;
  if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.toString('utf16le').replace(/^\uFEFF/, '');
  else text = buf.toString('utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const strip = (s) => s.trim().replace(/^["']|["']$/g, '');
  const kv = {};
  const raws = [];
  for (const line of lines) {
    const m = /^([^=]+)=(.*)$/.exec(line);
    if (m) kv[strip(m[1]).toLowerCase()] = strip(m[2]);
    else raws.push(line);
  }
  const pick = (...keys) => keys.find(k => k in kv);
  const userKey = pick('username', 'user', 'account', 'xh', '学号', '用户名');
  const passKey = pick('password', 'pass', 'pwd', '密码');
  const username = userKey ? kv[userKey] : (raws.length >= 2 ? raws[0] : '');
  const password = passKey ? kv[passKey] : (raws.length >= 2 ? raws[raws.length - 1] : (raws.length === 1 && !username ? raws[0] : ''));
  const kind = (s) => /^\d+$/.test(s) ? '纯数字' : /^[a-zA-Z]+$/.test(s) ? '纯字母' : /^[a-zA-Z0-9]+$/.test(s) ? '字母数字' : '含特殊字符';
  const kinds = raws.length >= 2 ? raws.map(kind) : [];
  let format = '混合';
  if (userKey && passKey) format = 'key=value';
  else if (raws.length >= 2) format = '两行';
  else if (userKey && raws.length === 1) format = 'username= + 密码行';
  else if (!username && raws.length === 1) format = '仅密码一行';
  else if (raws.length === 1 && /^([^:;,.]+)[:;,.](.+)$/.exec(raws[0])) {
    const m = /^([^:;,.]+)[:;,.](.+)$/.exec(raws[0]);
    return {username: m[1].trim(), password: m[2].trim(), format: '分隔符单行', kinds: []};
  }
  return {username, password, format, kinds};
}

const jar = new Map();
function absorb(res) {
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of raw) {
    const m = /^([^=]+)=([^;]*)/.exec(c);
    if (m) jar.set(m[1], m[2]);
  }
}
async function req(path, {method = 'GET', body, headers = {}} = {}) {
  const url = /^https?:\/\//i.test(path) ? path : ORIGIN + path;
  const res = await fetch(url, {
    method,
    redirect: 'manual',
    headers: {'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9', ...headers, ...(jar.size ? {Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ')} : {})},
    body
  });
  absorb(res);
  return res;
}
async function jsonReq(path, {method = 'POST', body, form, headers = {}} = {}) {
  let payload = body;
  const h = {...headers, ...XHR};
  if (form !== undefined) {
    payload = new URLSearchParams(form).toString();
    h['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
  }
  const res = await req(path, {method, body: payload, headers: h});
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return {status: res.status, url: res.url, json, raw: text};
}
const fieldKeys = (o) => o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o).sort().join(',') : String(o);
const redact = (v) => typeof v === 'string' && v.length ? `[redacted len=${v.length}]` : '[empty]';

console.log('=== cqcvc 超星教务协议探测（只读）===');
const cred = loadEnv(ENV_PATH);
note('env 格式', cred.format);
note('账号存在', cred.username ? `是（长度 ${cred.username.length}，值不输出）` : '否');
note('密码存在', cred.password ? `是（长度 ${cred.password.length}，值不输出）` : '否');
if (cred.kinds?.length) note('凭据行字符形态', cred.kinds.map((k, i) => `第${i + 1}行=${k}`).join(' / '));
if (!cred.username || !cred.password) {
  console.log('!! env 文件缺少账号或密码，请在本地编辑该文件后重试（不要把内容贴进对话）');
  process.exit(2);
}

// ---- 1. 登录（先取登录页会话与隐藏字段，再 RSA 提交）----
console.log('\n[1a] GET /admin/login（先取会话与隐藏字段）');
const pageRes = await req('/admin/login', {headers: {'User-Agent': UA, Accept: 'text/html,application/xhtml+xml'}});
const pageHtml = await pageRes.text();
note('登录页状态/字节', `${pageRes.status}, ${pageHtml.length}`);
const hiddens = {};
for (const tag of (pageHtml.match(/<input[^>]*type=["']hidden["'][^>]*>/gi) ?? [])) {
  const n = /name=["']([^"']+)["']/i.exec(tag);
  const v = /value=["']([^"']*)["']/i.exec(tag);
  if (n) hiddens[n[1]] = v ? v[1] : '';
}
note('隐藏字段名称', Object.keys(hiddens).join(',') || '(无)');
note('登录页 Set-Cookie 名称', [...jar.keys()].join(',') || '(无)');

// ---- 1a-分析: 登录页前端加密方式（--analyze 模式只做这里，不消耗登录尝试）----
if (process.argv.includes('--analyze')) {
  console.log('\n[分析] 登录页加密与表单结构');
  const keyInPage = (pageHtml.match(/MIGf[A-Za-z0-9+/=]{80,}/) ?? [''])[0];
  note('页面 RSA 公钥与插件一致', keyInPage ? String(keyInPage === RSA_PUBLIC_KEY) : '(页面未找到公钥)');
  const frags = [];
  const push = (arr) => { for (const s of (arr ?? []).slice(0, 4)) frags.push(String(s).replace(/\s+/g, ' ').slice(0, 260)); };
  push(pageHtml.match(/function\s+\w*[eE]ncrypt\w*[^{]{0,80}\{[^}]{0,500}\}/g));
  push(pageHtml.match(/setPublicKey\([^)]{0,300}\)/g));
  push(pageHtml.match(/new\s+JSEncrypt\([^)]{0,80}\)/g));
  push(pageHtml.match(/\$\((['"])#?\w*(password|pwd)\w*\1\)[^;]{0,200};/gi));
  push(pageHtml.match(/\.(val|serialize)\(\)[^;]{0,160}(password|encrypt)[^;]{0,160};/gi));
  push(pageHtml.match(/(?:hex|base64)\(\)|\.encrypt\([^)]{0,120}\)/g));
  note('加密相关代码片段', frags.length ? [...new Set(frags)].join(' || ') : '(未找到)');
  const inputs = [...pageHtml.matchAll(/<input[^>]*>/gi)].map(m => m[0]).filter(t => !/type=["']hidden["']/i.test(t));
  note('表单可见字段', inputs.map(t => {
    const n = /name=["']([^"']+)["']/i.exec(t); const i2 = /id=["']([^"']+)["']/i.exec(t);
    return (n ? n[1] : '') + (i2 ? `(#${i2[1]})` : '');
  }).filter(Boolean).join(','));
  const action = /<form[^>]*action=["']([^"']*)["']/i.exec(pageHtml);
  note('表单 action', action ? action[1] : '(无)');
  const scripts = [...pageHtml.matchAll(/<script[^>]*src=["']([^"']+)["']/gi)].map(m => m[1]);
  note('外部脚本', scripts.join(', ') || '(无)');
  const pwdLogic = pageHtml.match(/密码[^\s<]{0,10}|jcaptcha[A-Za-z]*|rememberMe[^\s<"'(){]{0,8}/g) ?? [];
  note('页面出现的登录相关标识', [...new Set(pwdLogic)].join(', ') || '(无)');
  process.exit(3);
}
await sleep(300);

console.log('\n[1b] POST /admin/login');
const encrypted = publicEncrypt(
  {key: Buffer.from(RSA_PUBLIC_KEY, 'base64'), format: 'der', type: 'spki', padding: constants.RSA_PKCS1_PADDING},
  Buffer.from(cred.password)
).toString('base64');
const loginForm = {...hiddens, username: cred.username, password: encrypted, jcaptchaCode: '', rememberMe: '1'};
const loginRes = await req('/admin/login', {
  method: 'POST',
  headers: {'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml'},
  body: new URLSearchParams(loginForm).toString()
});
const loginHtml = await loginRes.text();
const loc = loginRes.headers.get('location') ?? '';
const finalPath = loc ? new URL(loc, ORIGIN).pathname : new URL(loginRes.url).pathname;
note('登录响应状态', String(loginRes.status));
note('登录响应 Location/路径', finalPath);
note('登录是否被打回登录页', String(isLoginUrl(finalPath)));
const markers = [...new Set([...loginHtml.matchAll(/用户名或密码错误|密码错误|用户不存在|账号或密码|验证码错误|请输入验证码|已被锁定|已被禁用|jcaptchaError|rememberMe失效|操作频繁|禁止登录|登录失败[^\s<]{0,12}/gi)].map(m => m[0]))];
note('登录响应错误标记', markers.join(' / ') || '(无)'); 
note('Set-Cookie 名称', [...jar.keys()].join(',') || '(无)');
if (loginRes.status >= 300 && loginRes.status < 400 && loc) {
  await sleep(300);
  const land = await req(loc, {headers: {'User-Agent': UA, Accept: 'text/html'}});
  const landText = await land.text();
  note('跟随落地页', `${land.status} ${new URL(land.url).pathname}（HTML ${landText.length} 字节）`);
}
await sleep(300);

// ---- 2. 当前学年学期 ----
console.log('\n[2] GET getCurrentXnxq');
const cur = await jsonReq('/admin/xsd/xsdcjcx/getCurrentXnxq', {method: 'GET'});
note('状态', String(cur.status));
note('ret', cur.json ? String(cur.json.ret) : '非JSON');
note('data 形态', typeof cur.json?.data === 'string' && /^\d{4}-\d{4}-\d+$/.test(cur.json.data) ? `${cur.json.data}（YYYY-YYYY-N）` : redact(typeof cur.json?.data === 'string' ? cur.json.data : ''));
await sleep(300);

// ---- 3. 学期列表 ----
console.log('\n[3] GET getXqList');
const terms = await jsonReq('/admin/api/jcsj/xqsj/getXqList', {method: 'GET'});
note('状态/ret', `${terms.status}/${terms.json ? terms.json.ret : '非JSON'}`);
const termRows = Array.isArray(terms.json?.data) ? terms.json.data : [];
note('学期数量', String(termRows.length));
note('学期 id 清单', termRows.map(t => String(t?.id)).join(','));
note('学期 xqmc 清单', termRows.map(t => String(t?.xqmc)).join(','));
note('xqdz 原值与日期提取', termRows.map(t => {
  const v = String(t?.xqdz ?? '');
  const d = v.match(/\d{4}-\d{2}-\d{2}/g);
  return `${v} => ${(d ?? []).join('~') || '无日期'}`;
  // 学期起止不是个人数据
}).join(' | '));
const termIds = termRows.map(t => String(t?.id)).filter(Boolean);
await sleep(300);

// ---- 4. 排课周次 ----
console.log('\n[4] GET getCurrentPkZc');
const pk = await jsonReq('/admin/getCurrentPkZc', {method: 'GET'});
note('状态/ret', `${pk.status}/${pk.json ? pk.json.ret : '非JSON'}`);
const pkArr = Array.isArray(pk.json?.data) ? pk.json.data : [];
note('周次数量/最大值', `${pkArr.length}/${Math.max(0, ...pkArr.map(Number))}`);
await sleep(300);

// ---- 5. 课表结构（不打印课程内容）----
console.log('\n[5] POST getXsdSykb（只看结构）');
const sykb = await jsonReq('/admin/getXsdSykb', {method: 'POST', form: {}, headers: {'User-Agent': UA}});
note('状态/ret', `${sykb.status}/${sykb.json ? sykb.json.ret : '非JSON'}`);
const data = sykb.json?.data;
note('data 顶层字段', data ? fieldKeys(data) : '(无)');
const blocks = Array.isArray(data?.jcKcxx) ? data.jcKcxx : [];
note('节次块数量', String(blocks.length));
note('节次块字段', blocks[0] ? fieldKeys(blocks[0]) : '(空)');
const day0 = Array.isArray(blocks[0]?.kbxx) ? blocks[0].kcxx === undefined ? blocks[0].kbxx : blocks[0].kbxx : [];
note('星期块字段', day0[0] ? fieldKeys(day0[0]) : '(空)');
const kcInventory = new Set();
let courseCount = 0;
for (const b of blocks) for (const d of (Array.isArray(b?.kbxx) ? b.kbxx : [])) for (const k of (Array.isArray(d?.kcxx) ? d.kcxx : [])) {
  courseCount++;
  if (k && typeof k === 'object') Object.keys(k).forEach(x => kcInventory.add(x));
}
note('课程条目数量', String(courseCount));
note('课程对象字段并集', [...kcInventory].sort().join(',') || '(空)');
const sampleCourse = blocks.flatMap(b => (Array.isArray(b?.kbxx) ? b.kbxx : [])).flatMap(d => (Array.isArray(d?.kcxx) ? d.kcxx : []))[0];
note('周次相关字段值形态', sampleCourse ? ['zcstr', 'zc', 'zcsm', 'weeks'].filter(k => k in sampleCourse).map(k => `${k}=${sampleCourse[k]}`).join(',') || '(课程对象无周次字段)' : '(无课程)');
const sjk = Array.isArray(data?.sjk) ? data.sjk : [];
note('sjk 行数', String(sjk.length));
const sjkKeys = new Set();
sjk.forEach(r => r && typeof r === 'object' && Object.keys(r).forEach(k => sjkKeys.add(k)));
note('sjk 字段并集', [...sjkKeys].sort().join(',') || '(空)');
note('sjk zcstr 值形态', [...new Set(sjk.map(r => String(r?.zcstr ?? '')).filter(Boolean))].slice(0, 8).join(' | ') || '(空)');
const grid = [];
for (const b of blocks) for (const d of (Array.isArray(b?.kbxx) ? b.kbxx : [])) for (const k of (Array.isArray(d?.kcxx) ? d.kcxx : [])) if (k && k.kcmc && k.kcmc !== '-') grid.push(k);
const hit = (pred) => grid.filter(g => sjk.some(s => pred(g, s))).length;
note('网格课命中 sjk（按课程名）', `${hit((g, s) => String(s.kcmc) === String(g.kcmc))}/${grid.length}`);
note('网格课命中 sjk（课程名+教师对 tmc）', `${hit((g, s) => String(s.kcmc) === String(g.kcmc) && String(s.tmc ?? '') === String(g.teacher ?? ''))}/${grid.length}`);
note('节次真实时间（核对静态作息表）', blocks.map(b => `${b.jc ?? '?'}:${b.kssj ?? '?'}-${b.jssj ?? '?'}`).join(' | '));
await sleep(300);

// ---- 6. 身份探测 listV2（只看字段是否存在）----
console.log('\n[6] POST listV2（只看字段存在性）');
const idp = await jsonReq('/admin/xsd/xk/listV2', {method: 'POST', body: '{}', headers: {'Content-Type': 'application/json', 'User-Agent': UA}});
note('状态/ret', `${idp.status}/${idp.json ? idp.json.ret : '非JSON'}`);
note('data 字段', idp.json?.data && typeof idp.json.data === 'object' ? fieldKeys(idp.json.data) : '(无对象 data)');
note('xsxh/xsxm 存在性', idp.json?.data ? `xsxh=${'xsxh' in idp.json.data}, xsxm=${'xsxm' in idp.json.data}（值不输出）` : '(无)');
await sleep(300);

// ---- 7. 成绩接口参数验证 ----
console.log('\n[7] POST xsdQueryXscjList（学期参数验证）');
const gradesForm = (start, end) => ({'page.pn': '1', 'page.size': '5', startXnxq: start, endXnxq: end, sort: 'xnxq', order: 'desc'});
const tryGrade = async (label, start, end) => {
  const g = await jsonReq('/admin/xsd/xsdcjcx/xsdQueryXscjList?fxbz=0&gridtype=jqgrid', {method: 'POST', form: gradesForm(start, end)});
  note(`${label} 状态/ret`, `${g.status}/${g.json ? g.json.ret : '非JSON'}`);
  note(`${label} total/totalPages`, g.json ? `${g.json.total}/${g.json.totalPages}` : '-');
  const rows = Array.isArray(g.json?.results) ? g.json.results : [];
  note(`${label} 行字段`, rows[0] ? fieldKeys(rows[0]) : '(空)');
  note(`${label} termId 回显形态`, rows[0]?.xnxq ? (/^\d{3}$/.test(String(rows[0].xnxq)) ? '三位数字代码' : String(rows[0].xnxq)) : '(无)');
  return g;
};
const curTermId = termIds.find(id => id === String(cur.json?.data)) ?? termIds[0] ?? '';
const gA = await tryGrade('用学期列表id', curTermId, curTermId);
if (!/^\d{3}$/.test(curTermId) && /^\d{3}$/.test(termIds[0] ?? '')) { /* id 本身就是代码，无需备用 */ }
else if (!/^\d{3}$/.test(curTermId)) {
  await sleep(300);
  await tryGrade('备用startXnxq=001', '001', '001');
}
await sleep(300);

// ---- 8. GPA ----
console.log('\n[8] GET getXspjxfjd');
const gpa = await jsonReq('/admin/xsd/xsdzgcjcx/getXspjxfjd', {method: 'GET'});
note('状态/ret', `${gpa.status}/${gpa.json ? gpa.json.ret : '非JSON'}`);
note('data 形态', gpa.json && typeof gpa.json.data === 'string'
  ? (/^\d+(\.\d+)?$/.test(gpa.json.data.trim()) ? '数字（值不输出）' : JSON.stringify(gpa.json.data))
  : '(非字符串)');
await sleep(300);

// ---- 9. 考试 ----
console.log('\n[9] POST ajaxXsksList');
const examForm = {'queryFields': 'id,kspcmc,xh,xm,kcmc,kssj,jsmc,ksfs,ksxs,zwh,bkcs,bz,rwbz,', '_search': 'false', 'page.size': '5', 'page.pn': '1', 'sort': 'bjdm asc,zwh asc,id', 'order': 'asc'};
const ex = await jsonReq('/admin/xsd/kwglXsdKscx/ajaxXsksList?gridtype=jqgrid', {method: 'POST', form: examForm});
note('状态/ret', `${ex.status}/${ex.json ? ex.json.ret : '非JSON'}`);
note('total/totalPages', ex.json ? `${ex.json.total}/${ex.json.totalPages}` : '-');
const exRows = Array.isArray(ex.json?.results) ? ex.json.results : [];
note('行字段', exRows[0] ? fieldKeys(exRows[0]) : '(空)');

// ---- 10. 插件 UA 是否过 WAF（真机可行性关键）----
console.log('\n[10] getCurrentXnxq with plugin UA');
const uaRes = await req('/admin/xsd/xsdcjcx/getCurrentXnxq', {headers: {'User-Agent': 'ZhengfangAcademicPlugin/1', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest'}});
note('插件 UA 请求状态', String(uaRes.status));
await sleep(300);

// ---- 11. 成绩页框架：找真·学期下拉选项 ----
console.log('\n[11] GET qbcjcx（成绩页框架，找学期选项）');
const fr = await req('/admin/xsd/xsdcjcx/qbcjcx', {headers: {'Accept': 'text/html'}});
const frText = await fr.text();
note('状态/字节', `${fr.status}, ${frText.length}`);
const opts = [...frText.matchAll(/<option[^>]*value=["']([^"']*)["'][^>]*>([^<]{0,40})<\/option>/gi)].map(m => ({v: m[1], t: m[2].trim()}));
const termish = opts.filter(o => /\d{4}-\d{4}|^\d{3}$|学期/.test(`${o.v}${o.t}`));
note('学期类下拉选项', termish.slice(0, 15).map(o => `${o.v}=${o.t}`).join(' | ') || '(未找到)');
const sx = [...frText.matchAll(/startXnxq[^;\n]{0,140}/gi)].map(m => m[0].replace(/\s+/g, ' ')).slice(0, 4);
note('startXnxq 相关代码', sx.join(' || ') || '(无)');
const grids = [...frText.matchAll(/url\s*[:=]\s*['"]([^'"]+)['"]/gi)].map(m => m[1]).slice(0, 6);
note('页面引用的接口', grids.join(', ') || '(无)');
await sleep(300);

// ---- 12. 选课页学期参数（备选学期来源）----
console.log('\n[12] GET qbcjcx 之外：学期相关字典探测');
const dict = await jsonReq('/admin/getDictByGroupCode', {method: 'POST', form: {groupCode: 'xnxq'}});
note('字典 xnxq 状态/ret', `${dict.status}/${dict.json ? dict.json.ret : '非JSON'}`);
note('字典 xnxq 形态', Array.isArray(dict.json?.data)
  ? dict.json.data.slice(0, 10).map(d => `${d?.value ?? d?.dm ?? '?'}=${d?.label ?? d?.mc ?? '?'}`).join(' | ')
  : (dict.json?.data && typeof dict.json.data === 'object' ? fieldKeys(dict.json.data) : redact(typeof dict.json?.data === 'string' ? dict.json.data : '')));

// ----13. 课表结构深挖（找周次/当前周的真正出处）----
console.log('\n[13] POST getXsdSykb（深挖：键树 + 周次样值）');
const sykbRes = await jsonReq('/admin/getXsdSykb', {method: 'POST', form: {}, headers: {'User-Agent': UA}});
const REDACT = /kcmc|teacher|classroom|tmc|jxbzc|jsxm|xm$/i;
const weekLike = [];
const zhouHits = [];
const seenPaths = new Set();
const walk = (node, path, depth) => {
  if (depth > 6) return;
  if (node === null || typeof node !== 'object') {
    if (typeof node === 'string') {
      if (/\d{1,2}\s*-\s*\d{1,2}\s*周|周次|第\d+周|^\d{1,2}(-\d{1,2})+$/.test(node)) weekLike.push(`${path} = ${node}`);
      else if (node.includes('周') && node.length < 40) zhouHits.push(`${path} = ${node}`);
    }
    return;
  }
  if (Array.isArray(node)) {
    const key = `${path}[]`;
    if (!seenPaths.has(key)) { seenPaths.add(key); console.log(`  ${key} len=${node.length}`); }
    if (node[0] !== undefined) walk(node[0], `${path}[0]`, depth + 1);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    const p = `${path}.${k}`;
    if (!seenPaths.has(p)) {
      seenPaths.add(p);
      const shown = REDACT.test(k) && typeof v === 'string' ? '[redacted]' : (typeof v === 'string' || typeof v === 'number' ? JSON.stringify(v) : Array.isArray(v) ? `array(${v.length})` : 'object');
      console.log(`  ${p} = ${shown}`);
    }
    walk(v, p, depth + 1);
  }
};
if (sykbRes.json) {
  try {
    const payload = sykbRes.json;
    console.log('  --- 键树 ---');
    walk(payload, 'data', 0);
    console.log('  --- 周次样值 ---');
    console.log(weekLike.length ? weekLike.slice(0, 30).map(s => `  ${s}`).join('\n') : '  (无)');
    console.log('  --- 含“周”的其他字符串 ---');
    console.log(zhouHits.length ? [...new Set(zhouHits)].slice(0, 15).map(s => `  ${s}`).join('\n') : '  (无)');
  } catch { console.log('  (响应非 JSON)'); }
} else console.log(`  HTTP ${sykbRes.status}（被拦或未登录）`);
await sleep(300);

// ----14. 当前第几周（dqzc）----
console.log('\n[14] GET getZclistByXnxq（当前第几周）');
const dq = await req('/admin/api/getZclistByXnxq', {headers: {'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json'}});
try { const p = JSON.parse(await dq.text()); note('dqzc', JSON.stringify(p?.data ?? p)); } catch { note('dqzc', `HTTP ${dq.status} 非JSON`); }

// ----15. 工作台深挖：字符串扫描 + getMenuList 菜单 ----
console.log('\n[15] GET /admin + getMenuList（菜单与接口字符串扫描）');
const home = await req('/admin', {headers: {'Accept': 'text/html'}});
const homeHtml = await home.text();
note('工作台', `${home.status}, ${homeHtml.length} 字节`);
const anchors = [...homeHtml.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi)]
  .map(m => ({href: m[1], text: m[2].replace(/<[^>]+>/g, '').trim()}));
const menuHits = anchors.filter(a => /课表|教学安排|课程表|排课|kbcx|schedule/i.test(a.text) || /kbcx|schedule|pkbiao|kbzx/i.test(a.href));
note('课表类菜单(锚点)', menuHits.slice(0, 8).map(a => `${a.text} => ${a.href}`).join(' | ') || '(无)');
const allAdminStrings = [...new Set([...homeHtml.matchAll(/["'](\/admin\/[A-Za-z0-9_\-./]+)["']/g)].map(m => m[1]))];
note('页面内 /admin 字符串', allAdminStrings.slice(0, 60).join(' | ') || '(无)');
const kbStrings = allAdminStrings.filter(u => /kb|schedule|zc|pk/i.test(u));
note('其中课表/周次相关', kbStrings.join(' | ') || '(无)');
const iframeSrcs = [...new Set([...homeHtml.matchAll(/<iframe[^>]*src=["']([^"']+)["']/gi)].map(m => m[1]))];
note('iframe 线索', iframeSrcs.slice(0, 10).join(' | ') || '(无)');
const candidates = new Set(kbStrings);
for (const mid of ['1', '2', '3']) {
  const ml = await jsonReq('/admin/getMenuList', {method: 'POST', form: {id: mid}});
  note(`getMenuList id=${mid}`, ml.json ? JSON.stringify(ml.json).slice(0, 500) : `HTTP ${ml.status} 非JSON`);
  if (ml.json) {
    const urls = [...JSON.stringify(ml.json).matchAll(/"(\/admin\/[^"]+)"/g)].map(m => m[1]);
    urls.forEach(u => candidates.add(u));
  }
  await sleep(200);
}
allAdminStrings.filter(u => u.includes('/xsd/')).forEach(u => candidates.add(u));
menuHits.forEach(a => candidates.add(a.href));
note('课表候选 URL', [...candidates].slice(0, 25).join(' | ') || '(无)');
for (const url of [...candidates].slice(0, 3)) {
  if (!url.startsWith('/')) continue;
  console.log(`\n[16] GET ${url}`);
  const page = await req(url, {headers: {'Accept': 'text/html'}});
  const pageHtml = await page.text();
  note('页面', `${page.status}, ${pageHtml.length} 字节`);
  const apis = [...new Set([...pageHtml.matchAll(/["'](\/admin\/[^"'?\s]+)["']/g)].map(m => m[1]))].filter(u => /zc|kb|week|sykb|xnxq/i.test(u));
  note('  课表/周次类接口', apis.slice(0, 20).join(' | ') || '(无)');
  const zcSnips = [...new Set([...pageHtml.matchAll(/.{0,50}(?:周次|教学周|当前周|startWeek|zcstr).{0,80}/g)].map(m => m[0].replace(/\s+/g, ' ')))];
  note('  周次代码片段', zcSnips.slice(0, 12).join(' || ') || '(无)');
  const zcVals = [...new Set([...pageHtml.matchAll(/[^"'>]{0,30}\d{1,2}\s*-\s*\d{1,2}\s*周[^"'<]{0,30}/g)].map(m => m[0].trim()))];
  note('  周次样值', zcVals.slice(0, 15).join(' | ') || '(无)');
}

// ----17. 课表页真身：queryKbForXsd 的调用方式与响应结构 ----
console.log('\n[17] queryKbForXsd 深挖');
const kbPage = await req('/admin/pkgl/xskb/queryKbForXsd', {headers: {'Accept': 'text/html'}});
const kbHtml = (await kbPage.text()).replace(/\s+/g, ' ');
note('课表页(复取)', `${kbPage.status}, ${kbHtml.length} 字符`);
for (const key of ['queryKbForXsd', 'reportforxskb', 'getbzxx', 'sdpkkbList']) {
  const ctx = new RegExp('.{0,160}' + key + '.{0,260}', 'i').exec(kbHtml);
  note(`${key} 调用上下文`, ctx ? ctx[0] : '(未找到)');
}
await sleep(200);
let kb = await jsonReq('/admin/pkgl/xskb/queryKbForXsd', {method: 'GET'});
if (!kb.json) kb = await jsonReq('/admin/pkgl/xskb/queryKbForXsd', {method: 'POST', form: {}, headers: {'User-Agent': UA}});
note('queryKbForXsd 响应', kb.json ? `HTTP ${kb.status}, JSON` : `HTTP ${kb.status} 非JSON ${String(kb.raw).slice(0, 120)}`);
if (kb.json) {
  console.log('  --- 键树 ---');
  walk(kb.json, 'kb', 0);
  const zcs = [];
  const grab = (n, p) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.slice(0, 50).forEach((x, i) => grab(x, `${p}[${i}]`)); return; }
    for (const [k, v] of Object.entries(n)) {
      if (k === 'zcstr') zcs.push(`${p}.zcstr = ${JSON.stringify(v)}`);
      grab(v, `${p}.${k}`);
    }
  };
  grab(kb.json, 'kb');
  note('zcstr 全量样本(前30)', zcs.slice(0, 30).join(' | ') || '(无)');
}

// ----18. 真·课表数据源 sdpkkbList ----
console.log('\n[18] sdpkkbList（真·课表数据源）');
const kbUrl = '/admin/pkgl/xskb/queryKbForXsd?xnxq=2026-2027-1&zxzc=&zdzc=&xskbxslx=0';
const kbPage2 = await req(kbUrl, {headers: {'Accept': 'text/html'}});
const kbHtml2 = await kbPage2.text();
const grabInput = (id) => {
  const tags = kbHtml2.match(/<input[^>]*>/gi) ?? [];
  for (const t of tags) {
    if (new RegExp(`id=["']${id}["']`, 'i').test(t)) {
      const v = /value=["']([^"']*)["']/.exec(t);
      return v ? v[1] : '';
    }
  }
  return '';
};
const xhid = grabInput('xhid');
const xqdm = grabInput('xqdm');
const xnxqH = grabInput('xnxq');
note('课表页隐藏域', `状态=${kbPage2.status}, xhid长度=${xhid.length}, xqdm=${JSON.stringify(xqdm)}, xnxq=${JSON.stringify(xnxqH)}`);
await sleep(200);
const skQuery = `xnxq=2026-2027-1&xhid=${encodeURIComponent(xhid)}&xqdm=${encodeURIComponent(xqdm)}&zdzc=&zxzc=&xskbxslx=0`;
let sk = await jsonReq(`/admin/pkgl/xskb/sdpkkbList?${skQuery}`, {method: 'GET', headers: {'User-Agent': UA}});
if (!sk.json) sk = await jsonReq('/admin/pkgl/xskb/sdpkkbList', {method: 'POST', form: {xnxq: '2026-2027-1', xhid, xqdm, zdzc: '', zxzc: '', xskbxslx: '0'}, headers: {'User-Agent': UA}});
note('sdpkkbList', sk.json ? `HTTP ${sk.status} JSON` : `HTTP ${sk.status} 非JSON ${String(sk.raw).slice(0, 150)}`);
if (sk.json) {
  console.log('  --- 键树 ---');
  walk(sk.json, 'sk', 0);
  const zcs = [];
  const grabZc = (n, p) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.slice(0, 120).forEach((x, i) => grabZc(x, `${p}[${i}]`)); return; }
    for (const [k, v] of Object.entries(n)) {
      if (k === 'zcstr') zcs.push(`${p} = ${JSON.stringify(v)}`);
      grabZc(v, `${p}.${k}`);
    }
  };
  grabZc(sk.json, 'sk');
  note('zcstr 样本(前30)', zcs.slice(0, 30).join(' | ') || '(无)');
}

console.log('\n=== 探测完成 ===');
console.log(findings.map(f => `- ${f}`).join('\n'));
