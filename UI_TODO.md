# UI Update Todo

这份清单用于整理当前系统的 UI 更新方向，按 `P0 / P1 / P2` 分层推进。

说明：
- `[x]` 已完成
- `[ ]` 待完成

## P0 - Core Workflow UI

目标：让核心业务页面先达到“正式可用、易上手、信息层级清楚”的状态。

- [x] 将 `Inbound` 改成工作台模式：主表 + 右侧详情抽屉
- [x] 将 `Outbound` 改成工作台模式：主表 + 右侧详情抽屉
- [x] 将 `Adjustment` 改成工作台模式：主表 + 右侧详情抽屉
- [x] 将 `Transfer` 改成工作台模式：主表 + 右侧详情抽屉
- [x] 将 `Cycle Count` 改成工作台模式：主表 + 右侧详情抽屉
- [x] 将 `Stock by Location` 改成库存工作台，而不是普通 CRUD 页面
- [x] 去掉 `Stock by Location` 里的 `Add New`，避免绕过单据流程
- [x] 将 `Customer` 页面升级为客户工作台，支持库存 / 单据 / 活动聚合查看
- [x] 将 `All Activity` 改成只读总账视图，并支持详情抽屉
- [x] 将 `Audit Logs` 改成更适合排查问题的只读视图
- [x] 将导航改成可折叠侧边栏
- [x] 侧边栏按专业功能域分组：
  - `Overview`
  - `Receiving`
  - `Shipping`
  - `Inventory`
  - `Master Data`
  - `Administration`
- [x] 支持每个侧边栏分类展开 / 收起
- [x] 支持整个侧边栏折叠 / 展开，并记住状态
- [x] 将品牌和当前用户信息移到侧边栏底部
- [x] 将语言切换移到 `Settings`
- [x] 简化 `Settings` 页的 timezone 信息展示
- [x] 为 `Settings` 页加入 `Save / Cancel`，让用户明确知道是否有未保存改动
- [x] 统一页面顶部的 breadcrumb / 标题 / 分组信息
- [x] 统一核心单据页的详情抽屉信息结构
- [x] 为核心详情抽屉补上状态、创建时间、更新时间等审计信息带
- [x] 为上下文页面跳转到 `All Activity` 时带上筛选条件
- [x] 统一所有核心页面顶部的主操作栏位置和样式
- [x] 统一所有核心页面的空状态、加载状态和错误状态
- [x] 再做一轮权限 UI 收口，确认所有页面的只读提示和按钮显示一致

## P1 - Workflow Enhancement UI

目标：在核心流程稳定后，让系统更像成熟商用系统，并明显提升效率。

- [ ] 将 `Inbound / Outbound` 从抽屉详情进一步升级成独立详情页
- [ ] 将 `Customer Detail` 升级成独立页面，而不只是列表右侧抽屉
- [ ] 做全局搜索入口，支持搜索：
  - `SKU`
  - `Customer`
  - `Container No.`
  - `Packing List No.`
  - `Document No.`
- [ ] 将高级筛选条抽成统一组件，复用于各个工作台页面
- [ ] 补完整的 `Import / Export` UI
- [ ] 让 `Report` 支持 drill-down，点击图表可跳转到对应业务页
- [ ] 为 `Stock by Location` 增加分组视图切换：
  - 按仓库
  - 按分区
  - 按客户
  - 按 SKU
- [ ] 增加更适合仓库操作员的紧凑录入模式
- [ ] 继续增强 `Audit Logs` 的筛选、摘要和详情格式化
- [ ] 在单据详情中加入更完整的 timeline / status history

## P2 - Product UI

目标：把系统从“内部业务系统”继续推进到“更完整的产品体验”。

- [ ] 增加 `Pick / Pack / Ship` 的专用 UI
- [ ] 增加客户门户 UI
- [ ] 增加 `Billing / Charges` 页面
- [ ] 增加条码 / 扫码枪操作界面
- [ ] 增加更完整的移动端仓库操作界面
- [ ] 支持自定义 dashboard / saved views
- [ ] 增加通知中心
- [ ] 支持多组织 / 多站点 UI
- [ ] 增加更完整的 BI 报表体验

## Suggested Next Step

建议下一步先继续完成 `P0` 里剩下的这 3 项：

1. 统一所有核心页面顶部的主操作栏位置和样式
2. 统一所有核心页面的空状态、加载状态和错误状态
3. 再做一轮权限 UI 收口
