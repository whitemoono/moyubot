## 更新内容

### 小窗口模型不再被工具列表挤爆

自检实测：39 个工具占 14,547 字符 schema = 9,994 tokens，加上 364 tokens 的人设，**8k 窗口占用 126%**——工具比窗口还大，连一句对话都放不下。

修复后按窗口预算三级降级：

| 阶段 | 工具开销 | 8k 窗口占用 |
| --- | --- | --- |
| 完整描述 | 9,994 tokens | 126% |
| 截短描述 | 2,489 tokens | 30% |
| **只留 15 个核心工具** | **823 tokens** | **19%** |

- 触发条件：工具 + 人设超过窗口 25%
- 被隐藏的工具名会写进系统提示，模型知道它们"这次没给"而不是"不存在"——它会提示你缩小工具集或调大窗口，而不是编造调用
- 核心 15 个：`cloud_exec / cloud_read / cloud_write / apply_patch / read_files / web_search / web_fetch / deliver_file / remember / recall / todo_write / ask_user / set_goal / update_goal / schedule_task`，覆盖绝大多数对话

### 超限报错说清原因

以前只说"超出上下文上限"，现在给出具体数字：

```
本次输入超出了模型上下文上限（窗口 4096 tokens，预算 2867：
工具 1 + 系统提示 12 + 本次对话 36016）。已压缩历史但仍放不下……
```

### 测试

- 188/188 全部通过
- 修正一条长期失败的测试：它每步塞 180×8 字符推理，8k 窗口下压缩再狠也装不下，属于测试假设不成立，已改为现实规模

**Full Changelog**: https://github.com/whitemoono/moyubot/compare/v0.2.7...v0.2.8