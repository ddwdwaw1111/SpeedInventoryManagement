# Feature Todo

这份清单用于整理当前系统的功能路线图，按 `P0 / P1 / P2` 分层推进。

说明：
- `[x]` 已完成
- `[ ]` 待完成

## P0 - Core Warehouse Operations

目标：先把核心仓储业务能力做完整，并保证数据结构、权限和审计链路成立。

### Security, Roles, and Access

- [x] 登录认证
- [x] 基础角色模型：`admin / operator / viewer`
- [x] 用户管理页面
- [x] 管理员可创建用户
- [x] 管理员可修改用户角色
- [x] 管理员可禁用用户
- [x] 公共 `signup` 限制为仅初始化管理员使用
- [x] 页面和按钮的基础权限控制
- [x] 密码哈希迁移到 bcrypt（渐进升级）
- [ ] 用户自行修改密码
- [ ] 登录失败锁定 / Rate limiting
- [ ] 过期 session 定期清理

### Core Inventory Documents

- [x] `Inbound` 单据化：`document + lines + movements`
- [x] `Outbound` 单据化：`document + lines + movements`
- [x] `Outbound` 支持 `cancel / reversal`
- [x] 限制直接对 `stock_movements` 做新增 / 编辑 / 删除
- [x] `All Activity` 作为统一库存流水总账

### Inventory Control Operations

- [x] `Adjustment` 功能
- [x] `Transfer` 功能
- [x] `Cycle Count` 功能

### Master Data

- [x] `Customer` 管理
- [x] `SKU Master` 管理
- [x] `Stock by Location`
- [x] `Storage Management`

### Audit and Traceability

- [x] `Audit Logs`
- [x] 核心单据和库存活动的可追踪记录

### QA Baseline

- [x] backend unit tests
- [x] API handler tests
- [x] service integration tests

## P1 - Operational Maturity

目标：把系统从“能用”提升到“更接近正式 WMS / 3PL 系统”。

### Inventory Model

- [x] 增加库存状态维度：
  - `on_hand`
  - `available`
  - `allocated`
  - `damaged`
  - `hold`

### Document Workflow

- [ ] 为 `Inbound / Outbound / Adjustment / Transfer / Cycle Count` 增加统一状态流：
  - `draft`
  - `confirmed`
  - `posted`
  - `cancelled`

### Receipt / Shipment Enhancement

- [ ] `Receipt variance` 明确化显示：`matched` / `short` / `over`
- [ ] 收货 / 出货列表高级筛选（status / customer / date range / container no）
- [ ] 单据操作人追溯：`created by` / `confirmed by` / `posted by` / `cancelled by`
- [ ] 收货 / 出货异常高亮（short receipt / over receipt / missing carrier）
- [ ] 收货 / 出货详情跳转到相关库存行 / 台账 / 客户上下文
- [ ] 单据详情中加入 timeline / status history
- [ ] Dashboard 加入 `Open Receipts / Open Shipments` 队列入口

### Customer Operations

- [x] 客户详情页 / 客户工作台进一步增强
- [x] 客户库存汇总
- [x] 客户单据视图
- [x] 客户活动汇总

### Import / Export

- [ ] SKU import
- [ ] Inbound import
- [ ] Outbound export
- [ ] All Activity export
- [ ] Customer inventory export

### Attachments and Supporting Files

- [ ] 为单据增加附件能力：
  - packing list
  - BOL
  - POD
  - 客户原始文件

### Alerts and Monitoring

- [ ] 低库存提醒
- [ ] 异常收货提醒
- [ ] 盘点差异提醒

### Search and Efficiency

- [ ] 全局搜索
- [ ] 高级筛选
- [ ] 保存筛选条件

### API and Infrastructure

- [ ] API 列表分页（替代硬编码 `LIMIT 50`）
- [ ] 数据库备份策略

## P2 - Productization

目标：把系统继续推进到更成熟的产品阶段，支持更复杂的仓库运营和客户服务。

### Receiving and Shipping Expansion

- [ ] ASN / 预约入库
- [ ] Allocation / 配货
- [ ] Pick / Pack / Ship 工作流

### Billing and Customer Experience

- [ ] Billing / Charges
- [ ] Customer Portal

### Warehouse Operations

- [ ] Barcode / Scanner 支持
- [ ] 更完整的移动端仓库操作体验
- [ ] 批量操作（批量确认 / 取消多个单据）

### Reporting and Automation

- [ ] 自动报表
- [ ] 通知中心
- [ ] 更完整的 BI / analytics 能力

### Multi-Site / Scale

- [ ] 多组织 / 多站点支持
- [ ] 字段级权限（不同角色看到不同字段）

## Suggested Next Step

建议下一步优先从 `P1` 开始，推荐顺序：

1. Receipt variance 明确化显示
2. 收货 / 出货列表高级筛选
3. 单据操作人追溯（created by / confirmed by / posted by / cancelled by）
4. Dashboard 队列入口（Open Receipts / Open Shipments）
5. Import / Export 基础能力
6. Shipment allocation（先锁库存再发货）
7. 低库存和异常提醒
8. 用户自行修改密码
9. API 分页


