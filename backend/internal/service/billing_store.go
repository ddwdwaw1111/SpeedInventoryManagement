package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

const (
	DefaultInboundContainerFee  = 450
	DefaultWrappingFeePerPallet = 10
	DefaultStorageFeePerWeek    = 7
	DefaultOutboundFeePerPallet = 10
	DefaultBillingCurrency      = "USD"
	DefaultBillingInvoiceStatus = "DRAFT"

	BillingInvoiceLineInbound  = "INBOUND_CONTAINER"
	BillingInvoiceLineWrapping = "WRAPPING"
	BillingInvoiceLineStorage  = "STORAGE"
	BillingInvoiceLineOutbound = "OUTBOUND"

	billingMonthLayout         = "2006-01"
	billingInvoicePeriodLayout = "2006-01-02"
)

type CustomerRateCard struct {
	CustomerID              int64      `json:"customerId"`
	CustomerName            string     `json:"customerName"`
	InboundContainerFee     float64    `json:"inboundContainerFee"`
	WrappingFeePerPallet    float64    `json:"wrappingFeePerPallet"`
	StorageFeePerPalletWeek float64    `json:"storageFeePerPalletWeek"`
	OutboundFeePerPallet    float64    `json:"outboundFeePerPallet"`
	IsDefault               bool       `json:"isDefault"`
	UpdatedAt               *time.Time `json:"updatedAt"`
}

type UpsertCustomerRateCardInput struct {
	InboundContainerFee     float64 `json:"inboundContainerFee"`
	WrappingFeePerPallet    float64 `json:"wrappingFeePerPallet"`
	StorageFeePerPalletWeek float64 `json:"storageFeePerPalletWeek"`
	OutboundFeePerPallet    float64 `json:"outboundFeePerPallet"`
}

type GenerateBillingInvoicesInput struct {
	BillingMonth string `json:"billingMonth"`
	CustomerID   int64  `json:"customerId"`
}

type BillingInvoice struct {
	ID                    int64                `json:"id"`
	InvoiceNo             string               `json:"invoiceNo"`
	CustomerID            int64                `json:"customerId"`
	CustomerName          string               `json:"customerName"`
	BillingMonth          string               `json:"billingMonth"`
	Currency              string               `json:"currency"`
	Status                string               `json:"status"`
	InboundContainerCount int                  `json:"inboundContainerCount"`
	InboundFee            float64              `json:"inboundFee"`
	WrappingPallets       float64              `json:"wrappingPallets"`
	WrappingFee           float64              `json:"wrappingFee"`
	StoragePalletDays     float64              `json:"storagePalletDays"`
	StorageFee            float64              `json:"storageFee"`
	OutboundPallets       float64              `json:"outboundPallets"`
	OutboundFee           float64              `json:"outboundFee"`
	TotalAmount           float64              `json:"totalAmount"`
	GeneratedAt           time.Time            `json:"generatedAt"`
	CreatedAt             time.Time            `json:"createdAt"`
	UpdatedAt             time.Time            `json:"updatedAt"`
	Lines                 []BillingInvoiceLine `json:"lines"`
}

type BillingInvoiceLine struct {
	ID                 int64      `json:"id"`
	InvoiceID          int64      `json:"invoiceId"`
	LineType           string     `json:"lineType"`
	ReferenceType      string     `json:"referenceType"`
	ReferenceID        int64      `json:"referenceId"`
	Label              string     `json:"label"`
	ContainerNo        string     `json:"containerNo"`
	ServicePeriodStart *time.Time `json:"servicePeriodStart"`
	ServicePeriodEnd   *time.Time `json:"servicePeriodEnd"`
	Quantity           float64    `json:"quantity"`
	UnitRate           float64    `json:"unitRate"`
	Amount             float64    `json:"amount"`
	DetailsJSON        string     `json:"detailsJson"`
	SortOrder          int        `json:"sortOrder"`
}

type customerRateCardRow struct {
	CustomerID              int64        `db:"customer_id"`
	CustomerName            string       `db:"customer_name"`
	InboundContainerFee     float64      `db:"inbound_container_fee"`
	WrappingFeePerPallet    float64      `db:"wrapping_fee_per_pallet"`
	StorageFeePerPalletWeek float64      `db:"storage_fee_per_pallet_week"`
	OutboundFeePerPallet    float64      `db:"outbound_fee_per_pallet"`
	HasExplicitRateCard     int          `db:"has_explicit_rate_card"`
	UpdatedAt               sql.NullTime `db:"updated_at"`
}

type billingInvoiceRow struct {
	ID                    int64     `db:"id"`
	InvoiceNo             string    `db:"invoice_no"`
	CustomerID            int64     `db:"customer_id"`
	CustomerName          string    `db:"customer_name"`
	BillingMonth          time.Time `db:"billing_month"`
	Currency              string    `db:"currency"`
	Status                string    `db:"status"`
	InboundContainerCount int       `db:"inbound_container_count"`
	InboundFee            float64   `db:"inbound_fee"`
	WrappingPallets       float64   `db:"wrapping_pallets"`
	WrappingFee           float64   `db:"wrapping_fee"`
	StoragePalletDays     float64   `db:"storage_pallet_days"`
	StorageFee            float64   `db:"storage_fee"`
	OutboundPallets       float64   `db:"outbound_pallets"`
	OutboundFee           float64   `db:"outbound_fee"`
	TotalAmount           float64   `db:"total_amount"`
	GeneratedAt           time.Time `db:"generated_at"`
	CreatedAt             time.Time `db:"created_at"`
	UpdatedAt             time.Time `db:"updated_at"`
}

