USE speed_inventory_management;

INSERT INTO storage_locations (name, address, zone, description, capacity)
VALUES
  ('Rack A-01', '1200 Harbor Blvd, North Bergen, NJ', 'North Wing', 'Fast-moving packing supplies near dispatch', 320),
  ('Rack B-07', '88 Commerce Rd, Secaucus, NJ', 'Cold Room', 'Temperature-controlled shelf for sensitive items', 180),
  ('Floor C-12', '350 Industrial Ave, Jersey City, NJ', 'Bulk Zone', 'Pallet storage for heavy or oversized stock', 520)
ON DUPLICATE KEY UPDATE
  address = VALUES(address),
  zone = VALUES(zone),
  description = VALUES(description),
  capacity = VALUES(capacity);

INSERT INTO sku_master (
  sku,
  name,
  category,
  description,
  unit,
  reorder_level
)
VALUES
  ('023042', 'ALUMINIUM FOIL CONTAINER', 'Food Packaging', 'ALUMINIUM FOIL CONTAINER', 'pcs', 300),
  ('033768', 'ALUMINIUM FOIL CONTAINER', 'Food Packaging', 'ALUMINIUM FOIL CONTAINER', 'pcs', 250),
  ('VB72GC', '72 OZ ALUMINUM TAKE OUT CONTAINER COMBO', 'Food Packaging', '72 OZ ALUMINUM TAKE OUT CONTAINER COMBO', 'pcs', 120),
  ('023127', 'FOIL LID FOR ALUMINIUM KITCHEN WARE CONTAINER', 'Food Packaging', 'FOIL LID FOR ALUMINIUM KITCHEN WARE CONTAINER', 'pcs', 400),
  ('023134', 'ALUMINIUM KITCHEN WARE CONTAINER', 'Food Packaging', 'ALUMINIUM KITCHEN WARE CONTAINER', 'pcs', 180),
  ('033782', 'ALUMINIUM KITCHEN WARE CONTAINER', 'Food Packaging', 'ALUMINIUM KITCHEN WARE CONTAINER', 'pcs', 180),
  ('023141', 'ALUMINIUM KITCHEN WARE CONTAINER', 'Food Packaging', 'ALUMINIUM KITCHEN WARE CONTAINER', 'pcs', 150)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  category = VALUES(category),
  description = VALUES(description),
  unit = VALUES(unit),
  reorder_level = VALUES(reorder_level);

