# Bot 牛马市场：方案、调研与暂停结论

状态：**评估后暂不实现**。本文保留需求拆解、开源项目调研结论、风险清单与推荐落地路径，避免下次重复调研。文中所有「计划」「建议」都不是已实现功能。

调研与方案讨论时间：2026-10-30。

## 1. 原始需求

需求提出时的完整描述：

1. 在设置页做一个「Bot 牛马市场」页面。
2. 用户把自己的 Bot 放到市场上供他人使用，以此赚取积分。
3. 左侧栏左上角加一个分享按钮，弹窗设置「Bot 打工」，把 Bot 放上架。
4. 积分因为没有账户体系，改为上链。
5. 积分钱包、钱包创建、我上架的 Bot、Bot 的打工近况，都放在设置页这个市场页面里。
6. 中转方案：统一由平台服务器保管 Key。参考 new-api、sub2api 等开源项目的成熟方案，必须确保 Key 安全。

## 2. 与现有 MoyuChain 方案的三处冲突

本需求与 [模型额度互助市场开发文档](MOYUCHAIN-DEVELOPMENT.md)（v0.3，2026-10-29）直接冲突，不能视为同一方案的增量：

| 冲突点 | 现有文档 | 本需求 |
| --- | --- | --- |
| 交易标的 | 模型调用额度。文档明确「不依赖任务云电脑，不提供云主机租赁、远程桌面、脚本执行或第三方 Bot 托管」 | 第三方 Bot 代跑任务，即托管别人的 Agent 与工具执行 |
| Key 保管 | 「优先验证提供者自管代理」，「不能默认上传用户 Key」 | 统一由平台服务器保管 Key（文档中的对照方案） |
| 链上程度 | 第一版服务端账本，上链仅为后续演进 | 积分直接上链，作为无账户体系下的余额归属手段 |

另外 `docs/ROADMAP.md` 的「默认边界」写的是「个人模式下 API 直连用户自己的 Key；不做『免费额度』暗示」。做这个功能需要同步修订这两份文档，而不是绕过。

## 3. 为什么暂不做：风险清单

### 3.1 平台必须运行别人的 Agent，责任与成本都不封顶

Bot 代跑意味着调用方的提示词会驱动一个持有工具（命令执行、文件读写、云电脑、绘图、MCP、Skills）的循环在**主人机器或主人账户**上运行。风险面远大于模型中转：

- 主人承担本机被远程操作、云电脑费用（InstaBox 账户）、绘图 API 费用，且无法预知调用方会下发什么。
- 平台需要承担内容审核、滥用处置、纠纷仲裁与封禁运营。MoyuChain 文档第 12 节的结论仍然成立：平台入口与提供者都能看到请求正文，这不是端到端保密方案。
- 「审批闸门」在无人值守接单时必然关闭（`ApprovalPolicy` 只允许 `never`），等于把工具执行的信任完全交给远程陌生人。

### 3.2 中转与「闲置额度」的经济模型不成立

上游按量付费的 Key 被调用时产生**真实账单**。主人「闲置」的并不是可转让资产，而是他自己的付款能力。平台代持 Key 后，滥用、泄漏与坏账造成的成本由平台账户承担；MoyuChain 文档第 6.1 节因此拒绝自动借贷、负余额与自动补贴坏账。

如果积分由平台账户付账，再靠结算把成本转嫁给主人，平台就要承担调用方跑路的坏账敞口。没有账户体系与实名/风控手段时，这个敞口无法封顶。

### 3.3 「无账户体系所以用链」没有解决真正的问题

- 积分上链仍然需要一个中心化发行方（防无限领取，见 MoyuChain 文档第 6.1 节），链只是余额载体，不替代账户。
- 每次结算一笔链上交易的成本、确认时延、重组风险都要处理；可行的批量锚定 + Merkle 领取（pull payment）会把「领积分」变成用户自己发交易，需要付 gas，桌面用户教育成本高。
- 私钥责任转移给用户：丢失即无法找回。这是自托管钱包的固有代价，不是缺陷，但要产品明确说明。
- 链上记录无法证明真实 Token 用量、模型身份或任务完成度。这一点文档第 15 节已经写明：上链不能把「可核验计量」变成已解决。