type billingInvoiceLineRow struct {
	ID                 int64          `db:"id"`
	InvoiceID          int64          `db:"invoice_id"`
	LineType           string         `db:"line_type"`
	ReferenceType      string         `db:"reference_type"`
	ReferenceID        sql.NullInt64  `db:"reference_id"`
	Label              string         `db:"label"`
	ContainerNo        string         `db:"container_no"`
	ServicePeriodStart sql.NullTime   `db:"service_period_start"`
	ServicePeriodEnd   sql.NullTime   `db:"service_period_end"`
	Quantity           float64        `db:"quantity"`
	UnitRate           float64        `db:"unit_rate"`
	Amount             float64        `db:"amount"`
	DetailsJSON        sql.NullString `db:"details_json"`
	SortOrder          int            `db:"sort_order"`
}

type billingInvoiceLineInput struct {
	LineType           string
	ReferenceType      string
	ReferenceID        int64
	Label              string
	ContainerNo        string
	ServicePeriodStart *time.Time
	ServicePeriodEnd   *time.Time
	Quantity           float64
	UnitRate           float64
	Amount             float64
	DetailsJSON        string
	SortOrder          int
}

type billingInboundChargeRow struct {
	DocumentID    int64     `db:"document_id"`
	ContainerNo   string    `db:"container_no"`
	EffectiveDate time.Time `db:"effective_date"`
	TotalPallets  float64   `db:"total_pallets"`
	TotalReceived int       `db:"total_received_qty"`
}

type billingOutboundAllocationRow struct {
	DocumentID    int64     `db:"document_id"`
	LineID        int64     `db:"line_id"`
	EffectiveDate time.Time `db:"effective_date"`
	ContainerNo   string    `db:"container_no"`
	LineQty       int       `db:"line_qty"`
	LinePallets   int       `db:"line_pallets"`
	AllocatedQty  int       `db:"allocated_qty"`
}

type billingDocumentPalletCharge struct {
	ReferenceID   int64
	EffectiveDate time.Time
	ContainerNo   string
	Pallets       float64
}

type billingStorageBalance struct {
	ContainerNo    string
	PalletDays     float64
	OpeningPallets float64
	ClosingPallets float64
}

func (s *Store) ListCustomerRateCards(ctx context.Context) ([]CustomerRateCard, error) {
	rows := make([]customerRateCardRow, 0)
	if err := s.db.SelectContext(ctx, &rows, `
		SELECT
			c.id AS customer_id,
			c.name AS customer_name,
			COALESCE(rc.inbound_container_fee, ?) AS inbound_container_fee,
			COALESCE(rc.wrapping_fee_per_pallet, ?) AS wrapping_fee_per_pallet,
			COALESCE(rc.storage_fee_per_pallet_week, ?) AS storage_fee_per_pallet_week,
			COALESCE(rc.outbound_fee_per_pallet, ?) AS outbound_fee_per_pallet,
			CASE WHEN rc.customer_id IS NULL THEN 0 ELSE 1 END AS has_explicit_rate_card,
			rc.updated_at
		FROM customers c
		LEFT JOIN customer_rate_cards rc ON rc.customer_id = c.id
		ORDER BY c.name ASC
	`, DefaultInboundContainerFee, DefaultWrappingFeePerPallet, DefaultStorageFeePerWeek, DefaultOutboundFeePerPallet); err != nil {
		return nil, fmt.Errorf("load customer rate cards: %w", err)
	}

	rateCards := make([]CustomerRateCard, 0, len(rows))
	for _, row := range rows {
		rateCard := CustomerRateCard{
			CustomerID:              row.CustomerID,
			CustomerName:            row.CustomerName,
			InboundContainerFee:     row.InboundContainerFee,
			WrappingFeePerPallet:    row.WrappingFeePerPallet,
			StorageFeePerPalletWeek: row.StorageFeePerPalletWeek,
			OutboundFeePerPallet:    row.OutboundFeePerPallet,
			IsDefault:               row.HasExplicitRateCard == 0,
		}
		if row.UpdatedAt.Valid {
			updatedAt := row.UpdatedAt.Time
			rateCard.UpdatedAt = &updatedAt
		}
		rateCards = append(rateCards, rateCard)
	}

	return rateCards, nil
}

