# Schema Simplification Todo

This tracks the KISS-oriented database simplification in rollout order.

## Phase 1 - Compatibility-first simplification

- [x] Read `inventory_items` display fields from `sku_master` instead of redundant item columns.
- [x] Read low-stock thresholds from `sku_master.reorder_level`.
- [x] Stop updating `inventory_items.expected_qty / received_qty / height_in / out_date` in stock application paths.
- [x] Stop depending on `receipt_lots.customer_id / location_id` in service queries.
- [x] Make new `inventory_items` writes use the compact field set.
- [x] Make new `receipt_lots` writes use the compact field set.
- [x] Update `schema.sql` target shape for `inventory_items` and `receipt_lots`.
- [x] Update `migrate.go` so old databases keep running while new writes no longer require legacy columns.

## Phase 2 - Document snapshot thinning

- [ ] Inbound lines: remove `reorder_level` snapshot usage and derive from `sku_master` where still needed.
- [ ] Inbound lines: review whether `unit_label` should stay at document level only.
- [ ] Outbound lines: derive `item_number` from `sku_master` / `inventory_items` where safe.
- [ ] Outbound lines: review whether `location_name_snapshot` should remain snapshot or be derived on read.
- [ ] Adjustment / transfer / cycle-count lines: confirm the minimum snapshot set needed for audit exports.

## Phase 3 - Stock movement cutover

- [ ] Define the compact `stock_movements` contract:
  - core identity columns
  - movement type
  - quantity delta
  - location / section / container
  - reason / reference
  - created timestamp
- [ ] Move document-specific detail fields out of `stock_movements` reads and into document joins / snapshots.
- [ ] Update movement list / activity pages so they no longer depend on legacy movement detail columns.
- [ ] Stop writing legacy movement detail columns on new movement rows.
- [ ] Backfill or ignore legacy movement detail columns for historical rows.
- [ ] Only after the application is no longer reading them, plan a destructive column-drop migration.

## Phase 4 - Destructive cleanup

- [ ] Drop legacy redundant columns from production after one full release cycle.
- [ ] Remove legacy backfill code from `migrate.go`.
- [ ] Remove temporary compatibility guards from services.
- [ ] Rebuild the ER diagram and schema docs from the final simplified shape.

## Safety checks before destructive drops

- [ ] Run backend integration tests on a copy of production data.
- [ ] Run billing generation on a production-like dump and compare results.
- [ ] Verify inventory detail, all activity, inbound, outbound, transfer, adjustment, cycle count, and receipt lot trace pages.
- [ ] Prepare rollback SQL for any destructive migration.
