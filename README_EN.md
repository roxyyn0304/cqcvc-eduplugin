# CQCVC Chaoxing Academic Plugin

> A standalone academic plugin (eduplugin) for the Zhengfang Academic App — lets students of Chongqing City Vocational College view their timetable, class periods, grades and exams in-app. Protocol verified against the live system with a read-only probe; all 14 offline test cases pass.

🌐 **English** | [简体中文](README.md)

## 📖 Introduction

- **Who it's for**: Students of Chongqing City Vocational College (`jw.cqcvc.edu.cn`), whose school runs the **Chaoxing Academic Management System** — incompatible with the app's built-in Zhengfang/Qingguo adapters, so it doesn't work out of the box
- **What it is**: A `kind: independent` academic plugin that implements login, timetable, grades and all other protocols inside the plugin itself — **no APK modification**, independently iterable and publishable
- **Tech stack**: TypeScript → QuickJS sandbox, academic API v1 contract, official [plugin-starter-v3 dev kit](https://plugins.hidisiwa.xyz/developers)
- **Origins**: Scaffolded from the official `mock-school` template; protocol documented in [cqcvc-api](https://github.com/roxyyn0304/cqcvc-api) reverse-engineering notes
## ✨ Features

### 🎯 Core features

| Feature | Description |
|------|------|
| 🔐 Login | Password encrypted with the platform-wide RSA public key; login-page prefetch + `302 → /admin` detection; identity probe falls back to the student ID |
| 🔄 Session validation | Probes the current-term endpoint; redirect to the login page means `SESSION_EXPIRED`; handles both cold and warm sessions |
| 📅 Timetable | Parses the 10-period × 7-day grid, merges adjacent same-course slots, parses week strings (`1-8周,10`, even/odd weeks); falls back to full-semester when no week data exists |
| 🕘 Class periods | The school's 10-period schedule, verified field-by-field against real `kssj/jssj` values from the API |
| 📚 Term list | Parses the `select#startXnxq` dropdown on the grades page + current-term detection (`2026-2027-1` format) |
| 📊 Grades | jqGrid pagination, course-nature dictionary translation, total credits, GPA (auto-omitted when the API returns “暂无”) |
| 📝 Exam schedule | jqGrid pagination, exam room & seat mapping, malformed-row filtering |

### 🧰 Developer & verification tools

| Tool | Description |
|------|------|
| Offline test cases | 14 fixtures executed in an isolated QuickJS runtime with ordered network mocks; covers login success/failure, session expiry, pagination, week parsing and dirty data |
| Live protocol probe | `tools/live-probe.mjs`: read-only probe script; credentials are read from a local file only, output is redacted (student ID, name, cookies and grades are never printed) |
| Packaging | `pack` builds the `.eduplugin` installer; `source-zip` builds the review source archive |

## 🚀 Quick Start

### Requirements

| Role | Needs |
|------|------|
| End user | Android Zhengfang Academic App + `.eduplugin` package (⚠️ see the UA restriction under Notes) |
| Developer | Node.js ≥ 20 + [plugin-starter-v3 dev kit](https://plugins.hidisiwa.xyz/downloads/plugin-starter-v3.zip) |

### Installation (easiest way)

1. Download `local.cqcvc-1.0.0.eduplugin` from [Releases](https://github.com/roxyyn0304/cqcvc-eduplugin/releases)
2. Open the App → Advanced tools → Import the plugin package
3. Once matched to `jw.cqcvc.edu.cn`, log in with your student ID and password

> ⛔ **Current status**: the app's plugin channel sends a hardcoded User-Agent that the school's WAF rejects (403), so the plugin cannot run on a real device until the upstream fix lands. See [issue #28](https://github.com/znjhahaha/zhengfang-apk/issues/28) and Notes below.

### Build from source (developers)

```bash
git clone https://github.com/roxyyn0304/cqcvc-eduplugin.git
# Place this repository into the dev kit's plugins/ directory as cqcvc:
#   plugin-starter-v3/plugins/cqcvc/
cd plugin-starter-v3
npm ci
npm run plugin -- check cqcvc   # manifest & type checks
npm run plugin -- test cqcvc    # run all 14 offline cases
npm run plugin -- pack cqcvc    # → dist/local.cqcvc-1.0.0.eduplugin
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

### Implemented capabilities (9)

| Capability | Endpoint | Notes |
|------|------|------|
| `auth.start` | `GET` + `POST /admin/login` | RSA (PKCS1v15) login, verified `302 → /admin` |
| `auth.resume` / `auth.refreshCaptcha` | — | No captcha / web continuation on this school; returns `UNSUPPORTED` |
| `auth.validate` | `GET /admin/xsd/xsdcjcx/getCurrentXnxq` | Redirect to login page means session expired |
| `study.terms` | `GET /admin/xsd/xsdcjcx/qbcjcx` + `getCurrentXnxq` | Term dropdown options + current term |
| `study.schedule` | `GET /admin/getCurrentPkZc` + `POST /admin/getXsdSykb` | Week count + current-term timetable |
| `study.calendar` | Static config | 10-period schedule (verified against live API) |
| `study.grades` | `POST /admin/xsd/xsdcjcx/xsdQueryXscjList` + `GET getXspjxfjd` | Grade pagination + GPA |
| `study.exams` | `POST /admin/xsd/kwglXsdKscx/ajaxXsksList` | Exam schedule pagination |

### Network rules

| Rule | Methods | Purpose |
|------|------|------|
| `/admin/login` | POST | Credential submission (declared separately for review) |
| `/admin` | GET / POST | All query endpoints + login redirect landing (`query` + `auth`) |
| `/login` | GET | Defensive allowance: login-failure / session-expiry redirect target |

## ⚠️ Notes

- ⛔ **Real-device blocker (host UA)**: the app's `PluginHost.kt` hardcodes `User-Agent: ZhengfangAcademicPlugin/1`, and the school's WAF returns 403 for that UA (browser UA measured 200 on the same endpoint/session — UA was the only difference). Plugins cannot override it; the proposed fix is tracked in [issue #28](https://github.com/znjhahaha/zhengfang-apk/issues/28) (manifest-declared `userAgent`)
- 🚧 **Not implemented**: the entire `selection.*` group (drop/selection protocol undocumented — omitted per the all-or-nothing group rule) and `study.gradeDetails` (no interface sample)
- 🔒 **Security**: credentials never enter source code, samples, logs or chat; all test fixtures are fictional and redacted; the probe is read-only with no mutations
- ✅ **Verification layers**: offline samples pass (14/14) → live protocol verified (2026-09-23) → on-device acceptance pending the UA fix
- 📜 For learning and personal use only; comply with your school's rules and applicable laws

## 🙏 Acknowledgements

- [cqcvc-api](https://github.com/roxyyn0304/cqcvc-api) reverse-engineering notes — protocol samples
- [znjhahaha/zhengfang-apk](https://github.com/znjhahaha/zhengfang-apk) — the host app and plugin architecture (host gap filed as [issue #28](https://github.com/znjhahaha/zhengfang-apk/issues/28))
- [Plugin developer docs](https://plugins.hidisiwa.xyz/developers) and the plugin-starter-v3 dev kit

## 📄 License

MIT © roxyyn0304, see [LICENSE](LICENSE).
