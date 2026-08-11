package service

import (
	"context"
	"testing"
)

func TestListOutboundSourceReferencesIncludesZeroStockCatalogEntry(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()
	customer := mustCreateCustomer(t, ctx, store, "Outbound Reference Customer "+suffix)
	location := mustCreateLocation(t, ctx, store, "Outbound Reference Warehouse "+suffix)
	item := mustCreateItem(t, ctx, store, customer.ID, location.ID, "OUT-REF-"+suffix, 0)

	references, err := store.ListOutboundSourceReferences(ctx)
	if err != nil {
		t.Fatalf("list outbound source references: %v", err)
	}
	for _, reference := range references {
		if reference.CustomerID != customer.ID || reference.SKUMasterID != item.SKUMasterID {
			continue
		}
		if reference.CustomerName != customer.Name || reference.SKU != item.SKU || reference.Unit == "" {
			t.Fatalf("unexpected outbound source reference: %#v", reference)
		}
		return
	}
	t.Fatalf("zero-stock catalog entry was omitted: customer=%d skuMaster=%d references=%#v", customer.ID, item.SKUMasterID, references)
}

func TestLoadOutboundSourceReferenceAllowsGlobalUPCForCustomer(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()
	requestCustomer := mustCreateCustomer(t, ctx, store, "Outbound Reference Request Customer "+suffix)
	catalogCustomer := mustCreateCustomer(t, ctx, store, "Outbound Reference Catalog Customer "+suffix)
	location := mustCreateLocation(t, ctx, store, "Outbound Reference Catalog Warehouse "+suffix)
	foreignItem := mustCreateItem(t, ctx, store, catalogCustomer.ID, location.ID, "OUT-REF-FOREIGN-"+suffix, 0)

	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin transaction: %v", err)
	}
	defer tx.Rollback()

	reference, err := store.loadOutboundSourceReferenceTx(ctx, tx, requestCustomer.ID, location.ID, foreignItem.SKUMasterID)
	if err != nil {
		t.Fatalf("load global UPC reference: %v", err)
	}
	if reference.CustomerID != requestCustomer.ID || reference.SKUMasterID != foreignItem.SKUMasterID {
		t.Fatalf("unexpected global UPC reference: %#v", reference)
	}
}
