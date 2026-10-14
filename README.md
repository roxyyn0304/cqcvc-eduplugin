# 重庆城市职业学院超星教务适配插件

> 独立教务插件（eduplugin）：让重庆城市职业学院学生在正方教务 App 内查看课表、作息、成绩、考试，并直接**选课 / 退课**——协议基于真实账号验证，离线用例 31/31 全绿。

🌐 [English](README_EN.md) | **简体中文**

## 📖 简介

- **为谁做**：重庆城市职业学院（`jw.cqcvc.edu.cn`）学生——本校使用**超星综合教学管理系统**，与 App 内置的正方/青果适配不兼容，无法开箱即用
- **是什么**：`kind: independent` 独立教务插件，登录、课表、成绩等协议全部在插件内实现，**不改 APK**，可单独迭代、单独上架
- **技术栈**：TypeScript → QuickJS 沙箱执行、教务 API v3 契约、**官方 SDK 3.6.1**（2026-10-14 起以最新套件 check / test / pack 全绿）、[plugin-starter-v3 开发套件](https://plugins.hidisiwa.xyz/developers)
- **来源**：模板改造自官方 `mock-school`；接口协议来自 [cqcvc-api](https://github.com/roxyyn0304/cqcvc-api) 逆向文档
## ✨ 功能特性

### 🎯 核心功能

| 功能 | 说明 |
|------|------|
| 🔐 登录认证 | 密码用平台共用 RSA 公钥加密提交，登录页预取 + `302 → /admin` 判定，身份读取失败回退学号 |
| 🔄 会话校验 | 探测当前学年学期接口，被重定向到登录页即 `SESSION_EXPIRED`；冷、热会话双路径 |
| 📅 课表 | 解析 10 节次 × 7 天网格，相邻同学时段自动合并；周次取自网页课表同源接口 `sdpkkbList`（**教室优先**连接：同格多教室/多周次行按 `croommc` 归属、同位次多行周次取并集，不丢行；支持 `4-5,9-18` 区间与展开式），周次源不可用时回退全学期 |
| 🕘 作息表 | **接口动态下发**：取 `getZclistByXnxq` 的 `data.jcsjszList`（按校区 `xqid` + 学期绑定，`kssj`/`jssj` 统一补零成 HH:MM），取不到或请求失败时回退内置 10 节次表（内置表已与真实 `kssj/jssj` 逐节核对一致） |
| 📚 学期列表 | 解析成绩页 `select#startXnxq` 下拉选项 + 当前学期判定（`2026-2027-1` 形态） |
| 📊 成绩 | jqGrid 分页、课程性质字典翻译、总学分累计、平均学分绩点（“暂无”自动省略） |
| 📝 考试安排 | jqGrid 分页、考场与座位号映射、脏数据行过滤 |
| 📚 选课 / 退课 | 批次（轮次）→ 课程 → 教学班三级浏览，**已选课程查询**，一键选课与退课（写操作需 App 内确认）；关键词与教师筛选 |

### 🧰 开发与验证工具

| 工具 | 说明 |
|------|------|
| 离线用例 | 31 条 fixtures，QuickJS 隔离执行、网络全靠有序 mock；覆盖登录成败、会话过期、分页、周次解析、**同格多教室多周次贴合**、**作息动态下发与内置表回退**、**选课六方法（批次/课程/教学班/已选/选课/退课）**、脏数据 |
| 真实协议探测 | `tools/live-probe.mjs`：只读探测脚本，凭据仅本地文件读取，输出脱敏（学号、姓名、Cookie、成绩值一律不打印） |
| 打包 | `pack` 生成 `.eduplugin` 安装包；`source-zip` 生成审核用源码包 |

## 🚀 快速开始

### 环境要求

| 角色 | 需要 |
|------|------|
| 使用插件 | Android 正方教务 App ≥ v1.0.84 + `.eduplugin` 安装包（清单声明 `school.userAgent`，旧版宿主会拒绝该字段） |
| 开发调试 | Node.js ≥ 20 + [plugin-starter-v3 开发套件](https://plugins.hidisiwa.xyz/downloads/plugin-starter-v3.zip) |

### 安装（最简方式）

1. 从 [Releases](https://github.com/roxyyn0304/cqcvc-eduplugin/releases) 页面下载 `.eduplugin` 安装包
2. 打开 App → 插件中心 → 右上角「⋯」→「导入、回滚与开发工具」，**打开「开发者模式」开关**
   - ⚠️ **必须开启**：Releases 下载的安装包由 GitHub Actions 构建，**没有官方签名认证**，开发者模式关闭时导入会报「签名无效或签名密钥未受信任」；插件中心菜单里的「从文件安装」走正式校验路径，同样会拒绝未签名包，**必须从「导入、回滚与开发工具」进入**。开关页脚也注明了「开发模式允许导入未签名的本地包，请仅使用可信来源」
3. 在同一页面点「**导入适配包**」，选择刚下载的 `.eduplugin` 文件
4. 匹配到 `jw.cqcvc.edu.cn` 后，用学号密码登录

> ✅ **当前状态（v1.1.0 / API 3 / SDK 3.6.1）**：
> - **v1.1.0（2026-10-14）**：① **选课整组**——`catalog`←`listV2.mapsList`、`courses`←`listjxbDataV2.initData`、`sections`←`queryChildClassesV2.extend.zjxb`（无子班时即教学班自身）、`enrolled`←已选课程查询 `listYxkc`（实测 17 门）、`select`/`drop`←`xsdXkV2`/`xsdTkV2`（`purpose=mutation`，需用户确认）；② **真机实测修复合集**——登录为三跳链，补 `/frontend` 范围（宿主白名单曾拦下第三跳导致 NETWORK_RETRYABLE）、落地页 5xx 不再判失败、HTTP 403 单独映射 `PERMISSION_DENIED`、错误统一带 `details`（stage + status）、输入自动 trim、`select`/`drop` 不传 `roundId` 时自动解析 `pcid`（学校会报「pcid 为空」）、UA 换成与真机一致的安卓 Chrome Mobile；③ 开学日改用权威周历 `zclist[0].minrq`（公式仅兜底，旧公式早 5 天）。
> - **v1.0.10（2026-10-14，真实账号实测驱动）**：`getZclistByXnxq` **必须带 `xqid`**——不带只回 `dqzc`，带了才有 `jcsjszList`（作息）、`zclist`（**权威周历**：每周 `minrq/maxrq/rqfw`）、`jsxq`（排课设置）、`kbxssj`。开学日改为优先取 `zclist[0].minrq`（本校第一周不是完整周，旧公式推算出的 08-31 比真实开学日 09-05 **早 5 天**），取不到周历才回退 Date+dqzc 公式；校区 id 由课表页 `xqdm` 缓存，缺时问 `getXqList`。
> - **v1.0.9（2026-10-14）**：作息表改为**接口动态下发**——`getZclistByXnxq` 的 `data.jcsjszList`（作息按校区 + 学期绑定，接口无数据时回退内置 10 节次表）。同步新增 1 条离线用例（内置表回退）。
> - ✅ **v1.1.0 在官方 SDK 3.6.1 套件下全绿**（2026-10-14）：`doctor`（node 26 / SDK 3.6.1 / QuickJS ready / sdkIntegrity verified）· `check cqcvc`（**15 capabilities**）· `test cqcvc`（**31/31**，51 条 HTTP 样本）· `submit-check` · `pack` → `dist/local.cqcvc-1.1.0.eduplugin`。
> - **学期显示名**：改为友好格式「2026-2027 第一学期」（`id` 保持原始 `2026-2027-1`，成绩/课表接口参数不变）。v1.0.7 当时在 **SDK 3.2.4** 下 check / 离线 15/15 / submit-check 全绿重打包，**2026-10-07 已在最新 SDK 3.2.9 开发套件下复验全绿（含打包）**（**v1.0.7 未重新真机验收**，仅显示名与构建基线变更）。
> - **清单 `apiVersion: 3`**（SDK 3.2.1 迁移）：进入 `/academic-plugins-v3/` 与 v2 目录通道，并**保持 1.0.87 客户端兼容**——87 兼容通道 `[3, 32]` 是有意为之：1.0.87 宿主的严格 Schema 拒绝 `license`/`minAppVersionCode` 等 3.2 新字段，自用包正是 1.0.87 基线。

### 源码构建（推荐）

```bash
git clone https://github.com/roxyyn0304/cqcvc-eduplugin.git
# 开发套件 plugin-starter-v3.zip（见「环境要求」）解压到当前目录后，将本仓库放入其 plugins/ 并命名为 cqcvc：
unzip plugin-starter-v3.zip -d plugin-starter-v3
cp -R cqcvc-eduplugin plugin-starter-v3/plugins/cqcvc
cd plugin-starter-v3
npm ci                # 国内网络可加镜像：--registry=https://registry.npmmirror.com
npm run plugin -- check cqcvc   # 清单与类型检查
npm run plugin -- test cqcvc    # 运行 31 条离线用例
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

### 已实现能力（16 项）

| 能力 | 端点 | 说明 |
|------|------|------|
| `auth.start` | `GET` + `POST /admin/login` | RSA（PKCS1v15）加密登录，实测 `302 → /admin` |
| `auth.resume` / `auth.refreshCaptcha` | — | 本校不触发验证码/网页续接，返回 `UNSUPPORTED` |
| `auth.validate` | `GET /admin/xsd/xsdcjcx/getCurrentXnxq` | 重定向登录页即会话过期 |
| `study.terms` | `GET /admin/xsd/xsdcjcx/qbcjcx` + `getCurrentXnxq` | 学期下拉选项 + 当前学期 |
| `study.schedule` | `GET getCurrentPkZc` + `POST getXsdSykb`（网格）+ `GET queryKbForXsd` 隐藏域 → `GET sdpkkbList`（真周次） | 周数 + 当前学期课表 + 每门课真实周次（教室优先贴合，同格多教室/多周次行不丢） |
| `study.calendar` | `GET getZclistByXnxq?xnxq=…&role=&userId=&xqid=…`（+ `getXqList` 取校区） | 作息 = `data.jcsjszList`（校区 + 学期绑定，缺失回退内置 10 节次）；开学日 = **权威周历 `data.zclist[0].minrq`**，无周历时退回 Date 头 + `dqzc` 公式（仅当前学期） |
| `study.grades` | `POST /admin/xsd/xsdcjcx/xsdQueryXscjList` + `GET getXspjxfjd` | 成绩分页 + 平均学分绩点 |
| `study.exams` | `POST /admin/xsd/kwglXsdKscx/ajaxXsksList` | 考试安排分页 |
| `selection.catalog` | `POST /admin/xsd/xk/listV2` | 选课批次（轮次）：`mapsList` 的 `xkgzid` 即 `pcid`，`xkgzMc` 作名称；同次响应带回 `pcencs` 加密串 |
| `selection.courses` | `POST /admin/xsd/xk/listjxbDataV2` | 批次内课程（教学班）：`initData` → 课程名/教师/学分/已选人数/上课时间；支持 `keyword`、`teacher` 筛选 |
| `selection.sections` | `POST /admin/xsd/xk/queryChildClassesV2` | 子教学班：`extend.zjxb`；本校当前批次无子班（实测 `sfyzjxb` 全为 0）时即教学班自身 |
| `selection.filters` | `POST /admin/xsd/xk/listV2` | **可选筛选（App 97+）**：返回「课程冲突」筛选组，勾选后 `courses` 按学校下发的 `sfct` 过滤冲突教学班（与学校网页的「过滤冲突教学班」一致）；`revision` 与批次绑定，过期返回 `PAGE_CHANGED` |
| `selection.enrolled` | `GET /admin/xsd/yxkccx/listYxkc` | **已选课程查询**（jqGrid，实测 17 门）：`kcmc`/`kcid`/`id`/`rkjs`/`sksjdd`/`xf` |
| `selection.select` | `POST /admin/xsd/xk/xsdXkV2` | 选课（`jxbid`+`pcid`，`purpose=mutation`，需用户确认）→ `选课成功`；**时间冲突二次确认**：后端返回 `ret=0` + `extend.needConfirm=true` 时返回 `{confirmed:false, message:冲突信息}`，用户在 App 确认后再次调用会自动带 `sfqc=1` 重发以跳过冲突校验 |
| `selection.drop` | `POST /admin/xsd/xk/xsdTkV2` | 退课（`jxbid`+`pcid`，`purpose=mutation`，需用户确认）→ `退课成功` |

> 📌 **冲突标记的呈现**：SDK 的 `Course` 没有冲突字段，插件把冲突课程的教学班名改成 `<jxbmc>（时间冲突）`（`sfct != 0` 且 `status == 0`），App 才能在列表里看见。

> 📌 **学校侧的冲突机制（2026-10-13 抓包 JS）**：课程列表每项带 `sfct`（`0`=未冲突，非 0=冲突）与 `status`（`0`=未选），页面据此打「课程冲突」标签并提供「过滤冲突教学班」勾选；抽签模式报名时后端以 `extend.needConfirm=true` 要求二次确认，确认后带 `sfqc=1` 重发。插件已实现二次确认链路；**冲突标签本身无法透传给 App**（SDK 的 `Course` 类型没有冲突字段），App 侧只能依据 `time`/`location` 自行比对。

### 网络规则

| 规则 | 方法 | 用途 |
|------|------|------|
| `/admin/login` | POST | 凭据提交（单独声明便于审核） |
| `/admin` | GET / POST | 全部端点 + 登录跳转承接（`query` + `auth` + **`mutation`**：选课/退课） |
| `/login` | GET | 防御性放行：登录失败/会话过期的重定向目标 |

## ⚠️ 注意事项

- 🚧 **未实现**：`study.gradeDetails`（成绩明细，无接口样本）；`selection.filters`（SDK 可选方法，需 App 97+，本校批次暂无筛选组配置）
- 🔒 **安全**：凭据不进入源码、样本、日志与对话；测试样本全部虚构脱敏；探测全程只读、无任何写入操作
- ✅ **验证分层**：
  1. 离线样本通过（31/31，51 条 HTTP 样本均断言 UA）
  2. 真实协议验证通过（2026-09-23，周次贴合 38/38、未用行 0）
  3. 真机主界面登录成功（2026-09-23，日志证据：单次绑定、零超时）
  4. 真机全套验收通过（2026-09-24，课表/成绩/考试三页与会话全部正常）
- 📜 本项目仅供学习与个人使用，请遵守学校规定与相关法律法规

## 🙏 致谢

- [cqcvc-api](https://github.com/roxyyn0304/cqcvc-api) 逆向接口文档——协议样本来源
- [znjhahaha/zhengfang-apk](https://github.com/znjhahaha/zhengfang-apk) App 本体与插件架构
- [插件开发者文档](https://plugins.hidisiwa.xyz/developers) 与 plugin-starter-v3 开发套件

## 📄 License

MIT © roxyyn0304，详见 [LICENSE](LICENSE)。