INSERT INTO inventory_items (
  sku_master_id,
  sku,
  name,
  category,
  description,
  unit,
  quantity,
  reorder_level,
  location_id,
  storage_section,
  delivery_date,
  container_no,
  expected_qty,
  received_qty,
  pallets,
  pallets_detail_ctns,
  height_in,
  out_date,
  last_restocked_at
)
VALUES
  ((SELECT id FROM sku_master WHERE sku = '023042'), '023042', 'ALUMINIUM FOIL CONTAINER', 'Food Packaging', 'ALUMINIUM FOIL CONTAINER', 'pcs', 1958, 300, 1, 'A', '2025-12-19', 'MRSU7765631', 1946, 1958, 30, '29*66+44', 87, NULL, CURRENT_TIMESTAMP),
  ((SELECT id FROM sku_master WHERE sku = '033768'), '033768', 'ALUMINIUM FOIL CONTAINER', 'Food Packaging', 'ALUMINIUM FOIL CONTAINER', 'pcs', 2751, 250, 1, 'A', '2025-12-11', 'KKFU7963968', 2751, 2751, 27, '26*105+21', 87, NULL, CURRENT_TIMESTAMP),
  ((SELECT id FROM sku_master WHERE sku = 'VB72GC'), 'VB72GC', '72 OZ ALUMINUM TAKE OUT CONTAINER COMBO', 'Food Packaging', '72 OZ ALUMINUM TAKE OUT CONTAINER COMBO', 'pcs', 564, 120, 2, 'A', '2025-12-11', 'TLLU5105021', 564, 564, 7, '7*70+74', 87, NULL, CURRENT_TIMESTAMP),
  ((SELECT id FROM sku_master WHERE sku = '023127'), '023127', 'FOIL LID FOR ALUMINIUM KITCHEN WARE CONTAINER', 'Food Packaging', 'FOIL LID FOR ALUMINIUM KITCHEN WARE CONTAINER', 'pcs', 3330, 400, 2, 'A', '2025-12-19', 'MRSU8580370', 3330, 3330, 29, '28*115+110', 87, NULL, CURRENT_TIMESTAMP),
  ((SELECT id FROM sku_master WHERE sku = '023134'), '023134', 'ALUMINIUM KITCHEN WARE CONTAINER', 'Food Packaging', 'ALUMINIUM KITCHEN WARE CONTAINER', 'pcs', 1430, 180, 3, 'A', '2025-12-08', 'HASU4467200', 1430, 1430, 29, '28*50+30', 87, NULL, CURRENT_TIMESTAMP),
  ((SELECT id FROM sku_master WHERE sku = '033782'), '033782', 'ALUMINIUM KITCHEN WARE CONTAINER', 'Food Packaging', 'ALUMINIUM KITCHEN WARE CONTAINER', 'pcs', 1430, 180, 3, 'A', '2025-12-08', 'MRKU3310106', 1431, 1430, 29, '28*50+30', 87, '2025-12-18', CURRENT_TIMESTAMP),
  ((SELECT id FROM sku_master WHERE sku = '023141'), '023141', 'ALUMINIUM KITCHEN WARE CONTAINER', 'Food Packaging', 'ALUMINIUM KITCHEN WARE CONTAINER', 'pcs', 1399, 150, 3, 'A', '2025-12-08', 'TRHU7293759', 1399, 1399, 24, '23*60+19', 87, NULL, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  sku_master_id = VALUES(sku_master_id),
  name = VALUES(name),
  category = VALUES(category),
  description = VALUES(description),
  unit = VALUES(unit),
  quantity = VALUES(quantity),
  reorder_level = VALUES(reorder_level),
  location_id = VALUES(location_id),
  storage_section = VALUES(storage_section),
  delivery_date = VALUES(delivery_date),
  container_no = VALUES(container_no),
  expected_qty = VALUES(expected_qty),
  received_qty = VALUES(received_qty),
  pallets = VALUES(pallets),
  pallets_detail_ctns = VALUES(pallets_detail_ctns),
  height_in = VALUES(height_in),
  out_date = VALUES(out_date),
  last_restocked_at = VALUES(last_restocked_at);

INSERT INTO stock_movements (
  item_id,
  location_id,
  movement_type,
  quantity_change,
  delivery_date,
  container_no,
  description_snapshot,
  expected_qty,
  received_qty,
  pallets,
  pallets_detail_ctns,
  height_in,
  out_date,
  reason,
  reference_code
)
VALUES
  (1, 1, 'IN', 1958, '2025-12-19', 'MRSU7765631', 'ALUMINIUM FOIL CONTAINER', 1946, 1958, 30, '29*66+44', 87, NULL, 'Inbound shipment recorded', 'IN-20251219-001'),
  (2, 1, 'IN', 2751, '2025-12-11', 'KKFU7963968', 'ALUMINIUM FOIL CONTAINER', 2751, 2751, 27, '26*105+21', 87, NULL, 'Inbound shipment recorded', 'IN-20251211-001'),
  (3, 2, 'IN', 564, '2025-12-11', 'TLLU5105021', '72 OZ ALUMINUM TAKE OUT CONTAINER COMBO', 564, 564, 7, '7*70+74', 87, NULL, 'Inbound shipment recorded', 'IN-20251211-002'),
  (4, 2, 'IN', 3330, '2025-12-19', 'MRSU8580370', 'FOIL LID FOR ALUMINIUM KITCHEN WARE CONTAINER', 3330, 3330, 29, '28*115+110', 87, NULL, 'Inbound shipment recorded', 'IN-20251219-002'),
  (6, 3, 'IN', 1430, '2025-12-08', 'MRKU3310106', 'ALUMINIUM KITCHEN WARE CONTAINER', 1431, 1430, 29, '28*50+30', 87, NULL, 'Inbound shipment recorded', 'IN-20251208-001'),
  (6, 3, 'OUT', -87, NULL, 'MRKU3310106', 'ALUMINIUM KITCHEN WARE CONTAINER', 0, 0, 0, '', 87, '2025-12-18', 'Outbound shipment recorded', 'OUT-20251218-001');