func (s *Store) UpsertCustomerRateCard(ctx context.Context, customerID int64, input UpsertCustomerRateCardInput) (CustomerRateCard, error) {
	if customerID <= 0 {
		return CustomerRateCard{}, fmt.Errorf("%w: customer is required", ErrInvalidInput)
	}
	if input.InboundContainerFee < 0 || input.WrappingFeePerPallet < 0 || input.StorageFeePerPalletWeek < 0 || input.OutboundFeePerPallet < 0 {
		return CustomerRateCard{}, fmt.Errorf("%w: billing rates cannot be negative", ErrInvalidInput)
	}

	var customerName string
	if err := s.db.QueryRowContext(ctx, `SELECT name FROM customers WHERE id = ?`, customerID).Scan(&customerName); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return CustomerRateCard{}, ErrNotFound
		}
		return CustomerRateCard{}, fmt.Errorf("load customer for rate card: %w", err)
	}

	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO customer_rate_cards (
			customer_id,
			inbound_container_fee,
			wrapping_fee_per_pallet,
			storage_fee_per_pallet_week,
			outbound_fee_per_pallet
		) VALUES (?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			inbound_container_fee = VALUES(inbound_container_fee),
			wrapping_fee_per_pallet = VALUES(wrapping_fee_per_pallet),
			storage_fee_per_pallet_week = VALUES(storage_fee_per_pallet_week),
			outbound_fee_per_pallet = VALUES(outbound_fee_per_pallet),
			updated_at = CURRENT_TIMESTAMP
	`, customerID, input.InboundContainerFee, input.WrappingFeePerPallet, input.StorageFeePerPalletWeek, input.OutboundFeePerPallet); err != nil {
		return CustomerRateCard{}, mapDBError(fmt.Errorf("save customer rate card: %w", err))
	}

	rateCards, err := s.ListCustomerRateCards(ctx)
	if err != nil {
		return CustomerRateCard{}, err
	}
	for _, rateCard := range rateCards {
		if rateCard.CustomerID == customerID {
			return rateCard, nil
		}
	}

	return CustomerRateCard{
		CustomerID:              customerID,
		CustomerName:            customerName,
		InboundContainerFee:     input.InboundContainerFee,
		WrappingFeePerPallet:    input.WrappingFeePerPallet,
		StorageFeePerPalletWeek: input.StorageFeePerPalletWeek,
		OutboundFeePerPallet:    input.OutboundFeePerPallet,
	}, nil
}

func (s *Store) ListBillingInvoices(ctx context.Context, billingMonth string) ([]BillingInvoice, error) {
	monthClause := ""
	args := make([]any, 0, 1)
	if strings.TrimSpace(billingMonth) != "" {
		monthStart, _, _, err := parseBillingMonthBounds(billingMonth)
		if err != nil {
			return nil, err
		}
		monthClause = "WHERE bi.billing_month = ?"
		args = append(args, monthStart)
	}

	query := fmt.Sprintf(`
		SELECT
			bi.id,
			bi.invoice_no,
			bi.customer_id,
			c.name AS customer_name,
			bi.billing_month,
			bi.currency,
			bi.status,
			bi.inbound_container_count,
			bi.inbound_fee,
			bi.wrapping_pallets,
			bi.wrapping_fee,
			bi.storage_pallet_days,
			bi.storage_fee,
			bi.outbound_pallets,
			bi.outbound_fee,
			bi.total_amount,
			bi.generated_at,
			bi.created_at,
			bi.updated_at
		FROM billing_invoices bi
		JOIN customers c ON c.id = bi.customer_id
		%s
		ORDER BY bi.billing_month DESC, c.name ASC, bi.id DESC
	`, monthClause)

	rows := make([]billingInvoiceRow, 0)
	if err := s.db.SelectContext(ctx, &rows, query, args...); err != nil {
		return nil, fmt.Errorf("load billing invoices: %w", err)
	}
	if len(rows) == 0 {
		return []BillingInvoice{}, nil
	}

	invoices := make([]BillingInvoice, 0, len(rows))
	invoiceIDs := make([]int64, 0, len(rows))
	indexByID := make(map[int64]int, len(rows))
	for index, row := range rows {
		invoiceIDs = append(invoiceIDs, row.ID)
		indexByID[row.ID] = index
		invoices = append(invoices, BillingInvoice{
			ID:                    row.ID,
			InvoiceNo:             row.InvoiceNo,
			CustomerID:            row.CustomerID,
			CustomerName:          row.CustomerName,
			BillingMonth:          row.BillingMonth.Format(billingMonthLayout),
			Currency:              row.Currency,
			Status:                row.Status,
			InboundContainerCount: row.InboundContainerCount,
			InboundFee:            row.InboundFee,
			WrappingPallets:       row.WrappingPallets,
			WrappingFee:           row.WrappingFee,
			StoragePalletDays:     row.StoragePalletDays,
			StorageFee:            row.StorageFee,
			OutboundPallets:       row.OutboundPallets,
			OutboundFee:           row.OutboundFee,
			TotalAmount:           row.TotalAmount,
			GeneratedAt:           row.GeneratedAt,
			CreatedAt:             row.CreatedAt,
			UpdatedAt:             row.UpdatedAt,
			Lines:                 make([]BillingInvoiceLine, 0),
		})
	}

	lineQuery, lineArgs, err := sqlx.In(`
		SELECT
			id,
			invoice_id,
			line_type,
			COALESCE(reference_type, '') AS reference_type,
			reference_id,
			label,
			COALESCE(container_no, '') AS container_no,
			service_period_start,
			service_period_end,
			quantity,
			unit_rate,
			amount,
			details_json,
			sort_order
		FROM billing_invoice_lines
		WHERE invoice_id IN (?)
		ORDER BY invoice_id ASC, sort_order ASC, id ASC
	`, invoiceIDs)
	if err != nil {
		return nil, fmt.Errorf("build billing invoice line query: %w", err)
	}

	lineRows := make([]billingInvoiceLineRow, 0)
	if err := s.db.SelectContext(ctx, &lineRows, s.db.Rebind(lineQuery), lineArgs...); err != nil {
		return nil, fmt.Errorf("load billing invoice lines: %w", err)
	}

	for _, row := range lineRows {
		index, exists := indexByID[row.InvoiceID]
		if !exists {
			continue
		}
		invoices[index].Lines = append(invoices[index].Lines, row.toBillingInvoiceLine())
	}

	return invoices, nil
}

func (s *Store) GenerateBillingInvoices(ctx context.Context, input GenerateBillingInvoicesInput) ([]BillingInvoice, error) {
	monthStart, monthEnd, normalizedMonth, err := parseBillingMonthBounds(input.BillingMonth)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin billing invoice transaction: %w", err)
	}
	defer tx.Rollback()

	customerRateCards, err := s.listCustomerRateCardsTx(ctx, tx, input.CustomerID)
	if err != nil {
		return nil, err
	}

	generatedInvoices := make([]BillingInvoice, 0)
	for _, rateCard := range customerRateCards {
		invoice, hasLines, err := s.generateCustomerBillingInvoiceTx(ctx, tx, rateCard, monthStart, monthEnd, normalizedMonth)
		if err != nil {
			return nil, err
		}
		if !hasLines {
			if err := s.deleteBillingInvoiceForMonthTx(ctx, tx, rateCard.CustomerID, monthStart); err != nil {
				return nil, err
			}
			continue
		}
		generatedInvoices = append(generatedInvoices, invoice)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit billing invoices: %w", err)
	}

	return generatedInvoices, nil
}

func (s *Store) listCustomerRateCardsTx(ctx context.Context, tx *sql.Tx, customerID int64) ([]CustomerRateCard, error) {
	query := `
		SELECT
			c.id AS customer_id,
			c.name AS customer_name,
			COALESCE(rc.inbound_container_fee, ?) AS inbound_container_fee,
			COALESCE(rc.wrapping_fee_per_pallet, ?) AS wrapping_fee_per_pallet,
			COALESCE(rc.storage_fee_per_pallet_week, ?) AS storage_fee_per_pallet_week,
			COALESCE(rc.outbound_fee_per_pallet, ?) AS outbound_fee_per_pallet,
			CASE WHEN rc.customer_id IS NULL THEN 0 ELSE 1 END AS has_explicit_rate_card,
			rc.updated_at
		FROM customers c
		LEFT JOIN customer_rate_cards rc ON rc.customer_id = c.id
	`
	args := []any{
		DefaultInboundContainerFee,
		DefaultWrappingFeePerPallet,
		DefaultStorageFeePerWeek,
		DefaultOutboundFeePerPallet,
	}
	if customerID > 0 {
		query += ` WHERE c.id = ?`
		args = append(args, customerID)
	}
	query += ` ORDER BY c.name ASC`

	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("load customer rate cards in tx: %w", err)
	}
	defer rows.Close()

	rateCards := make([]CustomerRateCard, 0)
	for rows.Next() {
		var row customerRateCardRow
		if err := rows.Scan(
			&row.CustomerID,
			&row.CustomerName,
			&row.InboundContainerFee,
			&row.WrappingFeePerPallet,
			&row.StorageFeePerPalletWeek,
			&row.OutboundFeePerPallet,
			&row.HasExplicitRateCard,
			&row.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan customer rate card in tx: %w", err)
		}

		rateCard := CustomerRateCard{
			CustomerID:              row.CustomerID,
			CustomerName:            row.CustomerName,
			InboundContainerFee:     row.InboundContainerFee,
			WrappingFeePerPallet:    row.WrappingFeePerPallet,
			StorageFeePerPalletWeek: row.StorageFeePerPalletWeek,
			OutboundFeePerPallet:    row.OutboundFeePerPallet,
			IsDefault:               row.HasExplicitRateCard == 0,
		}
		if row.UpdatedAt.Valid {
			updatedAt := row.UpdatedAt.Time
			rateCard.UpdatedAt = &updatedAt
		}
		rateCards = append(rateCards, rateCard)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate customer rate cards in tx: %w", err)
	}
	if customerID > 0 && len(rateCards) == 0 {
		return nil, ErrNotFound
	}
	return rateCards, nil
}

func (s *Store) generateCustomerBillingInvoiceTx(
	ctx context.Context,
	tx *sql.Tx,
	rateCard CustomerRateCard,
	monthStart time.Time,
	monthEnd time.Time,
	normalizedMonth string,
) (BillingInvoice, bool, error) {
	inboundRows, err := s.loadBillingInboundRowsTx(ctx, tx, rateCard.CustomerID, monthEnd)
	if err != nil {
		return BillingInvoice{}, false, err
	}

	outboundRows, err := s.loadBillingOutboundAllocationRowsTx(ctx, tx, rateCard.CustomerID, monthEnd)
	if err != nil {
		return BillingInvoice{}, false, err
	}

	outboundCharges := buildBillingOutboundCharges(outboundRows)
	storageBalances := buildBillingStorageBalances(monthStart, monthEnd, inboundRows, outboundCharges)

	lines := make([]billingInvoiceLineInput, 0)
	sortOrder := 1
	inboundContainerCount := 0
	inboundFee := 0.0
	wrappingPallets := 0.0
	wrappingFee := 0.0
	storagePalletDays := 0.0
	storageFee := 0.0
	outboundPallets := 0.0
	outboundFee := 0.0

	for _, inboundRow := range inboundRows {
		if inboundRow.EffectiveDate.Before(monthStart) || inboundRow.EffectiveDate.After(monthEnd) {
			continue
		}

		containerLabel := displayBillingContainer(inboundRow.ContainerNo)
		inboundContainerCount += 1
		inboundFee += rateCard.InboundContainerFee
		lines = append(lines, billingInvoiceLineInput{
			LineType:      BillingInvoiceLineInbound,
			ReferenceType: "inbound_document",
			ReferenceID:   inboundRow.DocumentID,
			Label:         fmt.Sprintf("Inbound handling - %s", containerLabel),
			ContainerNo:   strings.TrimSpace(strings.ToUpper(inboundRow.ContainerNo)),
			Quantity:      1,
			UnitRate:      rateCard.InboundContainerFee,
			Amount:        rateCard.InboundContainerFee,
			DetailsJSON:   marshalBillingDetails(map[string]any{"effectiveDate": inboundRow.EffectiveDate.Format(billingInvoicePeriodLayout), "receivedQty": inboundRow.TotalReceived}),
			SortOrder:     sortOrder,
		})
		sortOrder += 1

		if inboundRow.TotalPallets > 0 {
			wrappingPallets += inboundRow.TotalPallets
			wrappingAmount := roundToTwoDecimals(inboundRow.TotalPallets * rateCard.WrappingFeePerPallet)
			wrappingFee += wrappingAmount
			lines = append(lines, billingInvoiceLineInput{
				LineType:      BillingInvoiceLineWrapping,
				ReferenceType: "inbound_document",
				ReferenceID:   inboundRow.DocumentID,
				Label:         fmt.Sprintf("Wrapping - %s", containerLabel),
				ContainerNo:   strings.TrimSpace(strings.ToUpper(inboundRow.ContainerNo)),
				Quantity:      roundToTwoDecimals(inboundRow.TotalPallets),
				UnitRate:      rateCard.WrappingFeePerPallet,
				Amount:        wrappingAmount,
				DetailsJSON:   marshalBillingDetails(map[string]any{"effectiveDate": inboundRow.EffectiveDate.Format(billingInvoicePeriodLayout)}),
				SortOrder:     sortOrder,
			})
			sortOrder += 1
		}
	}

	dailyStorageRate := 0.0
	if rateCard.StorageFeePerPalletWeek > 0 {
		dailyStorageRate = rateCard.StorageFeePerPalletWeek / 7
	}

	for _, storageBalance := range storageBalances {
		if storageBalance.PalletDays <= 0 {
			continue
		}
		lineAmount := roundToTwoDecimals(storageBalance.PalletDays * dailyStorageRate)
		storagePalletDays += storageBalance.PalletDays
		storageFee += lineAmount
		lines = append(lines, billingInvoiceLineInput{
			LineType:           BillingInvoiceLineStorage,
			ReferenceType:      "container",
			Label:              fmt.Sprintf("Storage - %s", displayBillingContainer(storageBalance.ContainerNo)),
			ContainerNo:        strings.TrimSpace(strings.ToUpper(storageBalance.ContainerNo)),
			ServicePeriodStart: &monthStart,
			ServicePeriodEnd:   &monthEnd,
			Quantity:           roundToTwoDecimals(storageBalance.PalletDays),
			UnitRate:           roundToTwoDecimals(dailyStorageRate),
			Amount:             lineAmount,
			DetailsJSON: marshalBillingDetails(map[string]any{
				"openingPallets": roundToTwoDecimals(storageBalance.OpeningPallets),
				"closingPallets": roundToTwoDecimals(storageBalance.ClosingPallets),
			}),
			SortOrder: sortOrder,
		})
		sortOrder += 1
	}

	for _, outboundCharge := range outboundCharges {
		if outboundCharge.EffectiveDate.Before(monthStart) || outboundCharge.EffectiveDate.After(monthEnd) || outboundCharge.Pallets <= 0 {
			continue
		}
		lineAmount := roundToTwoDecimals(outboundCharge.Pallets * rateCard.OutboundFeePerPallet)
		outboundPallets += outboundCharge.Pallets
		outboundFee += lineAmount
		lines = append(lines, billingInvoiceLineInput{
			LineType:      BillingInvoiceLineOutbound,
			ReferenceType: "outbound_document",
			ReferenceID:   outboundCharge.ReferenceID,
			Label:         fmt.Sprintf("Outbound handling - %s", displayBillingContainer(outboundCharge.ContainerNo)),
			ContainerNo:   strings.TrimSpace(strings.ToUpper(outboundCharge.ContainerNo)),
			Quantity:      roundToTwoDecimals(outboundCharge.Pallets),
			UnitRate:      rateCard.OutboundFeePerPallet,
			Amount:        lineAmount,
			DetailsJSON:   marshalBillingDetails(map[string]any{"effectiveDate": outboundCharge.EffectiveDate.Format(billingInvoicePeriodLayout)}),
			SortOrder:     sortOrder,
		})
		sortOrder += 1
	}

	if len(lines) == 0 {
		return BillingInvoice{}, false, nil
	}

	totalAmount := 0.0
	for _, line := range lines {
		totalAmount += line.Amount
	}

	inboundFee = roundToTwoDecimals(inboundFee)
	wrappingPallets = roundToTwoDecimals(wrappingPallets)
	wrappingFee = roundToTwoDecimals(wrappingFee)
	storagePalletDays = roundToTwoDecimals(storagePalletDays)
	storageFee = roundToTwoDecimals(storageFee)
	outboundPallets = roundToTwoDecimals(outboundPallets)
	outboundFee = roundToTwoDecimals(outboundFee)
	totalAmount = roundToTwoDecimals(totalAmount)

	invoiceNo := fmt.Sprintf("INV-%s-%06d", strings.ReplaceAll(normalizedMonth, "-", ""), rateCard.CustomerID)
	generatedAt := time.Now().UTC()

	result, err := tx.ExecContext(ctx, `
		INSERT INTO billing_invoices (
			invoice_no,
			customer_id,
			billing_month,
			currency,
			status,
			inbound_container_count,
			inbound_fee,
			wrapping_pallets,
			wrapping_fee,
			storage_pallet_days,
			storage_fee,
			outbound_pallets,
			outbound_fee,
			total_amount,
			generated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			invoice_no = VALUES(invoice_no),
			currency = VALUES(currency),
			status = VALUES(status),
			inbound_container_count = VALUES(inbound_container_count),
			inbound_fee = VALUES(inbound_fee),
			wrapping_pallets = VALUES(wrapping_pallets),
			wrapping_fee = VALUES(wrapping_fee),
			storage_pallet_days = VALUES(storage_pallet_days),
			storage_fee = VALUES(storage_fee),
			outbound_pallets = VALUES(outbound_pallets),
			outbound_fee = VALUES(outbound_fee),
			total_amount = VALUES(total_amount),
			generated_at = VALUES(generated_at),
			updated_at = CURRENT_TIMESTAMP,
			id = LAST_INSERT_ID(id)
	`,
		invoiceNo,
		rateCard.CustomerID,
		monthStart,
		DefaultBillingCurrency,
		DefaultBillingInvoiceStatus,
		inboundContainerCount,
		inboundFee,
		wrappingPallets,
		wrappingFee,
		storagePalletDays,
		storageFee,
		outboundPallets,
		outboundFee,
		totalAmount,
		generatedAt,
	)
	if err != nil {
		return BillingInvoice{}, false, mapDBError(fmt.Errorf("save billing invoice: %w", err))
	}

	invoiceID, err := result.LastInsertId()
	if err != nil {
		return BillingInvoice{}, false, fmt.Errorf("resolve billing invoice id: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM billing_invoice_lines WHERE invoice_id = ?`, invoiceID); err != nil {
		return BillingInvoice{}, false, mapDBError(fmt.Errorf("delete billing invoice lines: %w", err))
	}

	for _, line := range lines {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO billing_invoice_lines (
				invoice_id,
				line_type,
				reference_type,
				reference_id,
				label,
				container_no,
				service_period_start,
				service_period_end,
				quantity,
				unit_rate,
				amount,
				details_json,
				sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			invoiceID,
			line.LineType,
			nullableString(line.ReferenceType),
			nullableInt64(line.ReferenceID),
			line.Label,
			nullableString(strings.TrimSpace(strings.ToUpper(line.ContainerNo))),
			nullableTime(line.ServicePeriodStart),
			nullableTime(line.ServicePeriodEnd),
			line.Quantity,
			line.UnitRate,
			line.Amount,
			nullableString(line.DetailsJSON),
			line.SortOrder,
		); err != nil {
			return BillingInvoice{}, false, mapDBError(fmt.Errorf("insert billing invoice line: %w", err))
		}
	}

	return BillingInvoice{
		ID:                    invoiceID,
		InvoiceNo:             invoiceNo,
		CustomerID:            rateCard.CustomerID,
		CustomerName:          rateCard.CustomerName,
		BillingMonth:          normalizedMonth,
		Currency:              DefaultBillingCurrency,
		Status:                DefaultBillingInvoiceStatus,
		InboundContainerCount: inboundContainerCount,
		InboundFee:            inboundFee,
		WrappingPallets:       wrappingPallets,
		WrappingFee:           wrappingFee,
		StoragePalletDays:     storagePalletDays,
		StorageFee:            storageFee,
		OutboundPallets:       outboundPallets,
		OutboundFee:           outboundFee,
		TotalAmount:           totalAmount,
		GeneratedAt:           generatedAt,
		CreatedAt:             generatedAt,
		UpdatedAt:             generatedAt,
		Lines:                 toBillingInvoiceLines(invoiceID, lines),
	}, true, nil
}

