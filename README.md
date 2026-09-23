# 重庆城市职业学院超星教务适配

- 学校：重庆城市职业学院（`jw.cqcvc.edu.cn`）
- 系统：超星综合教学管理系统 v3（`/admin` 平台）
- 类型：`kind: independent` 独立教务插件（API v1 契约）
- 协议来源：公开逆向文档（脱敏）+ **真实账号只读探测验证（2026-09-23）**

## 已实现能力

| 能力 | 端点 | 说明 |
| --- | --- | --- |
| `auth.start` | `GET /admin/login` 预取 + `POST /admin/login` | 密码用平台共用 RSA 公钥（PKCS1v15）加密；真实实测 `302 → /admin`；成功后 `POST listV2` 读取身份（`xsxh`/`xsxm` 字段已实测存在） |
| `auth.resume` | — | 本校不触发验证码/网页续接，返回 `UNSUPPORTED` |
| `auth.refreshCaptcha` | — | 同上（非 `chaoxing.com` 域名不触发验证码） |
| `auth.validate` | `GET getCurrentXnxq` | 被重定向到登录页（实测未登录为 303）即 `SESSION_EXPIRED`；身份优先读会话缓存，冷会话回退 `listV2` |
| `study.terms` | `GET qbcjcx` + `getCurrentXnxq` | 学期列表来自成绩页框架 `select#startXnxq` 下拉选项（value=`2026-2027-1` 形态，已实测）；当前学期取 `getCurrentXnxq` |
| `study.schedule` | `GET getCurrentPkZc` + `POST getXsdSykb` | 实测 20 周、10 节次块；服务端按会话返回当前学期；请求其他学期返回空课表 |
| `study.calendar` | 静态配置 | 本校10 节次时间表，已与课表接口 `kssj/jssj` **逐节实测核对完全一致** |
| `study.grades` | `POST xsdQueryXscjList` + `GET getXspjxfjd` | `startXnxq/endXnxq` 即完整学年学期串（由成绩页 JS `startXnxq=" + startXnxq + "&endXnxq=` 实证）；`kcxz` 按字典翻译；GPA 非数字（如实测的“暂无”）时省略 |
| `study.exams` | `POST ajaxXsksList` | jqGrid 分页；该接口无学期参数（实测 ret=0） |

## 未实现（按整组规则整体省略）

| 能力组 | 原因 |
| --- | --- |
| `selection.*`（选课/退课6项） | 逆向文档只有 `listV2` 列表，无选课/退课提交协议；按“整组覆盖”规则整体不声明 |
| `study.gradeDetails` | 未抓到按课程查询成绩构成（平时/期末权重）的接口样本 |

## 网络规则

1. `POST /admin/login`（`auth`）：凭据提交端点，单独声明便于审核。
2. `GET|POST /admin`（`query`+`auth`）：全部查询端点；`auth` 用途承接登录页预取与 `302 → /admin` 跳转。
3. `GET /login`（`auth`）：防御性规则——登录失败/会话过期的重定向目标若在 `/admin` 前缀外（如 `/login`），放行该跳转以便正确判定失败。

## 真实验证结论（验收记录）

- 日期：2026-09-23 · 版本：local.cqcvc 1.0.0 · 方式：真实账号只读探测（14 个请求，无任何写入）+ 离线样本14 条
- 结果：**协议层全部打通**（登录、身份、课表、周次、作息、学期、GPA、考试端点均 ret=0/302 正确）
- 错误分类：1 次凭据格式错误（已修正，服务端返回“密码错误”）；WAF 对非浏览器 UA 返回 **403**（见下）；`getDictByGroupCode?xnxq` 404（已弃用该路径）

| 验证项 | 实测结论 |
| --- | --- |
| 登录流程与加密 | ✅ 页面预取 → RSA(PKCS1v15, Base64) → `302 /admin`；公钥与登录页源码一致 |
| 身份探测 `listV2` | ✅ `xsxh`/`xsxm` 字段存在（非选课期 ret=-1 也返回） |
| 节次作息表 | ✅ 与课表接口 `kssj/jssj` 10 节逐节一致 |
| 课表周次数据 | ✅ 确认**接口不返回周次**（课程字段仅 `kcmc/teacher/classroom`，`sjk` 为孤儿行）→ 全学期回退即网页端行为 |
| 学期列表来源 | ✅ `getXqList` 实为**校区列表**（返回“永川”+学校地址），已弃用；改用 `qbcjcx` 下拉选项 |
| 学期参数格式 | ✅ 完整串 `2026-2027-1`（逆向文档的 `001` 说法不适用本校） |
| GPA“暂无”处理 | ✅ 与实测响应一致，非数字时省略字段 |
| 成绩/考试**数据行字段** | ⏳ 账号为新生暂无数据（total=0），字段名以文档样本为准，待有数据后复核 |

## ⛔ 已知宿主缺口（真机阻塞项）

学校 WAF 按 **User-Agent** 拦截（实测：浏览器 UA → 200，`ZhengfangAcademicPlugin/1` → **403**，同端点同会话仅 UA 不同）。App 插件通道固定使用该 UA（`PluginHost.kt` 第 90 行），且插件自定义请求头白名单（第 82 行）不含 `user-agent`。

**结论：宿主 UA 问题解决前，本插件在真机上所有请求都会被 403。** 插件侧无解，需 App 侧改动（改固定 UA 为浏览器样式，或允许清单声明 `userAgent`）。协议与样本层面已全部验证通过。

## 离线验证

```
npm run plugin -- doctor
npm run plugin -- check cqcvc
npm run plugin -- test cqcvc
npm run plugin -- pack cqcvc
npm run plugin -- source-zip cqcvc
```

当前状态：check 通过（9 能力）、test 通过（14 条用例，QuickJS 隔离执行）。用例覆盖登录成功/失败（含页面预取）、会话冷热与过期、课表合并与周次解析、学期下拉解析、成绩分页、考试分页与脏数据过滤。样本中的学号、姓名、课程、教室均为虚构脱敏数据。

`tools/live-probe.mjs` 为真实协议探测脚本（只读、凭据从本地 env 文件读取、输出脱敏），不进入源码包。

## 免责声明

本插件仅用于技术学习与本校个人使用，请遵守学校规定与相关法律法规；不得用于批量爬取、账号盗用或其他未经授权的访问。样本与源码不得包含真实账号、密码、Cookie 或个人信息。

## 开源与许可

MIT License（见 [LICENSE](LICENSE)）。真机阻塞项（宿主 UA）已提交至上游：[znjhahaha/zhengfang-apk#28](https://github.com/znjhahaha/zhengfang-apk/issues/28)。
