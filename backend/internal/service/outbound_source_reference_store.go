package service

import (
	"context"
	"fmt"
)

// OutboundSourceReference is the durable customer/SKU catalog metadata used to
// create planned outbound lines even when the SKU currently has no stock.
type OutboundSourceReference struct {
	CustomerID   int64  `db:"customer_id" json:"customerId"`
	CustomerName string `db:"customer_name" json:"customerName"`
	SKUMasterID  int64  `db:"sku_master_id" json:"skuMasterId"`
	ItemNumber   string `db:"item_number" json:"itemNumber"`
	SKU          string `db:"sku" json:"sku"`
	Description  string `db:"description" json:"description"`
	Unit         string `db:"unit" json:"unit"`
}

func (s *Store) ListOutboundSourceReferences(ctx context.Context) ([]OutboundSourceReference, error) {
	references := make([]OutboundSourceReference, 0)
	if err := s.db.SelectContext(ctx, &references, `
		SELECT
			c.id AS customer_id,
			c.name AS customer_name,
			sm.id AS sku_master_id,
			COALESCE(sm.item_number, '') AS item_number,
			sm.sku,
			COALESCE(NULLIF(sm.description, ''), sm.name, '') AS description,
			COALESCE(NULLIF(sm.unit, ''), 'PCS') AS unit
		FROM customers c
		CROSS JOIN sku_master sm
		ORDER BY c.name, sm.sku, sm.id
	`); err != nil {
		return nil, fmt.Errorf("load outbound source references: %w", err)
	}
	return references, nil
}