func (s *Store) deleteBillingInvoiceForMonthTx(ctx context.Context, tx *sql.Tx, customerID int64, billingMonth time.Time) error {
	var invoiceID int64
	err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM billing_invoices
		WHERE customer_id = ? AND billing_month = ?
		FOR UPDATE
	`, customerID, billingMonth).Scan(&invoiceID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("load billing invoice for delete: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM billing_invoice_lines WHERE invoice_id = ?`, invoiceID); err != nil {
		return mapDBError(fmt.Errorf("delete billing invoice lines for empty invoice: %w", err))
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM billing_invoices WHERE id = ?`, invoiceID); err != nil {
		return mapDBError(fmt.Errorf("delete empty billing invoice: %w", err))
	}
	return nil
}

func (s *Store) loadBillingInboundRowsTx(ctx context.Context, tx *sql.Tx, customerID int64, monthEnd time.Time) ([]billingInboundChargeRow, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT
			d.id AS document_id,
			COALESCE(d.container_no, '') AS container_no,
			COALESCE(d.delivery_date, DATE(COALESCE(d.confirmed_at, d.created_at))) AS effective_date,
			COALESCE(SUM(idl.pallets), 0) AS total_pallets,
			COALESCE(SUM(idl.received_qty), 0) AS total_received_qty
		FROM inbound_documents d
		JOIN inbound_document_lines idl ON idl.document_id = d.id
		WHERE
			d.customer_id = ?
			AND d.cancelled_at IS NULL
			AND UPPER(d.status) = 'CONFIRMED'
			AND COALESCE(d.delivery_date, DATE(COALESCE(d.confirmed_at, d.created_at))) <= ?
		GROUP BY
			d.id,
			COALESCE(d.container_no, ''),
			COALESCE(d.delivery_date, DATE(COALESCE(d.confirmed_at, d.created_at)))
		ORDER BY effective_date ASC, d.id ASC
	`, customerID, monthEnd)
	if err != nil {
		return nil, fmt.Errorf("query billing inbound rows: %w", err)
	}
	defer rows.Close()

	result := make([]billingInboundChargeRow, 0)
	for rows.Next() {
		var row billingInboundChargeRow
		if err := rows.Scan(
			&row.DocumentID,
			&row.ContainerNo,
			&row.EffectiveDate,
			&row.TotalPallets,
			&row.TotalReceived,
		); err != nil {
			return nil, fmt.Errorf("scan billing inbound row: %w", err)
		}
		row.ContainerNo = normalizeBillingContainer(row.ContainerNo)
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate billing inbound rows: %w", err)
	}
	return result, nil
}

