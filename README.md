# 重庆城市职业学院超星教务适配插件

> 独立教务插件（eduplugin）：让重庆城市职业学院学生在正方教务 App 内查看课表、作息、成绩与考试——协议基于真实账号只读验证，离线用例 15/15 全绿。

🌐 [English](README_EN.md) | **简体中文**

## 📖 简介

- **为谁做**：重庆城市职业学院（`jw.cqcvc.edu.cn`）学生——本校使用**超星综合教学管理系统**，与 App 内置的正方/青果适配不兼容，无法开箱即用
- **是什么**：`kind: independent` 独立教务插件，登录、课表、成绩等协议全部在插件内实现，**不改 APK**，可单独迭代、单独上架
- **技术栈**：TypeScript → QuickJS 沙箱执行、教务 API v1 契约、官方 [plugin-starter-v3 开发套件](https://plugins.hidisiwa.xyz/developers)
- **来源**：模板改造自官方 `mock-school`；接口协议来自 [cqcvc-api](https://github.com/roxyyn0304/cqcvc-api) 逆向文档
## ✨ 功能特性

### 🎯 核心功能

| 功能 | 说明 |
|------|------|
| 🔐 登录认证 | 密码用平台共用 RSA 公钥加密提交，登录页预取 + `302 → /admin` 判定，身份读取失败回退学号 |
| 🔄 会话校验 | 探测当前学年学期接口，被重定向到登录页即 `SESSION_EXPIRED`；冷、热会话双路径 |
| 📅 课表 | 解析 10 节次 × 7 天网格，相邻同学时段自动合并；周次取自网页课表同源接口 `sdpkkbList`（**教室优先**连接：同格多教室/多周次行按 `croommc` 归属、同位次多行周次取并集，不丢行；支持 `4-5,9-18` 区间与展开式），周次源不可用时回退全学期 |
| 🕘 作息表 | 本校 10 节次时间表，已与课表接口真实 `kssj/jssj` 逐节核对一致 |
| 📚 学期列表 | 解析成绩页 `select#startXnxq` 下拉选项 + 当前学期判定（`2026-2027-1` 形态） |
| 📊 成绩 | jqGrid 分页、课程性质字典翻译、总学分累计、平均学分绩点（“暂无”自动省略） |
| 📝 考试安排 | jqGrid 分页、考场与座位号映射、脏数据行过滤 |

### 🧰 开发与验证工具

| 工具 | 说明 |
|------|------|
| 离线用例 | 15 条 fixtures，QuickJS 隔离执行、网络全靠有序 mock；覆盖登录成败、会话过期、分页、周次解析、**同格多教室多周次贴合**与脏数据 |
| 真实协议探测 | `tools/live-probe.mjs`：只读探测脚本，凭据仅本地文件读取，输出脱敏（学号、姓名、Cookie、成绩值一律不打印） |
| 打包 | `pack` 生成 `.eduplugin` 安装包；`source-zip` 生成审核用源码包 |

## 🚀 快速开始

### 环境要求

| 角色 | 需要 |
|------|------|
| 使用插件 | Android 正方教务 App ≥ v1.0.84 + `.eduplugin` 安装包（清单 UA 声明需新版宿主，见「注意事项」） |
| 开发调试 | Node.js ≥ 20 + [plugin-starter-v3 开发套件](https://plugins.hidisiwa.xyz/downloads/plugin-starter-v3.zip) |

### 安装（最简方式）

1. 从 [Releases](https://github.com/roxyyn0304/cqcvc-eduplugin/releases) 页面下载 `.eduplugin` 安装包（本项目**不做例行发版**，页面没有现成包时按下方「源码构建」自行编译即可）
2. 打开 App → 高级工具 → 导入插件安装包
3. 匹配到 `jw.cqcvc.edu.cn` 后，用学号密码登录

> ✅ **当前状态**：UA 缺口已由官方修复——App ≥ v1.0.84 起清单可声明 `school.userAgent`（[issue #28](https://github.com/znjhahaha/zhengfang-apk/issues/28) 已修复），本插件 v1.0.5 已声明实测放行的浏览器标识，**原版 App 的 UA 已开箱可用**。但「击杀隔离沙箱进程」（坑2）上游未修，且**不限 HyperOS——官方原版在小米（HyperOS）与 Realme 上均复现超时**（见「⚠️ 注意事项」）；自用包 `zhengfang-1.0.87-hyperos-fix.apk`（清单改动、设备无关）已于 2026-09-24 **小米 + Realme 双机真机验收全部通过**。

### 源码构建（推荐，本项目以编译教程为主）

```bash
git clone https://github.com/roxyyn0304/cqcvc-eduplugin.git
# 将本仓库放入开发套件的 plugins/ 目录，命名为 cqcvc：
#   plugin-starter-v3/plugins/cqcvc/
cd plugin-starter-v3
npm ci                # 国内网络可加镜像：--registry=https://registry.npmmirror.com
npm run plugin -- check cqcvc   # 清单与类型检查
npm run plugin -- test cqcvc    # 运行 15 条离线用例
npm run plugin -- pack cqcvc    # → dist/local.cqcvc-*.eduplugin，导入 App 即可
```

## 📖 使用指南

### 开发命令

| 命令 | 作用 |
|------|------|
| `npm run plugin -- doctor` | 环境体检（Node / QuickJS / SDK 完整性） |
| `npm run plugin -- check cqcvc` | TypeScript 严格编译 + 清单 Schema + 能力一致性 |
| `npm run plugin -- test cqcvc` | 运行全部离线用例 |
| `npm run plugin -- pack cqcvc` | 打包安装包（`dist/*.eduplugin`） |
| `npm run plugin -- source-zip cqcvc` | 生成上传审核用源码 ZIP |

### 真实协议探测（可选）

```bash
# 凭据文件格式：两行——第一行学号，第二行密码（已被 .gitignore 忽略，切勿提交）
node tools/live-probe.mjs ./credentials.env

# 只分析登录页加密方式，不提交、不消耗登录尝试
node tools/live-probe.mjs --analyze ./credentials.env
```

探测脚本全程只读（登录 + 查询），输出仅含状态码、字段名、数量与学期代码。

## 🔌 API 参考

### 已实现能力（9 项）

| 能力 | 端点 | 说明 |
|------|------|------|
| `auth.start` | `GET` + `POST /admin/login` | RSA（PKCS1v15）加密登录，实测 `302 → /admin` |
| `auth.resume` / `auth.refreshCaptcha` | — | 本校不触发验证码/网页续接，返回 `UNSUPPORTED` |
| `auth.validate` | `GET /admin/xsd/xsdcjcx/getCurrentXnxq` | 重定向登录页即会话过期 |
| `study.terms` | `GET /admin/xsd/xsdcjcx/qbcjcx` + `getCurrentXnxq` | 学期下拉选项 + 当前学期 |
| `study.schedule` | `GET getCurrentPkZc` + `POST getXsdSykb`（网格）+ `GET queryKbForXsd` 隐藏域 → `GET sdpkkbList`（真周次） | 周数 + 当前学期课表 + 每门课真实周次（教室优先贴合，同格多教室/多周次行不丢） |
| `study.calendar` | `GET getZclistByXnxq`（`dqzc` + 响应 `Date` 头）+ 静态作息 | 开学日期 = 服务器本周一 − (当前周−1) 周（第一周周一，服务端时间推算，仅当前学期）+ 本校 10 节次时间（已实测核对） |
| `study.grades` | `POST /admin/xsd/xsdcjcx/xsdQueryXscjList` + `GET getXspjxfjd` | 成绩分页 + 平均学分绩点 |
| `study.exams` | `POST /admin/xsd/kwglXsdKscx/ajaxXsksList` | 考试安排分页 |

### 网络规则

| 规则 | 方法 | 用途 |
|------|------|------|
| `/admin/login` | POST | 凭据提交（单独声明便于审核） |
| `/admin` | GET / POST | 全部查询端点 + 登录跳转承接（`query` + `auth`） |
| `/login` | GET | 防御性放行：登录失败/会话过期的重定向目标 |

## ⚠️ 注意事项

- ✅ **宿主 UA（已适配）**：本校 WAF 按浏览器 UA 特征放行（实测同端点同会话仅 UA 不同：浏览器 UA 200、`ZhengfangAcademicPlugin/1` 403，登录 POST 用浏览器 UA 返回 `302 → /admin`）。App ≥ v1.0.84 起清单可声明 `school.userAgent`（[issue #28](https://github.com/znjhahaha/zhengfang-apk/issues/28) 已修复），本插件 v1.0.5 在 `school.userAgent` 声明与真实探测一致的 Edge/Windows 浏览器标识（**声明原因即上述 WAF 放行需求，附实测 200/403 对比**）；离线 25 条 HTTP 样本均断言宿主最终发出的 UA。⚠️ 旧版 App 的严格 Schema 会拒绝该字段，**需 App ≥ v1.0.84**
- ⚠️ **真机坑2（已由自用包规避）**：宿主以 `android:isolatedProcess` 拉起的沙箱进程会在服务发布**前**被系统击杀（小米 HyperOS 上有 `isolated not needed` 日志，启动后 ~0.6 秒必死），客户端永远等不到 `onServiceConnected`，绑定 `withTimeout(10_000)` 到点报「插件调用超时」。**2026-09-24 补充：官方原版在 Realme 手机上同样复现——非 HyperOS 独有**（多机型通病；Realme 未采日志，击杀机制待证实、症状一致）。自用包清单已移除 `isolatedProcess`（保留 `:academic_plugin` 独立进程，仅放弃隔离 UID），**清单改动与设备无关**：小米与 Realme 双机均已复验通过（2026-09-24）；上游修复建议另行反馈（两 OEM 复现 + 双机修复验证，证据已足）
- 🚧 **未实现**：`selection.*` 选退课整组（缺提交协议，按整组覆盖规则省略）、`study.gradeDetails`（无接口样本）
- 🔒 **安全**：凭据不进入源码、样本、日志与对话；测试样本全部虚构脱敏；探测全程只读、无任何写入操作
- ✅ **验证分层**：离线样本通过（15/15，25 条 HTTP 样本均断言 UA）→ 真实协议验证通过（2026-09-23，周次贴合 38/38、未用行 0）→ **真机主界面登录成功（2026-09-23，方案A 双补丁：浏览器 UA 过 WAF + 移除 `isolatedProcess` 避开 HyperOS 击杀；日志证据：单次绑定、零击杀、零超时；官方 UA 修复后 v1.0.5 的清单声明即可替代 UA 补丁）** → **真机全套验收通过（2026-09-24，v1.0.5 + `zhengfang-1.0.87-hyperos-fix` 自用包：超时消失，课表/成绩/考试三页与会话全部正常）**
- 📜 本项目仅供学习与个人使用，请遵守学校规定与相关法律法规

## 🙏 致谢

- [cqcvc-api](https://github.com/roxyyn0304/cqcvc-api) 逆向接口文档——协议样本来源
- [znjhahaha/zhengfang-apk](https://github.com/znjhahaha/zhengfang-apk) App 本体与插件架构（宿主 UA 缺口 [issue #28](https://github.com/znjhahaha/zhengfang-apk/issues/28) 已在 App v1.0.84 修复）
- [插件开发者文档](https://plugins.hidisiwa.xyz/developers) 与 plugin-starter-v3 开发套件

## 📄 License

MIT © roxyyn0304，详见 [LICENSE](LICENSE)。
