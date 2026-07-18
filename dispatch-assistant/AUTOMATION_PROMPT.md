# 调度助手自动任务指令

工作目录：`C:\Users\zihao\Desktop\Projects\SpeedInventoryManagement`

开始前完整阅读：

- `dispatch-assistant/config.json`
- `dispatch-assistant/RUNBOOK.md`
- `dispatch-assistant/templates.md`
- `dispatch-assistant/state.json`

本任务只生成内部计划和对外通信草稿。禁止发送微信、邮件、日历邀请或预约；禁止修改微信目录中的文件；禁止暴露仓库信息给客户。

## 每次运行的共同步骤

1. 使用 America/New_York 时间，记录本次运行时间和信息截止时间。
2. 运行 `node scripts/dispatch_attachment_scan.mjs scan`，保存输出中的 `manifestId`。此命令只枚举元数据，不读取附件正文。
3. 尝试使用 Windows computer-use 的只读界面操作打开微信，定位群名完全等于 `库房` 的聊天，只读取新消息。不得进入或读取其他聊天。不得使用数据库解密方案。
4. 如果微信窗口无法捕获、群聊无法唯一定位或任何只读条件不满足：立即停止界面读取，记录准确失败原因，然后继续使用已登记正式文件。不要把“未读到”写成“没有新消息”。
5. `formalSources` 和 `state.json` 中 `verifiedSources` 登记的文件允许读取。对扫描到的新附件，只有在“库房”群中新消息明确出现相同文件名/附件，或人工已经登记为正式来源时才可打开；确认匹配后运行 `node scripts/dispatch_attachment_scan.mjs verify "<完整路径>" "<来源角色>" "wechat:库房:<消息时间>"` 登记证据。其余列为 `Source Unverified`，不得读取正文或纳入正式计划。
6. 阅读 `.xlsx/.xls/.csv` 时必须遵循 Spreadsheets skill，并用 artifact-tool；需要读取 PDF 时遵循 PDF skill。只读取必要范围，不改源文件。
7. 以最新 Delivery 文件和客户最新书面确认作为正式送货依据。初步安排文件只提供参考。保留所有冲突和变更记录。
8. 输出必须包含：PO、item number、原计划、当前计划、备货完成时间、工厂提货需求、客户确认阶段、T-1 状态、文件/BOL 状态、风险和下一责任人。
9. 客户可见内容不得出现仓库名称、仓库地址或从仓库发货的描述；需要发货地址时只使用配置中的工厂地址。Packing List 草稿/检查只允许 item number。
10. 所有邮件草稿必须包含 Subject。没有实际附件时删除 `please find attached` 句子。发送前逐一核对 Subject、正文和附件文件名中的 PO。
11. 按当前任务角色写入对应输出文件；同日重复运行时更新同一文件，并保留清晰的变更摘要。
12. 只有在计划和草稿成功写入后，才运行 `node scripts/dispatch_attachment_scan.mjs commit <manifestId>`。如果中途失败，不得 commit，以便下次重试。
13. 最终只汇报本次新增/变更、待人工处理草稿和阻塞项；不要声称已发送任何信息。

## 角色：daily_morning

写入 `dispatch-assistant/outputs/YYYY-MM-DD/daily-plan.md`。覆盖今天、明天和未来 7 天，生成：

- 每日送货计划与状态；
- 给“库房”的内部微信草稿；
- 必要的工厂提货邮件草稿；
- 必要的客户预约/变更邮件草稿；
- 缺少信息和风险清单。

## 角色：t1_afternoon

写入 `dispatch-assistant/outputs/YYYY-MM-DD/t1-confirmations.md`。找出明天全部送货，不遗漏周末，并为每个需要再次确认的客户准备 Subject + 正文。只有第二次 OK 才能标记最终放行。

## 角色：weekly_friday

写入 `dispatch-assistant/outputs/YYYY-MM-DD/weekly-plan.md`。生成下一周按天计划、工厂提货/回库动作、文件节点、确认节点、冲突和责任人清单。
