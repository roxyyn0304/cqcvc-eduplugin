## 问题

插件网络通道的 `User-Agent` 被固定为 `ZhengfangAcademicPlugin/1`（`PluginHost.kt` 第 90 行），且插件自定义请求头白名单（第 82 行）只允许 `accept / content-type / x-requested-with`（service/native 另加 `authorization`），**插件无法自行声明 User-Agent**。

对于按 UA 特征做放行/拦截的学校 WAF（实测样本：重庆城市职业学院 `jw.cqcvc.edu.cn`，超星综合教务），插件发出的所有请求都会被 403，导致该类学校**完全无法使用任何走 `sdk.http` / `network.request` 的插件**（`independent` / `service` / `native` 全部受影响）。

`PLUGIN-CAPABILITIES.md` §7.1 已写明「学校若强制要求……特定 User-Agent……可能需要先扩展 App」——本 issue 即请求这项宿主扩展。

## 实测证据（2026-09-23，真实账号只读探测，同会话、同端点，仅 UA 不同）

| 请求 UA | `GET /admin/xsd/xsdcjcx/getCurrentXnxq` | 说明 |
| --- | --- | --- |
| 浏览器 UA（Edge/Windows） | **200** | 登录 POST 用该 UA 也返回 `302 → /admin`，登录成功 |
| 不带 UA（Node 默认） | **403** | WAF 拦截 |
| `ZhengfangAcademicPlugin/1` | **403** | WAF 拦截，同端点同会话仅 UA 不同 |

结论：该 WAF 按「是否浏览器 UA 特征」放行；插件固定 UA 必然 403，插件侧无任何绕过手段（自定义头会被宿主拒绝「该请求头由宿主管理」）。

## 建议方案：清单声明 userAgent（插件自己写 UA）

1. **清单扩展**（二选一，建议 a，按学校生效、作用域最小）：
   - a. `school.userAgent?: string` — 学校级，随签名目录审核
   - b. `network[].userAgent?: string` — 规则级，按 origin/路径生效
2. **宿主改动**（`PluginHost.kt`）：

```kotlin
// 现状
val builder = Request.Builder().url(url).header("User-Agent", "ZhengfangAcademicPlugin/1")

// 建议：清单声明优先，未声明维持现状（默认行为零变化）
val ua = operation.manifest.school?.userAgent?.takeIf { it.isNotBlank() }
    ?: "ZhengfangAcademicPlugin/1"
val builder = Request.Builder().url(url).header("User-Agent", ua)
```

3. **Schema**：`manifest.schema.json` 的 `school` 增加可选 `"userAgent": {"type":"string","maxLength":128}`；`sdk/index.d.ts` 的 `school` 同步加字段。
4. **约束与审核**：`userAgent` 只影响请求指纹、不扩大可访问范围（网络白名单照常逐次校验，含每次跳转）；建议在源码审核时要求作者在 README 说明声明原因（如「本校 WAF 按 UA 放行浏览器特征，附实测 200/403 对比」）。

## 备选方案（供参考）

- **全局把固定 UA 改成浏览器样式**：改动一行、惠及所有插件，但会改变全部插件流量指纹（原 UA 可能有统计/风控用途），且无法按学校差异化。
- **等待学校侧放行**：不可行，学校侧不可控。

## 环境与复现

- App 源码：`main` @ `bebbe43`（2026-09-22，`PluginHost.kt` 自创建仅 2 个提交，无 UA 相关改动）
- 复现：对任意声明了该 origin 的插件请求，分别以浏览器 UA / `ZhengfangAcademicPlugin/1` 发起同请求对比状态码即可
- 关联插件：`kind: independent` 超星教务适配（协议层已全部离线样本 + 真实只读探测验证，当前仅被 UA 卡在真机验收）

> 本 issue 不含任何账号、密码、Cookie 或个人信息；探测全部为只读查询，无任何写入操作。
