# Container Lifecycle Workflow

本文记录当前了解到的 container 业务全生命周期，作为后续库存、调度、入库、出库和 customer portal 重构的业务基准。

## 目标

系统最终需要让客户可以透明地看到每一个 container 以及 container 内部货物的完整生命周期：

- container tracking 信息
- packing list
- 到港、卸船、提柜安排
- 入库核对结果
- SKU、数量、pallet 数、破损、少货等异常
- 拆柜后货物进入哪些库位
- 后续被哪些 picking order 出库
- 实际出货 SKU 数量和 pallet 数是否确认
- 出货、送达、Bill of Lading 凭证
- container 内货物最终是否全部出完

## 当前业务流程

### 1. 客户发送 container 信息

客户会先把 container number 以及相关 tracking 信息发送给调度，同时也会发送 packing list。

这些信息是 container 生命周期的起点。后续所有入库、库存、出库和 customer portal 展示都应该能够追溯到这个 container 和对应 packing list。

### 2. 调度跟踪 container 状态

调度需要检查柜子当前状态，包括：

- 是否到港
- 是否已经卸船
- 是否可以安排提柜
- 是否存在延误或异常

这部分目前更偏调度流程，后续可以从单纯的 `container_no` 扩展为明确的 container tracking 状态。

### 3. 调度安排提柜

当柜子可以提取后，调度安排司机去拿柜。

司机来源有两种：

- 自有司机：如果公司自己的司机有时间，优先安排自有司机。
- 第三方公司：如果自有司机不够，需要打电话给第三方公司，付费请对方提柜。

后续如果重构调度模块，container 应该能记录 pickup assignment、driver/vendor、成本、提柜时间和异常。

### 4. 调度发送 packing list 给仓库

调度将 packing list 发给仓库人员，仓库根据 packing list 准备入库。

这一步是调度流程和仓库入库流程的交接点。

### 5. 仓库入库

仓库开始入库流程。

#### 5.1 卸柜并核对 packing list

卸柜后，仓库根据 packing list 核对货物，包括：

- SKU
- quantity
- pallet quantity
- 是否破损
- 是否少货
- 是否多货
- 其他入库异常

核对结果应该成为 container 生命周期的一部分，而不仅仅是库存数量变化。

#### 5.2 按 SKU 拆柜并入库位

仓库按照 SKU 将柜子拆解进入不同库位。

一个 container 内的货物可能被拆到多个 location / section / SKU balance。后续 customer portal 需要能从 container 视角看到这些分布。

### 6. 出库流程

#### 6.1 客户发送 picking order

客户给仓库 picking order，仓库根据 picking order 准备出库。

Picking order 应该能够关联回出库所使用的 container、SKU、数量和 pallet 数。

#### 6.2 配货、客户确认和出货数量确认

仓库根据 picking order 配货到出货区，并发给客户确认。

如果客户有更改，需要更新 picking order。

这里不再追踪每个 pallet 的拆分和合并。仓库如果为了装车调整板数，系统只记录最终确认的 SKU 数量、pallet 数和来源 container。

这意味着系统后续需要清楚表达：

- 实际出库 SKU 和数量
- 实际出库 pallet 数
- 来源 container / SKU / picking order 的关系
- 出库前后的库存数量变化

#### 6.3 调度进行出库流程

调度侧出库流程目前还没有完全明确。

后续需要补充：

- 谁安排司机
- 司机来源
- 车辆信息
- 预约时间
- 实际出发时间
- 到达时间
- 运费或第三方成本
- 异常状态

#### 6.4 送达并取得 Bill of Lading

司机到达目的地后，对方确认收货，并给予 Bill of Lading 作为最终送货到达凭证。

Bill of Lading 是出库生命周期的最终凭证，后续应该能关联到 picking order 和实际出库货物。

## 建议的生命周期阶段

```text
TRACKING_RECEIVED
ARRIVED_AT_PORT
DISCHARGED
PICKUP_ASSIGNED
PICKED_UP
ARRIVED_AT_WAREHOUSE
UNLOADING
RECEIVING_CHECK
RECEIVED_WITH_EXCEPTIONS / RECEIVED_COMPLETE
PUTAWAY
IN_STOCK
PICKING_ORDER_RECEIVED
PICKING
CUSTOMER_CONFIRMATION
READY_TO_SHIP
DISPATCHED
DELIVERED
BOL_RECEIVED
CLOSED
```

这些状态不一定都要立刻实现，但可以作为后续重构 container lifecycle 的业务词汇。

## 数据建模方向

当前系统已经新增 `container_lifecycle_events`，这是正确方向。后续建议继续保持以下分层：

- `stock_ledger`：库存数量变化的严格账本。
- `container_lifecycle_events`：container 视角的生命周期事件和关系投影。
- `inbound_documents` / `inbound_document_lines`：packing list 和入库明细。
- `outbound_documents` / `outbound_document_lines` / `outbound_pick_allocations`：picking order 和实际出库分配。

后续可能需要新增或扩展：

- `container_tracking_events`：到港、卸船、提柜、到仓等 tracking 状态。
- `container_pickup_assignments`：自有司机或第三方提柜安排。
- `delivery_events`：出库调度、送达、BOL 凭证。
- `container_documents`：packing list、BOL、异常照片等附件关系。

## Customer Portal 展示目标

Customer portal 中的 container 页面应该从客户角度回答这些问题：

- 我的柜子现在在哪里？
- 柜子是否已经到港、卸船、提柜、到仓？
- 柜子是否已经入库？
- 入库时和 packing list 是否一致？
- 哪些 SKU 有少货、破损、多货？
- 货物现在在哪些库位，以及各 SKU 还剩多少数量？
- 哪些 picking order 已经从这个 container 出过货？
- 出了几次货，每次出了哪些 SKU 和数量？
- 是否发生过移库、调整、拆板、合板？
- 是否已经全部出完？
- 最后一次出库是否已经送达，是否有 BOL？

## 重构原则

后续重构时，建议遵守以下原则：

1. 客户看到的是业务生命周期，不是内部库存操作细节。
2. 仓库操作可以变得更宽松，但库存过账仍然必须严格。
3. 所有数量变化必须进入 `stock_ledger`。
4. 所有 container 相关业务事件应进入或投影到 `container_lifecycle_events`。
5. pallet 只作为数量单位，出货以 SKU、container 和数量为准。
6. 出库完成不等于生命周期结束，BOL 才是送达凭证。
7. 后续应建立统一的 `InventoryMutationService`，让入库、出库、移库、调整、盘点都通过同一层写库存账本和生命周期事件。
