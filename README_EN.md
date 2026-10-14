# CQCVC Chaoxing Academic Plugin

> A standalone academic plugin (eduplugin) for the Zhengfang Academic App — lets students of Chongqing City Vocational College view their timetable, class periods, grades and exams — and **enrol / drop courses** — in-app. Protocol verified against the live system; all 26 offline test cases pass.

🌐 **English** | [简体中文](README.md)

## 📖 Introduction

- **Who it's for**: Students of Chongqing City Vocational College (`jw.cqcvc.edu.cn`), whose school runs the **Chaoxing Academic Management System** — incompatible with the app's built-in Zhengfang/Qingguo adapters, so it doesn't work out of the box
- **What it is**: A `kind: independent` academic plugin that implements login, timetable, grades and all other protocols inside the plugin itself — **no APK modification**, independently iterable and publishable
- **Tech stack**: TypeScript → QuickJS sandbox, academic API v3 contract, **official SDK 3.6.1** (check / test / pack all green under the latest kit since 2026-10-14), official [plugin-starter-v3 dev kit](https://plugins.hidisiwa.xyz/developers)
- **Origins**: Scaffolded from the official `mock-school` template; protocol documented in [cqcvc-api](https://github.com/roxyyn0304/cqcvc-api) reverse-engineering notes
## ✨ Features

### 🎯 Core features

| Feature | Description |
|------|------|
| 🔐 Login | Password encrypted with the platform-wide RSA public key; login-page prefetch + `302 → /admin` detection; identity probe falls back to the student ID |
| 🔄 Session validation | Probes the current-term endpoint; redirect to the login page means `SESSION_EXPIRED`; handles both cold and warm sessions |
| 📅 Timetable | Parses the 10-period × 7-day grid and merges adjacent same-course slots; weeks come from the web timetable's own endpoint `sdpkkbList` (**room-first** join: rows in a shared slot are attributed by `croommc`, same-start-period rows have their weeks unioned — no row is ever dropped; supports `4-5,9-18` ranges and expanded lists), falling back to full-semester when the week source is unavailable |
| 🕘 Class periods | The school's 10-period schedule, verified field-by-field against real `kssj/jssj` values from the API |
| 📚 Term list | Parses the `select#startXnxq` dropdown on the grades page + current-term detection (`2026-2027-1` format) |
| 📊 Grades | jqGrid pagination, course-nature dictionary translation, total credits, GPA (auto-omitted when the API returns “暂无”) |
| 📝 Exam schedule | jqGrid pagination, exam room & seat mapping, malformed-row filtering |
| 📚 Enrol / drop | Browse round → course → class, **query selected courses**, enrol or drop with one tap (writes require in-app confirmation); keyword & teacher filters |

### 🧰 Developer & verification tools

| Tool | Description |
|------|------|
| Offline test cases | 26 fixtures executed in an isolated QuickJS runtime with ordered network mocks; covers login success/failure, session expiry, pagination, week parsing, **multi-room / multi-week slot joining**, **dynamic period table + static fallback**, **the six selection methods (round / course / section / enrolled / select / drop**) and dirty data |
| Live protocol probe | `tools/live-probe.mjs`: read-only probe script; credentials are read from a local file only, output is redacted (student ID, name, cookies and grades are never printed) |
| Packaging | `pack` builds the `.eduplugin` installer; `source-zip` builds the review source archive |

## 🚀 Quick Start

### Requirements

| Role | Needs |
|------|------|
| End user | Android Zhengfang Academic App ≥ v1.0.84 + `.eduplugin` package (the manifest declares `school.userAgent`, which older hosts reject) |
| Developer | Node.js ≥ 20 + [plugin-starter-v3 dev kit](https://plugins.hidisiwa.xyz/downloads/plugin-starter-v3.zip) |

### Installation (easiest way)

1. Download the `.eduplugin` package from the [Releases](https://github.com/roxyyn0304/cqcvc-eduplugin/releases) page
2. Open the App → Plugin Center → "⋯" (top-right) → "导入、回滚与开发工具" (Import, rollback & developer tools), and turn on the **"开发者模式" (Developer mode)** switch
   - ⚠️ **Required**: the Releases package is built by GitHub Actions and carries **no official signature**. With developer mode off, the import fails with "签名无效或签名密钥未受信任" (invalid or untrusted signature). The Plugin Center's "从文件安装" (Install from file) menu runs the strict verification path and rejects unsigned packages too — you must enter through "导入、回滚与开发工具". The switch footer states "开发模式允许导入未签名的本地包，请仅使用可信来源" (development mode allows importing unsigned local packages; use trusted sources only).
3. On the same page, tap **"导入适配包" (Import adapter package)** and pick the downloaded `.eduplugin` file
4. Once matched to `jw.cqcvc.edu.cn`, log in with your student ID and password

> ✅ **Current status (v1.1.0 / API 3 / SDK 3.6.1)**:
> - **v1.1.0 (2026-10-14)**: (1) **the complete selection group** — `catalog` ← `listV2.mapsList`, `courses` ← `listjxbDataV2.initData`, `sections` ← `queryChildClassesV2.extend.zjxb` (falls back to the class itself when there are no sub-classes), `enrolled` ← selected-course query `listYxkc` (17 rows measured), `select`/`drop` ← `xsdXkV2`/`xsdTkV2` (`purpose=mutation`, user confirmation); (2) **real-device fixes** — login is a three-hop chain, so the `/frontend` scope was added (the host allowlist used to block the third hop and throw NETWORK_RETRYABLE), a 5xx landing no longer fails the login, HTTP 403 maps to `PERMISSION_DENIED`, every error carries `details`, input is trimmed, `select`/`drop` resolve `pcid` automatically when `roundId` is missing, and the UA is now Android Chrome Mobile; (3) the term start date comes from the authoritative `zclist[0].minrq` (formula kept as fallback; it was 5 days early).
> - **v1.0.10 (2026-10-14, driven by a live probe)**: `getZclistByXnxq` **requires `xqid`** — without it only `dqzc` comes back; with it you also get `jcsjszList` (periods), `zclist` (**authoritative week calendar**: `minrq/maxrq/rqfw` per week), `jsxq` (scheduling settings) and `kbxssj`. Start date now prefers `zclist[0].minrq` (week 1 here is a partial week, so the old formula returned 08-31 — **5 days earlier** than the real 09-05), falling back to the Date-header + `dqzc` formula; the campus id is cached from the timetable page's `xqdm`, otherwise `getXqList` is queried.
> - **v1.0.9 (2026-10-14)**: the daily period table is now **served by the API** — `data.jcsjszList` from `getZclistByXnxq` (bound to campus + term; falls back to the built-in 10-period table when absent); the `listV2` request body now matches real traffic (**no body**). One offline case added (static fallback), 16 in total.
> - ✅ **v1.0.9 / v1.0.10 both green under the official SDK 3.6.1 dev kit** (2026-10-14): `doctor` (node 26 / SDK 3.6.1 / QuickJS ready / sdkIntegrity verified) · `check cqcvc` (9 capabilities) · `test cqcvc` (**16/16**) · `submit-check` · `pack` → v1.0.9 = 7,953 bytes; **v1.0.10 = 8,296 bytes** (SHA-256 `06f3fe2a5ab6baaf72f4af46515158d1fdc78904ec901230560ff274e5196aa5`).
> - **Term display name**: now renders in the friendly form "2026-2027 第一学期" (`id` stays the raw `2026-2027-1`, so grade/schedule API parameters are unchanged). v1.0.7 was originally re-packed under **SDK 3.2.4** with check / 15 offline samples / submit-check all green, then **re-verified on 2026-10-07 under the latest SDK 3.2.9 dev kit — all green, pack included** (**v1.0.7 has not been re-accepted on device** — display name and build baseline only).
> - **Manifest `apiVersion: 3`** (migrated under SDK 3.2.1): ships to the `/academic-plugins-v3/` and v2 catalog channels while **staying compatible with 1.0.87 clients** — the legacy channel `[3, 32]` is intentional: the 1.0.87 host's strict schema rejects 3.2-only fields such as `license`/`minAppVersionCode`, and the self-built app is a 1.0.87 baseline.

### Build from source (recommended)

```bash
git clone https://github.com/roxyyn0304/cqcvc-eduplugin.git
# After unzipping plugin-starter-v3.zip (see Requirements) into the current directory, put this repo into its plugins/ as cqcvc:
unzip plugin-starter-v3.zip -d plugin-starter-v3
cp -R cqcvc-eduplugin plugin-starter-v3/plugins/cqcvc
cd plugin-starter-v3
npm ci                # In China, add a mirror: --registry=https://registry.npmmirror.com
npm run plugin -- check cqcvc   # manifest & type checks
npm run plugin -- test cqcvc    # run all 26 offline cases
npm run plugin -- pack cqcvc    # → dist/local.cqcvc-*.eduplugin, import it into the app
```

## 📖 Usage Guide

### Development commands

| Command | Purpose |
|------|------|
| `npm run plugin -- doctor` | Environment check (Node / QuickJS / SDK integrity) |
| `npm run plugin -- check cqcvc` | Strict TypeScript compile + manifest schema + capability parity |
| `npm run plugin -- test cqcvc` | Run all offline test cases |
| `npm run plugin -- pack cqcvc` | Build the installer (`dist/*.eduplugin`) |
| `npm run plugin -- source-zip cqcvc` | Build the review source ZIP |

### Live protocol probe (optional)

```bash
# Credentials file: two lines — line 1 student ID, line 2 password
# (ignored by .gitignore, never commit it)
node tools/live-probe.mjs ./credentials.env

# Analyze the login page encryption only — no submission, no login attempt consumed
node tools/live-probe.mjs --analyze ./credentials.env
```

The probe is strictly read-only (login + queries); output contains only status codes, field names, counts and term codes.

## 🔌 API Reference

### Implemented capabilities (15)

| Capability | Endpoint | Notes |
|------|------|------|
| `auth.start` | `GET` + `POST /admin/login` | RSA (PKCS1v15) login, verified `302 → /admin` |
| `auth.resume` / `auth.refreshCaptcha` | — | No captcha / web continuation on this school; returns `UNSUPPORTED` |
| `auth.validate` | `GET /admin/xsd/xsdcjcx/getCurrentXnxq` | Redirect to login page means session expired |
| `study.terms` | `GET /admin/xsd/xsdcjcx/qbcjcx` + `getCurrentXnxq` | Term dropdown options + current term |
| `study.schedule` | `GET getCurrentPkZc` + `POST getXsdSykb` (grid) + `GET queryKbForXsd` hidden fields → `GET sdpkkbList` (real weeks) | Week count + current-term timetable + true per-course weeks (room-first join; multi-room / multi-week rows in one slot are never dropped) |
| `study.calendar` | `GET getZclistByXnxq?xnxq=…&role=&userId=&xqid=…` (+ `getXqList` for the campus id) | Periods come from `data.jcsjszList` (fallback: built-in 10 periods); term start = **authoritative `data.zclist[0].minrq`**, falling back to the Date-header + `dqzc` formula (current term only) |
| `study.grades` | `POST /admin/xsd/xsdcjcx/xsdQueryXscjList` + `GET getXspjxfjd` | Grade pagination + GPA |
| `study.exams` | `POST /admin/xsd/kwglXsdKscx/ajaxXsksList` | Exam schedule pagination |
| `selection.catalog` | `POST /admin/xsd/xk/listV2` | Selection rounds: `mapsList.xkgzid` is the `pcid`, `xkgzMc` the name; the same call returns the `pcencs` cipher per round |
| `selection.courses` | `POST /admin/xsd/xk/listjxbDataV2` | Courses (classes) in a round from `initData` — name / teacher / credits / enrolled count / timetable; supports `keyword` and `teacher` filters |
| `selection.sections` | `POST /admin/xsd/xk/queryChildClassesV2` | Sub-classes from `extend.zjxb`; when the current round has none (`sfyzjxb` = 0 for every class, measured) the class itself is returned |
| `selection.enrolled` | `GET /admin/xsd/yxkccx/listYxkc` | **Selected-course query** (jqGrid, 17 rows measured): `kcmc`/`kcid`/`id`/`rkjs`/`sksjdd`/`xf` |
| `selection.select` | `POST /admin/xsd/xk/xsdXkV2` | Enrol (`jxbid`+`pcid`, `purpose=mutation`, user confirmation) → `选课成功`; **timetable-conflict confirmation**: when the backend returns `ret=0` + `extend.needConfirm=true`, the plugin answers `{confirmed:false, message:<conflict text>}` and the next call re-sends with `sfqc=1` to skip the conflict check |
| `selection.drop` | `POST /admin/xsd/xk/xsdTkV2` | Drop (`jxbid`+`pcid`, `purpose=mutation`, user confirmation) → `退课成功` |

### Network rules

| Rule | Methods | Purpose |
|------|------|------|
| `/admin/login` | POST | Credential submission (declared separately for review) |
| `/admin` | GET / POST | All endpoints + login redirect landing (`query` + `auth` + **`mutation`**: enrol / drop) |
| `/login` | GET | Defensive allowance: login-failure / session-expiry redirect target |

## ⚠️ Notes

- 🚧 **Not implemented**: `study.gradeDetails` (grade detail, no interface sample); `selection.filters` (optional SDK method, App 97+, the current round exposes no filter groups)
- 🔒 **Security**: credentials never enter source code, samples, logs or chat; all test fixtures are fictional and redacted; the probe is read-only with no mutations
- ✅ **Verification layers**:
  1. Offline samples pass (26/26, all 44 HTTP samples assert the UA)
  2. Live protocol verified (2026-09-23, week join 38/38 with 0 unused rows)
  3. On-device main-UI login succeeded (2026-09-23, log evidence: single bind, zero timeouts)
  4. Full on-device acceptance passed (2026-09-24, schedule/grades/exams pages and session all working)
- 📜 For learning and personal use only; comply with your school's rules and applicable laws

## 🙏 Acknowledgements

- [cqcvc-api](https://github.com/roxyyn0304/cqcvc-api) reverse-engineering notes — protocol samples
- [znjhahaha/zhengfang-apk](https://github.com/znjhahaha/zhengfang-apk) — the host app and plugin architecture
- [Plugin developer docs](https://plugins.hidisiwa.xyz/developers) and the plugin-starter-v3 dev kit

## 📄 License

MIT © roxyyn0304, see [LICENSE](LICENSE).
