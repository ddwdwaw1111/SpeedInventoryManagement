# Receiving / Shipping Todo

这份清单用于单独整理 `Receipts / Shipments` 的流程优化路线图，按 `P0 / P1 / P2` 分层推进。

说明：
- `[x]` 已完成
- `[ ]` 待完成

## P0 - Core Receiving / Shipping Flow

目标：先把收货和出货的核心单据流程做成正式可控、可追踪、可回滚的业务链路。

### Receipt Foundation

- [x] `Receipt` 单据化：`document + lines + movements`
- [x] `Receipt` 状态流：
  - `draft`
  - `confirmed`
  - `posted`
  - `cancelled`
- [x] `Receipt` 支持 `expected qty` 和 `received qty`
- [x] `Receipt` 支持先建草稿再正式过账
- [x] `Receipt` 取消后可按单据回滚库存
- [ ] `Receipt variance` 明确化显示：
  - `matched`
  - `short`
  - `over`
- [ ] `Receipt` 列表强化筛选：
  - `receipt no`
  - `container no`
  - `customer`
  - `warehouse`
  - `date range`
  - `status`
- [ ] `Receipt` 详情中补齐更完整的操作人信息：
  - `created by`
  - `confirmed by`
  - `posted by`
  - `cancelled by`
- [ ] `Receipt` 异常高亮：
  - short receipt
  - over receipt
  - missing warehouse / section

### Shipment Foundation

- [x] `Shipment` 单据化：`document + lines + movements`
- [x] `Shipment` 状态流：
  - `draft`
  - `confirmed`
  - `posted`
  - `cancelled`
- [x] `Shipment` 支持先建草稿再正式过账
- [x] `Shipment` 支持 `cancel / reversal`
- [x] `Shipment` 增加基础对外字段：
  - `ship-to name`
  - `ship-to address`
  - `ship-to contact`
  - `carrier`
  - `tracking no.`
  - `BOL no.`
- [ ] `Shipment` 列表强化筛选：
  - `packing list no`
  - `customer`
  - `warehouse`
  - `ship date`
  - `status`
  - `carrier`
- [ ] `Shipment` 详情中补齐更完整的操作人信息：
  - `created by`
  - `confirmed by`
  - `posted by`
  - `cancelled by`
- [ ] `Shipment` 异常高亮：
  - insufficient available stock
  - cancelled shipment
  - missing carrier / tracking

### Shared Traceability

- [x] 收货 / 出货都能关联到 `Inventory Ledger / All Activity`
- [x] 收货 / 出货都具备状态、时间戳和基础审计链路
- [ ] 收货 / 出货详情都支持直接跳：
  - 相关库存行
  - 相关台账分录
  - 相关客户工作台上下文

## P1 - Operational Maturity

目标：把收货和出货从“能用”提升到更接近正式 WMS / 3PL 流程。

### Receipt Operations

- [ ] `Receive All`
- [ ] `Partial Receive`
- [ ] 逐行确认收货
- [ ] 柜号视角工作台：
  - 同一 `Container No.` 下多 SKU 汇总
  - 柜级状态和异常汇总
- [ ] `Inbound import`
- [ ] 内部 `Receiving Sheet` / 收货作业单 PDF

### Shipment Operations

- [ ] `Shipment allocation`
  - 先锁可用库存
  - 再正式出货
- [ ] `Outbound export`
- [ ] 内部 `Pick / Pack Sheet`
- [ ] 对外 `Delivery Note`
- [ ] 更完整的运输字段：
  - `service level`
  - `reference no.`
  - `customer PO`
  - `prepared by`

### Shared Efficiency

- [ ] 收货 / 出货都支持保存筛选条件
- [ ] 收货 / 出货都支持常用视图
- [ ] 首页加入更明确的 `Open Receipts / Open Shipments` 队列入口
- [ ] 单据详情中加入更完整的 timeline / status history

## P2 - Advanced Warehouse Flow

目标：进一步贴近正式仓储和运输协同流程。

### Receiving Expansion

- [ ] `ASN / 预约入库`
- [ ] 预报到货 vs 实际收货对比
- [ ] 预约到货异常提醒

### Shipping Expansion

- [ ] `Allocation / 配货`
- [ ] `Pick / Pack / Ship` 完整工作流
- [ ] 运输层字段：
  - `driver`
  - `vehicle`
  - `trailer`
  - `freight terms`

### Cross-Workflow Capability

- [ ] 收货 / 出货附件能力：
  - packing list
  - BOL
  - POD
  - customer source files
- [ ] 更完整的异常提醒：
  - low stock before shipment
  - receiving discrepancy
  - shipment exception
- [ ] 扫码枪 / 条码支持
- [ ] 更适合仓库现场的移动端收货 / 出货界面

## Suggested Next Step

建议优先顺序：

1. `Receipt variance` 明确化显示
2. 收货 / 出货列表高级筛选增强
3. 收货 / 出货详情里的 `created by / confirmed by / posted by / cancelled by`
4. `Inbound import / Outbound export`
5. `Pick / Pack Sheet / Delivery Note`