### 3.4 Key 托管是信任平台，界面必须如实表述

new-api 的字段名 `CRYPTO_SECRET` 让很多使用者误以为上游 Key 已静态加密，实际它只是缓存键 HMAC 密钥，Key 至今明文存库（[common/crypto.go](https://github.com/QuantumNous/new-api/blob/main/common/crypto.go) 全文只有 HMAC 与 bcrypt，没有任何 AES-GCM；语义见 [官方配置说明](https://docs.newapi.pro/en/docs/installation/config-maintenance/docker-compose-yml)）。真实情况是：**只要网关能调用上游，平台运营方在运行时就能读到明文与请求内容**。加密存储消除的是拖库风险，不是平台权限。宣称「平台完全看不到 Key」是不诚实的。

### 3.5 上游 ToS、封号与合规

- sub2api 的 README 顶部三段免责声明写明：可能违反 Anthropic 条款、账号封禁风险自负、仅供技术研究（[README](https://github.com/Wei-Shaw/sub2api)）。它提供的 OAuth/订阅转 API、客户端指纹伪装（`x-anthropic-billing-header`、`BetaClaudeCode`）、一账号一住宅 IP 等能力，是**对抗上游风控**的机制。做「转售模型能力」必然把这些一起请进来，与「上架市场」的定位相互放大概率与法律风险。
- 公共生成式 AI 服务/转售在国内涉及备案、内容安全、日志留存、实名等义务。两个项目 README 都提示了这一点。
- new-api 是 AGPLv3 加 §7 附加署名条款：**机制可以参考，代码不能引入**要分发的 Electron 客户端。one-api 为 MIT，sub2api 为 LGPLv3。

### 3.6 工程量

一个可运营的市场后端至少包含：身份与会话、渠道与凭证保管、虚拟凭证与限速、OpenAI/Anthropic/Gemini 三套流式转发与 usage 归一化、复式账本与幂等、价格同步与版本化、工单派发与断线恢复、链上锚定、审核与争议处理、审计与运维。这是独立产品，而不是桌面端的一个设置页。

## 4. 调研结论：new-api / sub2api / LiteLLM 的成熟做法

以下是本次实际核对源码与文档得到的结论，按主题汇总。**这些机制本身有价值，即使不做市场，也应作为「自定义中转站」功能的安全基线。**

### 4.1 上游凭证保管

- 正确做法只有 LiteLLM 一家：DB 内的模型凭证与 `litellm_params` 全加密，密钥 `sha256(LITELLM_SALT_KEY)`，并强烈建议**认证用的 master key 与加密用的 salt key 职责分离**，这样轮换认证密钥不需要重加密存量（[master key rotations](https://docs.litellm.ai/docs/proxy/master_key_rotations)、[#45574](https://github.com/BerriAI/litellm/issues/45574)）。重加密流程要求幂等、多副本并发安全、逐行 CAS、DB 不可用则中止启动。
- 虚拟凭证**只存哈希**（`LiteLLM_VerificationTokenTable.token` 为 sha256），拖库拿不到可用凭证。new-api 与 sub2api 因为要精确查库，token/api_key 明文存表——这是应当避免的取舍。
- sub2api 有一条值得照抄的护栏：当加密密钥是「env 未配置时自动生成的临时值」，服务**拒绝保存** S3 凭证，避免重启后密文无法解开（`backup_service.go`）。反面案例是 PR [#4867](https://github.com/Wei-Shaw/sub2api/pull/4867)：只在「传入新值」分支加密，继承旧值的分支把解密后的明文写回覆盖了密文。
- 泄漏应急的成熟形态是 **alias + 多 Key + 宽限期双活**（Cloudflare AI Gateway BYOK 用 `cf-aig-byok-alias` 选 Key，面板显示 last-used 与 status，改完立即生效，[文档](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/)）；LiteLLM 对应 `/key/{k}/regenerate` + `grace_period` + `auto_rotate`。
- 启动时应拒绝弱密钥/已知不安全值，多节点必须使用同一份会话与加密密钥。

### 4.2 虚拟凭证的能力维度

sub2api 的 `api_keys` 表建模最完整（[schema](https://github.com/NanmiCoder/sub2api/blob/main/backend/ent/schema/api_key.go)）：`quota/quota_used`（按金额而非次数）、`expires_at`、`ip_whitelist/ip_blacklist`（CIDR）、**`rate_limit_5h/1d/7d` + `usage_*` + `window_*_start`**（金额窗口，正好对齐订阅平台的 5 小时窗口）、`status`、`last_used_at`。

LiteLLM 补齐了继承与上限语义（[Virtual Keys](https://docs.litellm.ai/docs/proxy/virtual_keys)、[Budgets](https://docs.litellm.ai/docs/proxy/users)）：多窗口并发预算、`model_max_budget`、`rpm/tpm/max_parallel_requests`、`allowed_routes`（**fail-closed，未声明即拒**）、`upperbound_key_generate_params`（**超限直接 400，不做 clamp**）、`custom_key_policy` 单钩子覆盖 generate/update/regenerate（只挂 `custom_key_generate` 会被「先合规建、再改不合规」绕过）、`overwrite_user_with_key_hash`（转发给上游的 `user` 强制替换为 key 哈希，防客户端伪造身份）、`fail_closed_budget_enforcement`（缓存降级时返回 503 而不是放行）。

### 4.3 路由与渠道健康

new-api 的 `channels` = `base_url + key + models + group + weight + priority + status + auto_ban + model_mapping`，路由走独立的 `abilities` 表（`Group + Model + ChannelId` 联合主键），渠道变更先删后建，并提供 `FixAbility()` 全量重建（[model/channel.go](https://github.com/QuantumNous/new-api/blob/main/model/channel.go)、[model/ability.go](https://github.com/QuantumNous/new-api/blob/main/model/ability.go)）。优先级分层 + 同层加权随机（`weight + 10` 给 0 权重保底）、重试逐层降级。

三条防事故细节值得抄：

1. 多 Key 时**只禁失败的那把 Key**，全部 Key 不可用才禁整条渠道，reason = `All keys are disabled`。
2. `saveStatusState()` 做**字段白名单更新**，注释明确「防止陈旧渠道快照覆盖凭证、记账计数或渠道配置」。任何「状态机 + 富对象共用一行」的系统都需要它。
3. 状态写回与 Key 轮询游标共用一把锁，避免陈旧快照互相覆盖。

错误分类驱动调度：429 → `rate_limit_reset_at`（尊重上游 reset），529 → `overload_until`，刷新失败 → `temp_unschedulable_until + reason`（防请求风暴），流已开始后**停止切换账号**以免撕裂客户端流（sub2api 网关流水线，[DeepWiki](https://deepwiki.com/Wei-Shaw/sub2api/4.2-gateway-routing-and-cheduling)）。

### 4.4 计费、usage 与断连

- 三段式：预扣（原子 reserve）→ 转发 → 按实际 usage 结算差额 → 失败路径统一 refund。sub2api 的 `inflight_reservation` 用「body 字节/4 估输入 + 单价 × max_tokens 估输出」在 Redis 原子校验 `余额 − 在途预留 ≥ 估算` 后登记预留，任意结束路径释放，`ttl_seconds` 兜进程崩溃泄漏。
- 计价公式（new-api）：`配额 = (输入 + 输出 × CompletionRatio) × ModelRatio × GroupRatio`，按次 `= ModelPrice × GroupRatio × QuotaPerUnit`，另有 cache read/write、audio、group→group 倍率；全程 decimal，`quota ≤ 0` 时保底 1（[倍率说明](https://docs.newapi.pro/en/docs/guide/console/settings/rate-settings)）。
- **最大的坑**：客户端断连时停止读上游，最后的 `message_delta`（含 `output_tokens`）丢失，上游已全额计费而本地 0 计费（new-api [#4463](https://github.com/QuantumNous/new-api/issues/4463) / [PR #4464](https://github.com/QuantumNous/new-api/pull/4464)；LiteLLM 同类 [#30160](https://github.com/BerriAI/litellm/pull/30160)、[#30788](https://github.com/BerriAI/litellm/pull/30788)）。修法是在 `client_gone` 且响应已完成时回正结束原因，或从已收到的事件重建 usage 记 partial spend。
- 硬不变式：**记账依据 = 上游实际用量；客户端断连 ≠ 免单**；usage 缺失不能按零收费，也不能把本地估算当已核验账单。
- 幂等：sub2api 的 `idempotency_records` 用 `(scope, idempotency_key_hash)` 唯一 + `request_fingerprint` 冲突拒绝 + `processing_timeout` 锁 + `observe_only` 灰度；`usage_logs` 按 `request_id` 去重并配独立 `usage_billing_dedup` 表。反面案例：WorkerPool + BestEffortBatcher 双层静默丢弃导致 **`usage_logs` 丢 49%**（511,797 vs 260,974，[#3656](https://github.com/Wei-Shaw/sub2api/issues/3656)）；请求进行中删除 API Key 导致结算失败、用户 0 扣费（[#8419](https://github.com/Wei-Shaw/sub2api/issues/8419) / [PR #7816](https://github.com/Wei-Shaw/sub2api/pull/7816)）。

### 4.5 SSRF：三个真实 CVE

如果允许「任意 base_url / 任意图片 URL」由调用方提供，就会踩这三条（[common/ssrf_protection.go](https://github.com/QuantumNous/new-api/blob/main/common/ssrf_protection.go)）：

1. **CVE-2025-59146**（≤v0.9.0.4）：认证用户可让服务端抓任意 URL，不止图片 → 引入 SSRF 模块（总开关 + IP/域黑白名单 + 端口白名单 + 私网开关）。
2. **CVE-2025-62155**（v0.9.6）：302 重定向绕过 → 重定向目标必须再校验一次。
3. **GHSA-v5c3-6wvc-pc2q**（CVSS 7.1，v0.11.9-alpha.1 前）：`isPrivateIP` 漏了 `0.0.0.0`，Linux 上等价 127.0.0.1，普通 token 用 `image_url.url=http://0.0.0.0:8080/…` 即可盲打内网；走 Bedrock adaptor 时内容被内联成 base64 交给模型，**升级为全读 SSRF**（[OSV](https://osv.dev/vulnerability/GHSA-v5c3-6wvc-pc2q)）。

结论性做法：**默认拒绝 + 服务端配置域名白名单（不给客户端自由文本）+ 拨号前校协议/端口/域名 + 解析后逐个 IP 再校（含 IANA 特殊用途全量清单）+ 每一跳重定向重校 + TLS-only + 代理失败绝不回退直连**（sub2api `proxy_fallback.allow_direct_on_error=false` 的理由是避免服务器真实 IP 被上游关联）。

### 4.6 日志与内容审计

四家都不把 prompt/completion 正文写进运行日志。new-api `logs` 表只有 token 数、模型、渠道、额度、`request_id`/`upstream_request_id`，且 `Ip` 需用户显式开启记录；`Other` 字段做 user/admin/root 三层可见性剥离。sub2api 把内容审计做成**独立子系统**（[prompt_snapshot.go](https://github.com/Wei-Shaw/sub2api/blob/main/backend/internal/securityaudit/prompt_snapshot.go)）：五条脱敏正则（Bearer、`sk|api_key|token|secret|password`、canary、email、phone）+ **短文本全遮蔽**（<32 runes 一律 `***`，否则最多留 1/4 且 ≤24 runes，注释说明「避免短秘密留下可恢复前缀」）+ 扫描角色含 assistant 与 tool（攻击者可把敏感内容塞进工具轮）。历史事故：访问日志未对 URL query 里的凭证脱敏（new-api [#7970](https://github.com/QuantumNous/new-api/issues/7970)）、header override 调试日志只掩 `info.ApiKey` 而 `Authorization/X-API-Key/Cookie` 仍明文（[PR #2731](https://github.com/QuantumNous/new-api/pull/2731)）。

**对本仓库直接适用**：MoyuBot 已有 `DiagnosticJournal` 与 `secrets.bin.json`，上述脱敏规则与「按 header 名掩码」应补进诊断导出，无论做不做市场。

## 5. 如果重做：不越线的落地顺序

### 5.1 建议的真实切口：Bot 模板分享，不含代跑

需求里可以安全实现的部分是「把 Bot 分享出去」，而不是「别人的机器替我干活」：

1. 导出格式：人设 + 模型与生成参数 + 工具开关 + MCP/Skills 引用清单 + 定时任务定义，打包为可校验 JSON（`ROADMAP.md` 0.4 已有「Bot 模板市场：人设 + 工具集 + 定时任务的组合可导出为 JSON」）。
2. 左侧栏分享按钮 → 弹窗预览要分享的字段，**明确排除** API Key、记忆正文、对话历史、本机路径。默认只分享人设与配置。
3. 发现页支持搜索/标签/作者别名，导入方在自己的工作区新建 Bot，用自己的 Key 计费。责任与成本边界清晰。
4. 积分改为「社区贡献凭证」（评分、被导入次数、反馈质量）而非可折现余额，先不需要链、不需要发行方、不需要账本，也就不需要风控与资金池。

这一路线只需要前端 + 一个静态索引服务，风险量级完全不同。

### 5.2 额度共享仍按 MoyuChain 文档原方案

需要共享模型能力时，走文档的既有顺序：M0 验证可信计量 → M1 身份与中心化账本 → M2 价格与提供者自管代理 → M3 市场闭环 → M4 封闭试运行。**不要跳过 M0**：没有可独立核验的供应商证据，任何积分结算都只能是有额度的受邀试验。

### 5.3 若坚持平台托管 Key 的中转

最小安全基线（按第 4 节结论）：

- 保管：DEK/KEK 信封加密，KEK 与认证密钥分离、密文内嵌 keyId 版本、启动拒绝弱密钥、`open()` 强制审计、明文只出现在网关调用栈且用后清零。
- 下发：客户端只拿短期虚拟凭证（**服务端只存摘要**）、绑定钱包/模型白名单/预算/RPM/并发/有效期，支持轮换与宽限双活；不允许客户端指定渠道、base_url 或任意 Header。
- 计量：usage 只信上游；断连继续读完；无 usage → `usage_pending` 保持预留并进对账，不免费也不结算。
- 出站：白名单 + 解析后 IP 校验 + 逐跳重定向重校 + TLS-only + 代理失败不回退。
- 账本：分录不可变、`operationType + businessId` 唯一、余额检查与分录同事务、并发不超支、可重建余额。
- 日志：不记正文，脱敏规则覆盖 header 名与 query；审计分层可见性。
- 界面文案：如实写「平台运行时可见明文与请求内容」，不宣称完全看不到 Key。

### 5.4 前端形态（本次已设计，可复用）

- 设置页新增分区 `牛马市场`，内部五块：积分钱包（创建/备份/恢复/地址/余额）、我上架的 Bot（列表 + 状态 + 收益 + 暂停/下架）、打工近况（工单流、每单 tokens 与积分、`usage_pending` 显式标注「已停止新调用，用量核验中」）、积分流水（按模型/日期/会话筛选，展开看 tokens 分类与价格版本）、市场发现（他人 Bot 卡片）。
- 左侧栏 `messenger-toolbar` 左上角分享按钮 → Sheet 弹窗：选择 Bot、可见性、加价比例、允许模型、并发与每日上限、接单时段、允许工具子集、Key 托管方式、以及「上游费用由谁承担」「无人值守即放弃审批」两条明确告知。
- 未备份钱包时的下架/遗忘需要二次确认；私钥与签名只存在于主进程，`preload` 不暴露任何取私钥或盲签接口（IPC 白名单：`wallet:create/backup/restore/status`、`market:publish/update/pause/overview`）。

## 6. 本次已验证的可复用零件（已删除，需要时按此重建）

方案评估期间实现过一层与运行环境无关的协议库，并通过了 16 项测试。决定不做市场后已连同构建产物一并删除，此处记录要点，便于将来重建或单独复用：

- **keccak-256**：BigInt 实现，5×5 状态按 FIPS-202 伪码直译，rho 偏移用规格里的 `(t+1)(t+2)/2` 走步生成而非常量表，避免表格抄错。验证方式：空串摘要、`abc`、`hello world`、`transfer(address,uint256)` → `a9059cbb`、`Transfer(address,address,uint256)` topic、以及跨越 136 字节 rate 边界的输入。**踩坑记录**：padding 的零填充长度是 `RATE − (len+2) % RATE`，写成 `RATE − (len+1) % RATE` 会让总长不是 rate 的整数倍。
- **EVM 地址**：`crypto.createECDH('secp256k1')` 派生公钥（与内置实现交叉验证），keccak256 未压缩公钥尾 20 字节 + EIP-55 校验和。验证用的三个主网地址形态：USDT `0xdAC17F958D2ee523a2206206994597C13D831ec7`、USDC `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`、WETH `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`。**踩坑记录**：扩展欧几里得求模逆必须返回 gcd 步骤里对应「value」的系数（`oldCoefficient`），变量命名成 `x0/x1` 极易返回错的那一个，症状是小标量恰好正确、真实随机密钥抛出「点不在曲线上」。
- **签名**：RFC-6979 确定性 nonce、low-s 规范化、recovery id、EIP-191 personal_sign、EIP-155 legacy 交易签名与 sender 恢复（用解码后重签回验，不依赖记忆里的常量）。
- **载荷规范**：签名 envelope 固定 `protocolVersion/audience/chainId/token/action/wallet/nonce/expiresAt/payload`，payload 走规范化 JSON（键排序、拒绝浮点、大整数用十进制字符串），换链、换动作、换 nonce、改 payload 都必须使验签失败。
- **钱包备份**：Web3 Secret Storage v3（scrypt + AES-128-CTR + keccak MAC），与 MetaMask/geth 导出格式兼容；`mac` 先验再解密；错误密码与密文篡改都必须拒绝。**踩坑记录**：`decryptKeystore` 里 `wallet.crypto` 的解构层次容易写错；Node 22 + TS 5.9 下 `Uint8Array<ArrayBuffer>` 与 `ArrayBufferLike` 不兼容，从 Buffer 出字节要显式拷贝。
- **结算批次**：叶子 `keccak256(0x00 ++ uint256 index ++ address ++ uint256 amount ++ bytes32 receiptHash)`、节点 `keccak256(0x01 ++ left ++ right)`、positional proof 且奇数层自配对，Solidity 侧可用 `abi.encodePacked` 逐字节复现（pull payment 省 gas，避免每请求一笔链上转账）。
- **计价**：`1 积分 = 1e6 microcredits`、`1 USD = 1e9 microcredits`、单价用 pico-USD/token，乘加全程 bigint，每请求只向上取整一次。USD/百万 与 USD/单 token 两种口径要分开换算（OpenRouter `pricing` 是后者）。
- **出站与脱敏**：域名白名单 + IANA 特殊用途 IPv4/IPv6 全量清单 + 端口白名单 + 协议限制；IPv4-mapped 地址要抽出内嵌 v4 用 v4 规则重判；`/32` 规则必须按地址族而不是前缀长度判断 32 位（用 `prefix < 32` 判断会把任意 IPv4 判为特殊地址）；日志按 header 名掩码、短秘密全遮蔽。

如果只做「Bot 模板分享」（5.1），上面这些一个都不需要。

## 7. 待产品决策

| 问题 | 现状 |
| --- | --- |
| 是否接受「平台运行时可见明文与请求内容」 | 决定能否做托管中转；不接受就只能走提供者自管代理 |
| 积分能否折现、是否允许用户间转账 | 决定它是不是需要金融合规的资产 |
| 谁为滥用与坏账承担 | 没有明确责任方就不能开放公开接单 |
| 上架 Bot 的输出内容与责任归属 | 需要审核与争议流程，以及内容标识义务 |
| 上游是否允许被这样使用 | 逐家核实条款，不以「用户填了 Key」代替接入验证 |