func (s *Store) loadBillingOutboundAllocationRowsTx(ctx context.Context, tx *sql.Tx, customerID int64, monthEnd time.Time) ([]billingOutboundAllocationRow, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT
			d.id AS document_id,
			odl.id AS line_id,
			COALESCE(d.out_date, DATE(COALESCE(d.confirmed_at, d.created_at))) AS effective_date,
			COALESCE(NULLIF(opa.container_no_snapshot, ''), NULLIF(m.container_no, ''), '') AS container_no,
			COALESCE(odl.quantity, 0) AS line_qty,
			COALESCE(odl.pallets, 0) AS line_pallets,
			COALESCE(opa.allocated_qty, odl.quantity, 0) AS allocated_qty
		FROM outbound_documents d
		JOIN outbound_document_lines odl ON odl.document_id = d.id
		LEFT JOIN outbound_pick_allocations opa ON opa.line_id = odl.id
		LEFT JOIN stock_movements m ON m.id = opa.movement_id
		WHERE
			d.customer_id = ?
			AND d.cancelled_at IS NULL
			AND UPPER(d.status) = 'CONFIRMED'
			AND COALESCE(d.out_date, DATE(COALESCE(d.confirmed_at, d.created_at))) <= ?
		ORDER BY effective_date ASC, d.id ASC, odl.id ASC, opa.id ASC
	`, customerID, monthEnd)
	if err != nil {
		return nil, fmt.Errorf("query billing outbound rows: %w", err)
	}
	defer rows.Close()

	result := make([]billingOutboundAllocationRow, 0)
	for rows.Next() {
		var row billingOutboundAllocationRow
		if err := rows.Scan(
			&row.DocumentID,
			&row.LineID,
			&row.EffectiveDate,
			&row.ContainerNo,
			&row.LineQty,
			&row.LinePallets,
			&row.AllocatedQty,
		); err != nil {
			return nil, fmt.Errorf("scan billing outbound row: %w", err)
		}
		row.ContainerNo = normalizeBillingContainer(row.ContainerNo)
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate billing outbound rows: %w", err)
	}
	return result, nil
}

func buildBillingOutboundCharges(rows []billingOutboundAllocationRow) []billingDocumentPalletCharge {
	type groupedLine struct {
		documentID    int64
		effectiveDate time.Time
		linePallets   int
		rows          []billingOutboundAllocationRow
	}

	grouped := make(map[int64]*groupedLine)
	for _, row := range rows {
		group := grouped[row.LineID]
		if group == nil {
			group = &groupedLine{
				documentID:    row.DocumentID,
				effectiveDate: row.EffectiveDate,
				linePallets:   row.LinePallets,
				rows:          make([]billingOutboundAllocationRow, 0, 1),
			}
			grouped[row.LineID] = group
		}
		group.rows = append(group.rows, row)
	}

	charges := make([]billingDocumentPalletCharge, 0)
	for _, group := range grouped {
		if group.linePallets <= 0 || len(group.rows) == 0 {
			continue
		}
		weights := make([]float64, 0, len(group.rows))
		for _, row := range group.rows {
			weight := float64(row.AllocatedQty)
			if weight < 0 {
				weight = 0
			}
			weights = append(weights, weight)
		}
		palletSplits := splitFloatByWeights(float64(group.linePallets), weights)
		for index, row := range group.rows {
			if palletSplits[index] <= 0 {
				continue
			}
			charges = append(charges, billingDocumentPalletCharge{
				ReferenceID:   row.DocumentID,
				EffectiveDate: row.EffectiveDate,
				ContainerNo:   normalizeBillingContainer(row.ContainerNo),
				Pallets:       palletSplits[index],
			})
		}
	}

	return mergeBillingDocumentPalletCharges(charges)
}

func buildBillingStorageBalances(
	monthStart time.Time,
	monthEnd time.Time,
	inboundRows []billingInboundChargeRow,
	outboundCharges []billingDocumentPalletCharge,
) []billingStorageBalance {
	type containerEvents map[string]float64

	eventMap := make(map[string]containerEvents)
	for _, row := range inboundRows {
		if row.TotalPallets <= 0 {
			continue
		}
		container := normalizeBillingContainer(row.ContainerNo)
		if eventMap[container] == nil {
			eventMap[container] = make(containerEvents)
		}
		eventMap[container][row.EffectiveDate.Format(time.DateOnly)] += row.TotalPallets
	}
	for _, charge := range outboundCharges {
		if charge.Pallets <= 0 {
			continue
		}
		container := normalizeBillingContainer(charge.ContainerNo)
		if eventMap[container] == nil {
			eventMap[container] = make(containerEvents)
		}
		eventMap[container][charge.EffectiveDate.Format(time.DateOnly)] -= charge.Pallets
	}

	containers := make([]string, 0, len(eventMap))
	for container := range eventMap {
		containers = append(containers, container)
	}
	sort.Strings(containers)

	balances := make([]billingStorageBalance, 0, len(containers))
	monthStartKey := monthStart.Format(time.DateOnly)
	for _, container := range containers {
		events := eventMap[container]
		if len(events) == 0 {
			continue
		}

		currentPallets := 0.0
		for eventDate, delta := range events {
			if eventDate < monthStartKey {
				currentPallets += delta
			}
		}
		if currentPallets < 0 {
			currentPallets = 0
		}
		openingPallets := currentPallets
		palletDays := 0.0

		for day := monthStart; !day.After(monthEnd); day = day.AddDate(0, 0, 1) {
			if delta, exists := events[day.Format(time.DateOnly)]; exists {
				currentPallets += delta
			}
			if currentPallets < 0 {
				currentPallets = 0
			}
			palletDays += currentPallets
		}

		if palletDays <= 0 && openingPallets <= 0 && currentPallets <= 0 {
			continue
		}
		balances = append(balances, billingStorageBalance{
			ContainerNo:    container,
			PalletDays:     roundToTwoDecimals(palletDays),
			OpeningPallets: roundToTwoDecimals(openingPallets),
			ClosingPallets: roundToTwoDecimals(currentPallets),
		})
	}

	return balances
}

func parseBillingMonthBounds(value string) (time.Time, time.Time, string, error) {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return time.Time{}, time.Time{}, "", fmt.Errorf("%w: billing month is required", ErrInvalidInput)
	}

	monthStart, err := time.ParseInLocation(billingMonthLayout, normalized, time.UTC)
	if err != nil {
		return time.Time{}, time.Time{}, "", fmt.Errorf("%w: billing month must use YYYY-MM", ErrInvalidInput)
	}
	monthStart = time.Date(monthStart.Year(), monthStart.Month(), 1, 0, 0, 0, 0, time.UTC)
	monthEnd := monthStart.AddDate(0, 1, -1)
	return monthStart, monthEnd, monthStart.Format(billingMonthLayout), nil
}

func normalizeBillingContainer(value string) string {
	return strings.TrimSpace(strings.ToUpper(value))
}

func displayBillingContainer(value string) string {
	normalized := normalizeBillingContainer(value)
	if normalized == "" {
		return "Unassigned container"
	}
	return normalized
}

func splitFloatByWeights(total float64, weights []float64) []float64 {
	splits := make([]float64, len(weights))
	if len(weights) == 0 || total <= 0 {
		return splits
	}

	totalWeight := 0.0
	for _, weight := range weights {
		if weight > 0 {
			totalWeight += weight
		}
	}
	if totalWeight <= 0 {
		totalWeight = float64(len(weights))
		for index := range weights {
			weights[index] = 1
		}
	}

	assigned := 0.0
	lastIndex := len(weights) - 1
	for index, weight := range weights {
		if index == lastIndex {
			splits[index] = total - assigned
			if splits[index] < 0 {
				splits[index] = 0
			}
			continue
		}
		value := total * (weight / totalWeight)
		splits[index] = value
		assigned += value
	}
	return splits
}

func mergeBillingDocumentPalletCharges(charges []billingDocumentPalletCharge) []billingDocumentPalletCharge {
	type mergeKey struct {
		referenceID int64
		dateKey     string
		containerNo string
	}

	merged := make(map[mergeKey]billingDocumentPalletCharge, len(charges))
	for _, charge := range charges {
		key := mergeKey{
			referenceID: charge.ReferenceID,
			dateKey:     charge.EffectiveDate.Format(time.DateOnly),
			containerNo: normalizeBillingContainer(charge.ContainerNo),
		}
		existing := merged[key]
		existing.ReferenceID = charge.ReferenceID
		existing.EffectiveDate = charge.EffectiveDate
		existing.ContainerNo = key.containerNo
		existing.Pallets += charge.Pallets
		merged[key] = existing
	}

	result := make([]billingDocumentPalletCharge, 0, len(merged))
	for _, charge := range merged {
		if charge.Pallets <= 0 {
			continue
		}
		result = append(result, charge)
	}
	sort.Slice(result, func(left, right int) bool {
		if result[left].EffectiveDate.Equal(result[right].EffectiveDate) {
			if result[left].ReferenceID == result[right].ReferenceID {
				return result[left].ContainerNo < result[right].ContainerNo
			}
			return result[left].ReferenceID < result[right].ReferenceID
		}
		return result[left].EffectiveDate.Before(result[right].EffectiveDate)
	})
	return result
}

func marshalBillingDetails(payload any) string {
	if payload == nil {
		return ""
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return ""
	}
	return string(encoded)
}

func toBillingInvoiceLines(invoiceID int64, lines []billingInvoiceLineInput) []BillingInvoiceLine {
	result := make([]BillingInvoiceLine, 0, len(lines))
	for _, line := range lines {
		result = append(result, BillingInvoiceLine{
			InvoiceID:          invoiceID,
			LineType:           line.LineType,
			ReferenceType:      line.ReferenceType,
			ReferenceID:        line.ReferenceID,
			Label:              line.Label,
			ContainerNo:        line.ContainerNo,
			ServicePeriodStart: line.ServicePeriodStart,
			ServicePeriodEnd:   line.ServicePeriodEnd,
			Quantity:           line.Quantity,
			UnitRate:           line.UnitRate,
			Amount:             line.Amount,
			DetailsJSON:        line.DetailsJSON,
			SortOrder:          line.SortOrder,
		})
	}
	return result
}

func (row billingInvoiceLineRow) toBillingInvoiceLine() BillingInvoiceLine {
	return BillingInvoiceLine{
		ID:                 row.ID,
		InvoiceID:          row.InvoiceID,
		LineType:           row.LineType,
		ReferenceType:      row.ReferenceType,
		ReferenceID:        row.ReferenceID.Int64,
		Label:              row.Label,
		ContainerNo:        row.ContainerNo,
		ServicePeriodStart: nullTimePtr(row.ServicePeriodStart),
		ServicePeriodEnd:   nullTimePtr(row.ServicePeriodEnd),
		Quantity:           row.Quantity,
		UnitRate:           row.UnitRate,
		Amount:             row.Amount,
		DetailsJSON:        row.DetailsJSON.String,
		SortOrder:          row.SortOrder,
	}
}

func nullTimePtr(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	timestamp := value.Time
	return &timestamp
}
