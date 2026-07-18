# 调度通信模板

所有内容默认仅生成草稿，由调度员人工检查并发送。`[方括号]`内容必须替换；没有附件时不得写 “please find attached”。客户邮件和对外文件不得出现仓库名称、仓库地址或“从仓库发货”等描述。

## 客户：首次预约或前一天再次确认

Subject: `APPOINTMENT CONFIRMATION FOR PO#: [PO LIST] — [MMM D]`

```text
Hello [Name],

We are scheduled to complete [COUNT] delivery/deliveries on [Month Day]. The planned delivery time(s) are as follows:

PO#: [PO]   [TIME]   [MMM D]

Please confirm whether the above delivery time(s) can be accommodated. Please let us know if any adjustment is required.

[Please find attached the BOL(s).]

Best Regards,
Alvin
WFS Trucking Inc.
28 Distribution Blvd, Edison, NJ 08817
Tel: 929-756-1066
```

前一天邮件必须明确要求客户再次回复确认。客户第一次回复 OK 只代表暂定；前一天第二次回复 OK 后才能标记 `Final Confirmed / Released`。

## 客户：临时调换或变更

Subject: `APPOINTMENT SWITCH REQUEST FOR PO#: [PO A] & [PO B]`

```text
Hello [Name],

We would like to request the following delivery schedule change:

PO#: [PO A]
Original: [OLD DATE/TIME]
Requested: [NEW DATE/TIME]

PO#: [PO B]
Original: [OLD DATE/TIME]
Requested: [NEW DATE/TIME]

Please confirm whether the revised schedule can be accommodated. Until we receive your confirmation, we will continue to treat the existing appointments as unchanged.

[Please find attached the revised BOL(s).]

Best Regards,
Alvin
WFS Trucking Inc.
28 Distribution Blvd, Edison, NJ 08817
Tel: 929-756-1066
```

## 工厂：预约提货

Subject: `PICK UP PO#: [PO LIST] — [MMM D]`

```text
Good morning [Name],

We are planning to pick up the following PO(s) on [Month Day]:

PO#: [PO]   [PLANNED TIME OR WINDOW]

Please confirm that the order(s), packing list(s), and required cartons will be ready for pickup at 2600 Bergey Road, Hatfield, PA 19440.

[Please find attached the BOL(s).]

Best regards,
Alvin
WFS Trucking Inc.
28 Distribution Blvd, Edison, NJ 08817
Tel: 929-756-1066
```

工厂模板固定删除以下两句话：

- `I hope this email finds you well.`
- `Thank you for your support.`

## 仓库微信群：询问生产/备货完成时间

```text
【请确认备货进度｜[DATE]】

请确认以下 PO 的当前状态和最早可完成时间：
[PO / ITEM / 数量 / 客户计划日期]

如需从工厂提货回库，请同时确认：
1. 工厂可提货日期和时间窗口
2. 是否需要带箱子/取箱子
3. 预计回库时间
4. Packing List 是否已按只显示 item number 的要求准备

请逐单回复：已完成 / 预计完成时间 / 风险或缺料。
```

## 发送前硬性检查

1. Subject、正文、BOL 文件名中的 PO 完全一致。
2. 日期、星期、时间均按 America/New_York 复核。
3. 客户邮件不出现仓库信息；需要写发货地时只写工厂地址。
4. 没有真实附件时删除附件句；有多个 BOL 时逐一核对。
5. 变更尚未获客户确认时，原预约保持有效，不得写成已确认。
6. Packing List 对外版本只显示 item number。
