# Container-centric v1 workflow

## Core model

- A customer/container number identifies one container, even when it has multiple receipts on different dates.
- Each receipt remains an independent `inbound_document`; its lines retain expected quantity, received quantity, pallet count, and the inbound CTN-per-pallet observation.
- `inventory_items` is the current balance by customer, container, UPC, warehouse, and storage section.
- `stock_ledger` is the inventory audit trail used for container history, reports, and billing provenance.
- Pallets are independent numeric quantities. There are no pallet or pallet-item entity tables.

## CTN per pallet

The two meanings must not be merged:

1. `inbound_document_lines.inbound_ctns_per_pallet` records how the goods arrived for that receipt.
2. `sku_master.outbound_cartons_per_layer * sku_master.outbound_layer_count` describes the normal outbound palletization rule.

Selecting a UPC must not copy the outbound rule into an inbound receipt.

## Outbound allocation

Each outbound line can allocate quantity from one or more containers. `outbound_container_allocations` stores the source container, warehouse/section, quantity, inventory pallets used, outbound pallets, and automatic-transfer provenance. The allocation rows are the relational source of truth; there is no duplicate JSON allocation column.

## Container history

Container activity is read directly from `stock_ledger` and document/allocation references. A second lifecycle-event projection is intentionally not maintained.

## Migration policy

`backend/internal/database/v1_schema.sql` is the v1 schema baseline. New environments start empty and receive only the current model through the Go migration runner. Old pre-v1 data-conversion scripts and compatibility tables are not part of v1.
