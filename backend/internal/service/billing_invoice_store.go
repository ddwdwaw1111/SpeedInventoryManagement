package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"
)

// --- constants ---

const (
	BillingInvoiceStatusDraft     = "DRAFT"
	BillingInvoiceStatusFinalized = "FINALIZED"
	BillingInvoiceStatusPaid      = "PAID"
	BillingInvoiceStatusVoid      = "VOID"
	BillingInvoiceTypeMixed       = "MIXED"
	BillingInvoiceTypeStorage     = "STORAGE_SETTLEMENT"
)

// --- public types ---

type BillingInvoice struct {
	ID                   int64                `json:"id"`
	InvoiceNo            string               `json:"invoiceNo"`
	InvoiceType          string               `json:"invoiceType"`
	CustomerID           int64                `json:"customerId"`
	CustomerNameSnapshot string               `json:"customerNameSnapshot"`
	WarehouseLocationID  *int64               `json:"warehouseLocationId"`
	WarehouseNameSnapshot string              `json:"warehouseNameSnapshot"`
	ContainerType        string               `json:"containerType"`
	PeriodStart          string               `json:"periodStart"`
	PeriodEnd            string               `json:"periodEnd"`
	CurrencyCode         string               `json:"currencyCode"`
	Rates                BillingRatesSnapshot `json:"rates"`
	Subtotal             float64              `json:"subtotal"`
	DiscountTotal        float64              `json:"discountTotal"`
	GrandTotal           float64              `json:"grandTotal"`
	Status               string               `json:"status"`
	Notes                string               `json:"notes"`
	FinalizedAt          *time.Time           `json:"finalizedAt"`
	FinalizedByUserID    *int64               `json:"finalizedByUserId"`
	PaidAt               *time.Time           `json:"paidAt"`
	VoidedAt             *time.Time           `json:"voidedAt"`
	CreatedByUserID      int64                `json:"createdByUserId"`
	CreatedAt            time.Time            `json:"createdAt"`
	UpdatedAt            time.Time            `json:"updatedAt"`
	LineCount            int                  `json:"lineCount"`
	Lines                []BillingInvoiceLine `json:"lines"`
}

type BillingInvoiceLine struct {
	ID          int64           `json:"id"`
	InvoiceID   int64           `json:"invoiceId"`
	ChargeType  string          `json:"chargeType"`
	Description string          `json:"description"`
	Reference   string          `json:"reference"`
	ContainerNo string          `json:"containerNo"`
	Warehouse   string          `json:"warehouse"`
	OccurredOn  string          `json:"occurredOn"`
	Quantity    float64         `json:"quantity"`
	UnitRate    float64         `json:"unitRate"`
	Amount      float64         `json:"amount"`
	Notes       string          `json:"notes"`
	SourceType  string          `json:"sourceType"`
	SortOrder   int             `json:"sortOrder"`
	CreatedAt   string          `json:"createdAt"`
	Details     json.RawMessage `json:"details,omitempty"`
}

type BillingRatesSnapshot struct {
	InboundContainerFee                    float64 `json:"inboundContainerFee"`
	WrappingFeePerPallet                   float64 `json:"wrappingFeePerPallet"`
	StorageFeePerPalletWeek                float64 `json:"storageFeePerPalletPerWeek,omitempty"`
	StorageFeePerPalletWeekNormal          float64 `json:"storageFeePerPalletPerWeekNormal"`
	StorageFeePerPalletWeekWestCoastTransfer float64 `json:"storageFeePerPalletPerWeekWestCoastTransfer"`
	OutboundFeePerPallet                   float64 `json:"outboundFeePerPallet"`
}

// --- input types ---

type CreateBillingInvoiceInput struct {
	InvoiceType  string                         `json:"invoiceType"`
	CustomerID   int64                          `json:"customerId"`
	CustomerName string                         `json:"customerName"`
	WarehouseLocationID *int64                  `json:"warehouseLocationId"`
	WarehouseName string                        `json:"warehouseName"`
	ContainerType string                        `json:"containerType"`
	PeriodStart  string                         `json:"periodStart"`
	PeriodEnd    string                         `json:"periodEnd"`
	Rates        BillingRatesSnapshot           `json:"rates"`
	Notes        string                         `json:"notes"`
	Lines        []CreateBillingInvoiceLineInput `json:"lines"`
}

type CreateBillingInvoiceLineInput struct {
	ChargeType  string          `json:"chargeType"`
	Description string          `json:"description"`
	Reference   string          `json:"reference"`
	ContainerNo string          `json:"containerNo"`
	Warehouse   string          `json:"warehouse"`
	OccurredOn  string          `json:"occurredOn"`
	Quantity    float64         `json:"quantity"`
	UnitRate    float64         `json:"unitRate"`
	Amount      float64         `json:"amount"`
	Notes       string          `json:"notes"`
	SourceType  string          `json:"sourceType"`
	Details     json.RawMessage `json:"details,omitempty"`
}

type UpdateBillingInvoiceInput struct {
	Notes string `json:"notes"`
}

type AddBillingInvoiceLineInput struct {
	ChargeType  string  `json:"chargeType"`
	Description string  `json:"description"`
	Reference   string  `json:"reference"`
	ContainerNo string  `json:"containerNo"`
	Warehouse   string  `json:"warehouse"`
	OccurredOn  string  `json:"occurredOn"`
	Quantity    float64 `json:"quantity"`
	UnitRate    float64 `json:"unitRate"`
	Amount      float64 `json:"amount"`
	Notes       string  `json:"notes"`
}

type UpdateBillingInvoiceLineInput struct {
	ChargeType  string  `json:"chargeType"`
	Description string  `json:"description"`
	Reference   string  `json:"reference"`
	ContainerNo string  `json:"containerNo"`
	Warehouse   string  `json:"warehouse"`
	OccurredOn  string  `json:"occurredOn"`
	Quantity    float64 `json:"quantity"`
	UnitRate    float64 `json:"unitRate"`
	Amount      float64 `json:"amount"`
	Notes       string  `json:"notes"`
}

// --- row types ---

type billingInvoiceRow struct {
	ID                   int64          `db:"id"`
	InvoiceNo            string         `db:"invoice_no"`
	InvoiceType          string         `db:"invoice_type"`
	CustomerID           int64          `db:"customer_id"`
	CustomerNameSnapshot string         `db:"customer_name_snapshot"`
	WarehouseLocationID  sql.NullInt64  `db:"warehouse_location_id"`
	WarehouseNameSnapshot sql.NullString `db:"warehouse_name_snapshot"`
	ContainerType        sql.NullString `db:"container_type"`
	PeriodStart          time.Time      `db:"period_start"`
	PeriodEnd            time.Time      `db:"period_end"`
	CurrencyCode         string         `db:"currency_code"`
	RatesJSON            string         `db:"rates_json"`
	Subtotal             float64        `db:"subtotal"`
	DiscountTotal        float64        `db:"discount_total"`
	GrandTotal           float64        `db:"grand_total"`
	Status               string         `db:"status"`
	Notes                sql.NullString `db:"notes"`
	FinalizedAt          sql.NullTime   `db:"finalized_at"`
	FinalizedByUserID    sql.NullInt64  `db:"finalized_by_user_id"`
	PaidAt               sql.NullTime   `db:"paid_at"`
	VoidedAt             sql.NullTime   `db:"voided_at"`
	CreatedByUserID      int64          `db:"created_by_user_id"`
	CreatedAt            time.Time      `db:"created_at"`
	UpdatedAt            time.Time      `db:"updated_at"`
	LineCount            int            `db:"line_count"`
}

type billingInvoiceLineRow struct {
	ID          int64          `db:"id"`
	InvoiceID   int64          `db:"invoice_id"`
	ChargeType  string         `db:"charge_type"`
	Description string         `db:"description"`
	Reference   sql.NullString `db:"reference"`
	ContainerNo sql.NullString `db:"container_no"`
	Warehouse   sql.NullString `db:"warehouse"`
	OccurredOn  sql.NullTime   `db:"occurred_on"`
	Quantity    float64        `db:"quantity"`
	UnitRate    float64        `db:"unit_rate"`
	Amount      float64        `db:"amount"`
	Notes       sql.NullString `db:"notes"`
	SourceType  string         `db:"source_type"`
	SortOrder   int            `db:"sort_order"`
	CreatedAt   time.Time      `db:"created_at"`
	DetailsJSON sql.NullString `db:"details_json"`
}

// --- store methods ---

func (s *Store) ListBillingInvoices(ctx context.Context, customerID int64, status string, invoiceType string) ([]BillingInvoice, error) {
	normalizedInvoiceType, err := normalizeBillingInvoiceType(invoiceType, true)
	if err != nil {
		return nil, err
	}

	query := `
		SELECT
			id, invoice_no, invoice_type, customer_id, customer_name_snapshot,
			warehouse_location_id, warehouse_name_snapshot, container_type,
			period_start, period_end, currency_code, rates_json,
			subtotal, discount_total, grand_total, status, notes,
			finalized_at, finalized_by_user_id, paid_at, voided_at,
			created_by_user_id, created_at, updated_at,
			(SELECT COUNT(*) FROM billing_invoice_lines WHERE invoice_id = billing_invoices.id) AS line_count
		FROM billing_invoices
		WHERE 1=1`
	args := make([]any, 0)

	if customerID > 0 {
		query += ` AND customer_id = ?`
		args = append(args, customerID)
	}
	if status != "" {
		query += ` AND status = ?`
		args = append(args, strings.ToUpper(strings.TrimSpace(status)))
	}
	if normalizedInvoiceType != "" {
		query += ` AND invoice_type = ?`
		args = append(args, normalizedInvoiceType)
	}
	query += ` ORDER BY created_at DESC LIMIT 200`

	var rows []billingInvoiceRow
	if err := s.db.SelectContext(ctx, &rows, s.db.Rebind(query), args...); err != nil {
		return nil, fmt.Errorf("list billing invoices: %w", err)
	}

	invoices := make([]BillingInvoice, 0, len(rows))
	for _, row := range rows {
		invoice := toBillingInvoice(row)
		invoice.Lines = []BillingInvoiceLine{}
		invoices = append(invoices, invoice)
	}
	return invoices, nil
}

func (s *Store) GetBillingInvoice(ctx context.Context, invoiceID int64) (BillingInvoice, error) {
	var row billingInvoiceRow
	if err := s.db.GetContext(ctx, &row, `
		SELECT
			id, invoice_no, invoice_type, customer_id, customer_name_snapshot,
			warehouse_location_id, warehouse_name_snapshot, container_type,
			period_start, period_end, currency_code, rates_json,
			subtotal, discount_total, grand_total, status, notes,
			finalized_at, finalized_by_user_id, paid_at, voided_at,
			created_by_user_id, created_at, updated_at,
			(SELECT COUNT(*) FROM billing_invoice_lines WHERE invoice_id = billing_invoices.id) AS line_count
		FROM billing_invoices
		WHERE id = ?
	`, invoiceID); err != nil {
		if err == sql.ErrNoRows {
			return BillingInvoice{}, fmt.Errorf("%w: billing invoice not found", ErrNotFound)
		}
		return BillingInvoice{}, fmt.Errorf("get billing invoice: %w", err)
	}

	invoice := toBillingInvoice(row)

	var lineRows []billingInvoiceLineRow
	if err := s.db.SelectContext(ctx, &lineRows, `
		SELECT
			id, invoice_id, charge_type, description, reference,
			container_no, warehouse, occurred_on, quantity, unit_rate,
			amount, notes, source_type, sort_order, created_at, details_json
		FROM billing_invoice_lines
		WHERE invoice_id = ?
		ORDER BY sort_order ASC, id ASC
	`, invoiceID); err != nil {
		return BillingInvoice{}, fmt.Errorf("load billing invoice lines: %w", err)
	}

	invoice.Lines = make([]BillingInvoiceLine, 0, len(lineRows))
	for _, lineRow := range lineRows {
		invoice.Lines = append(invoice.Lines, toBillingInvoiceLine(lineRow))
	}

	return invoice, nil
}

func (s *Store) CreateBillingInvoice(ctx context.Context, input CreateBillingInvoiceInput, createdByUserID int64) (BillingInvoice, error) {
	if input.CustomerID <= 0 {
		return BillingInvoice{}, fmt.Errorf("%w: customer is required", ErrInvalidInput)
	}
	if input.WarehouseLocationID != nil && *input.WarehouseLocationID <= 0 {
		return BillingInvoice{}, fmt.Errorf("%w: warehouse scope must be a valid location", ErrInvalidInput)
	}
	if strings.TrimSpace(input.PeriodStart) == "" || strings.TrimSpace(input.PeriodEnd) == "" {
		return BillingInvoice{}, fmt.Errorf("%w: billing period start and end are required", ErrInvalidInput)
	}
	invoiceType, err := normalizeBillingInvoiceType(input.InvoiceType, false)
	if err != nil {
		return BillingInvoice{}, err
	}
	normalizedContainerType := strings.TrimSpace(strings.ToUpper(input.ContainerType))
	if invoiceType == BillingInvoiceTypeStorage {
		if normalizedContainerType == "" {
			return BillingInvoice{}, fmt.Errorf("%w: container type is required for storage settlement invoices", ErrInvalidInput)
		}
		if err := validateContainerType(normalizedContainerType); err != nil {
			return BillingInvoice{}, err
		}
		normalizedContainerType = coalesceContainerType(normalizedContainerType)
	} else {
		normalizedContainerType = ""
	}

	periodStart, err := parseRequiredDate(input.PeriodStart)
	if err != nil {
		return BillingInvoice{}, fmt.Errorf("%w: invalid period start date", ErrInvalidInput)
	}
	periodEnd, err := parseRequiredDate(input.PeriodEnd)
	if err != nil {
		return BillingInvoice{}, fmt.Errorf("%w: invalid period end date", ErrInvalidInput)
	}
	if periodEnd.Before(periodStart) {
		return BillingInvoice{}, fmt.Errorf("%w: billing period end must be on or after the start date", ErrInvalidInput)
	}

	normalizedRates := normalizeBillingRatesSnapshot(input.Rates)
	ratesJSON, err := json.Marshal(normalizedRates)
	if err != nil {
		return BillingInvoice{}, fmt.Errorf("marshal rates: %w", err)
	}

	invoiceNo := generateBillingInvoiceNo(periodStart, input.CustomerID)
	customerName := strings.TrimSpace(input.CustomerName)
	if customerName == "" {
		customerName = fmt.Sprintf("Customer #%d", input.CustomerID)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return BillingInvoice{}, fmt.Errorf("begin billing invoice transaction: %w", err)
	}
	defer tx.Rollback()

	if invoiceType == BillingInvoiceTypeStorage {
		var existingInvoiceID int64
		err = tx.QueryRowContext(ctx, `
			SELECT id
			FROM billing_invoices
			WHERE customer_id = ?
				AND warehouse_location_id <=> ?
				AND container_type = ?
				AND period_start = ?
				AND period_end = ?
				AND invoice_type = ?
				AND status <> ?
			ORDER BY id DESC
			LIMIT 1
		`, input.CustomerID, nullableInt64Ptr(input.WarehouseLocationID), normalizedContainerType, periodStart, periodEnd, invoiceType, BillingInvoiceStatusVoid).Scan(&existingInvoiceID)
		if err != nil && err != sql.ErrNoRows {
			return BillingInvoice{}, fmt.Errorf("check storage settlement duplicates: %w", err)
		}
		if err == nil && existingInvoiceID > 0 {
			return BillingInvoice{}, fmt.Errorf("%w: a storage settlement invoice already exists for this customer, warehouse scope, container type, and billing period", ErrInvalidInput)
		}
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO billing_invoices (
			invoice_no, invoice_type, customer_id, customer_name_snapshot,
			warehouse_location_id, warehouse_name_snapshot, container_type,
			period_start, period_end, currency_code, rates_json,
			subtotal, discount_total, grand_total,
			status, notes, created_by_user_id
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, 0, 0, 0, ?, ?, ?)
	`, invoiceNo, invoiceType, input.CustomerID, customerName,
		nullableInt64Ptr(input.WarehouseLocationID), nullableString(strings.TrimSpace(input.WarehouseName)),
		nullableString(normalizedContainerType),
		periodStart, periodEnd, string(ratesJSON),
		BillingInvoiceStatusDraft, nullableString(strings.TrimSpace(input.Notes)), createdByUserID)
	if err != nil {
		return BillingInvoice{}, mapDBError(fmt.Errorf("create billing invoice: %w", err))
	}

	invoiceID, err := result.LastInsertId()
	if err != nil {
		return BillingInvoice{}, fmt.Errorf("resolve billing invoice id: %w", err)
	}

	for index, line := range input.Lines {
		sourceType := strings.TrimSpace(strings.ToUpper(line.SourceType))
		if sourceType == "" {
			sourceType = "AUTO"
		}
		occurredOn, _ := parseOptionalDate(line.OccurredOn)
		detailsJSON, err := normalizeBillingInvoiceLineDetails(line.Details)
		if err != nil {
			return BillingInvoice{}, err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO billing_invoice_lines (
				invoice_id, charge_type, description, reference,
				container_no, warehouse, occurred_on,
				quantity, unit_rate, amount, notes,
				source_type, sort_order, details_json
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, invoiceID,
			strings.TrimSpace(strings.ToUpper(line.ChargeType)),
			strings.TrimSpace(line.Description),
			nullableString(strings.TrimSpace(line.Reference)),
			nullableString(strings.TrimSpace(line.ContainerNo)),
			nullableString(strings.TrimSpace(line.Warehouse)),
			nullableTime(occurredOn),
			line.Quantity,
			line.UnitRate,
			roundCurrencyGo(line.Amount),
			nullableString(strings.TrimSpace(line.Notes)),
			sourceType,
			index+1,
			nullableJSONString(detailsJSON),
		); err != nil {
			return BillingInvoice{}, mapDBError(fmt.Errorf("insert billing invoice line: %w", err))
		}
	}

	if err := recalcBillingInvoiceTotalsTx(ctx, tx, invoiceID); err != nil {
		return BillingInvoice{}, err
	}

	if err := tx.Commit(); err != nil {
		return BillingInvoice{}, fmt.Errorf("commit billing invoice: %w", err)
	}

	return s.GetBillingInvoice(ctx, invoiceID)
}

func (s *Store) UpdateBillingInvoice(ctx context.Context, invoiceID int64, input UpdateBillingInvoiceInput) (BillingInvoice, error) {
	invoice, err := s.GetBillingInvoice(ctx, invoiceID)
	if err != nil {
		return BillingInvoice{}, err
	}
	if invoice.Status != BillingInvoiceStatusDraft {
		return BillingInvoice{}, fmt.Errorf("%w: only draft invoices can be edited", ErrInvalidInput)
	}

	if _, err := s.db.ExecContext(ctx, `
		UPDATE billing_invoices
		SET notes = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, nullableString(strings.TrimSpace(input.Notes)), invoiceID); err != nil {
		return BillingInvoice{}, mapDBError(fmt.Errorf("update billing invoice: %w", err))
	}

	return s.GetBillingInvoice(ctx, invoiceID)
}

func (s *Store) AddBillingInvoiceLine(ctx context.Context, invoiceID int64, input AddBillingInvoiceLineInput) (BillingInvoice, error) {
	invoice, err := s.GetBillingInvoice(ctx, invoiceID)
	if err != nil {
		return BillingInvoice{}, err
	}
	if invoice.Status != BillingInvoiceStatusDraft {
		return BillingInvoice{}, fmt.Errorf("%w: only draft invoices can be edited", ErrInvalidInput)
	}

	chargeType := strings.TrimSpace(strings.ToUpper(input.ChargeType))
	if chargeType == "" {
		return BillingInvoice{}, fmt.Errorf("%w: charge type is required", ErrInvalidInput)
	}

	maxSort := 0
	for _, line := range invoice.Lines {
		if line.SortOrder > maxSort {
			maxSort = line.SortOrder
		}
	}

	occurredOn, _ := parseOptionalDate(input.OccurredOn)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return BillingInvoice{}, fmt.Errorf("begin add line transaction: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO billing_invoice_lines (
			invoice_id, charge_type, description, reference,
			container_no, warehouse, occurred_on,
			quantity, unit_rate, amount, notes,
			source_type, sort_order, details_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, NULL)
	`, invoiceID, chargeType,
		strings.TrimSpace(input.Description),
		nullableString(strings.TrimSpace(input.Reference)),
		nullableString(strings.TrimSpace(input.ContainerNo)),
		nullableString(strings.TrimSpace(input.Warehouse)),
		nullableTime(occurredOn),
		input.Quantity, input.UnitRate, roundCurrencyGo(input.Amount),
		nullableString(strings.TrimSpace(input.Notes)),
		maxSort+1,
	); err != nil {
		return BillingInvoice{}, mapDBError(fmt.Errorf("add billing invoice line: %w", err))
	}

	if err := recalcBillingInvoiceTotalsTx(ctx, tx, invoiceID); err != nil {
		return BillingInvoice{}, err
	}

	if err := tx.Commit(); err != nil {
		return BillingInvoice{}, fmt.Errorf("commit add line: %w", err)
	}

	return s.GetBillingInvoice(ctx, invoiceID)
}

func (s *Store) UpdateBillingInvoiceLine(ctx context.Context, invoiceID int64, lineID int64, input UpdateBillingInvoiceLineInput) (BillingInvoice, error) {
	invoice, err := s.GetBillingInvoice(ctx, invoiceID)
	if err != nil {
		return BillingInvoice{}, err
	}
	if invoice.Status != BillingInvoiceStatusDraft {
		return BillingInvoice{}, fmt.Errorf("%w: only draft invoices can be edited", ErrInvalidInput)
	}

	found := false
	for _, line := range invoice.Lines {
		if line.ID == lineID {
			found = true
			break
		}
	}
	if !found {
		return BillingInvoice{}, fmt.Errorf("%w: invoice line not found", ErrNotFound)
	}

	chargeType := strings.TrimSpace(strings.ToUpper(input.ChargeType))
	if chargeType == "" {
		return BillingInvoice{}, fmt.Errorf("%w: charge type is required", ErrInvalidInput)
	}

	occurredOn, _ := parseOptionalDate(input.OccurredOn)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return BillingInvoice{}, fmt.Errorf("begin update line transaction: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		UPDATE billing_invoice_lines
		SET
			charge_type = ?,
			description = ?,
			reference = ?,
			container_no = ?,
			warehouse = ?,
			occurred_on = ?,
			quantity = ?,
			unit_rate = ?,
			amount = ?,
			notes = ?
		WHERE id = ? AND invoice_id = ?
	`, chargeType,
		strings.TrimSpace(input.Description),
		nullableString(strings.TrimSpace(input.Reference)),
		nullableString(strings.TrimSpace(input.ContainerNo)),
		nullableString(strings.TrimSpace(input.Warehouse)),
		nullableTime(occurredOn),
		input.Quantity, input.UnitRate, roundCurrencyGo(input.Amount),
		nullableString(strings.TrimSpace(input.Notes)),
		lineID, invoiceID,
	); err != nil {
		return BillingInvoice{}, mapDBError(fmt.Errorf("update billing invoice line: %w", err))
	}

	if err := recalcBillingInvoiceTotalsTx(ctx, tx, invoiceID); err != nil {
		return BillingInvoice{}, err
	}

	if err := tx.Commit(); err != nil {
		return BillingInvoice{}, fmt.Errorf("commit update line: %w", err)
	}

	return s.GetBillingInvoice(ctx, invoiceID)
}

func (s *Store) DeleteBillingInvoiceLine(ctx context.Context, invoiceID int64, lineID int64) (BillingInvoice, error) {
	invoice, err := s.GetBillingInvoice(ctx, invoiceID)
	if err != nil {
		return BillingInvoice{}, err
	}
	if invoice.Status != BillingInvoiceStatusDraft {
		return BillingInvoice{}, fmt.Errorf("%w: only draft invoices can be edited", ErrInvalidInput)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return BillingInvoice{}, fmt.Errorf("begin delete line transaction: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		DELETE FROM billing_invoice_lines WHERE id = ? AND invoice_id = ?
	`, lineID, invoiceID); err != nil {
		return BillingInvoice{}, mapDBError(fmt.Errorf("delete billing invoice line: %w", err))
	}

	if err := recalcBillingInvoiceTotalsTx(ctx, tx, invoiceID); err != nil {
		return BillingInvoice{}, err
	}

	if err := tx.Commit(); err != nil {
		return BillingInvoice{}, fmt.Errorf("commit delete line: %w", err)
	}

	return s.GetBillingInvoice(ctx, invoiceID)
}

func (s *Store) FinalizeBillingInvoice(ctx context.Context, invoiceID int64, userID int64) (BillingInvoice, error) {
	invoice, err := s.GetBillingInvoice(ctx, invoiceID)
	if err != nil {
		return BillingInvoice{}, err
	}
	if invoice.Status != BillingInvoiceStatusDraft {
		return BillingInvoice{}, fmt.Errorf("%w: only draft invoices can be finalized", ErrInvalidInput)
	}

	now := time.Now().UTC()
	if _, err := s.db.ExecContext(ctx, `
		UPDATE billing_invoices
		SET status = ?, finalized_at = ?, finalized_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, BillingInvoiceStatusFinalized, now, userID, invoiceID); err != nil {
		return BillingInvoice{}, mapDBError(fmt.Errorf("finalize billing invoice: %w", err))
	}

	return s.GetBillingInvoice(ctx, invoiceID)
}

func (s *Store) MarkBillingInvoicePaid(ctx context.Context, invoiceID int64) (BillingInvoice, error) {
	invoice, err := s.GetBillingInvoice(ctx, invoiceID)
	if err != nil {
		return BillingInvoice{}, err
	}
	if invoice.Status != BillingInvoiceStatusFinalized {
		return BillingInvoice{}, fmt.Errorf("%w: only finalized invoices can be marked as paid", ErrInvalidInput)
	}

	now := time.Now().UTC()
	if _, err := s.db.ExecContext(ctx, `
		UPDATE billing_invoices
		SET status = ?, paid_at = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, BillingInvoiceStatusPaid, now, invoiceID); err != nil {
		return BillingInvoice{}, mapDBError(fmt.Errorf("mark billing invoice paid: %w", err))
	}

	return s.GetBillingInvoice(ctx, invoiceID)
}

func (s *Store) VoidBillingInvoice(ctx context.Context, invoiceID int64) (BillingInvoice, error) {
	invoice, err := s.GetBillingInvoice(ctx, invoiceID)
	if err != nil {
		return BillingInvoice{}, err
	}
	if invoice.Status == BillingInvoiceStatusVoid {
		return BillingInvoice{}, fmt.Errorf("%w: invoice is already voided", ErrInvalidInput)
	}

	now := time.Now().UTC()
	if _, err := s.db.ExecContext(ctx, `
		UPDATE billing_invoices
		SET status = ?, voided_at = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, BillingInvoiceStatusVoid, now, invoiceID); err != nil {
		return BillingInvoice{}, mapDBError(fmt.Errorf("void billing invoice: %w", err))
	}

	return s.GetBillingInvoice(ctx, invoiceID)
}

func (s *Store) DeleteBillingInvoice(ctx context.Context, invoiceID int64) error {
	invoice, err := s.GetBillingInvoice(ctx, invoiceID)
	if err != nil {
		return err
	}
	if invoice.Status != BillingInvoiceStatusDraft {
		return fmt.Errorf("%w: only draft invoices can be deleted", ErrInvalidInput)
	}

	if _, err := s.db.ExecContext(ctx, `DELETE FROM billing_invoices WHERE id = ?`, invoiceID); err != nil {
		return mapDBError(fmt.Errorf("delete billing invoice: %w", err))
	}

	return nil
}

// --- helpers ---

func recalcBillingInvoiceTotalsTx(ctx context.Context, tx *sql.Tx, invoiceID int64) error {
	var subtotal, discountTotal float64
	rows, err := tx.QueryContext(ctx, `
		SELECT charge_type, amount FROM billing_invoice_lines WHERE invoice_id = ?
	`, invoiceID)
	if err != nil {
		return fmt.Errorf("load invoice lines for recalc: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var chargeType string
		var amount float64
		if err := rows.Scan(&chargeType, &amount); err != nil {
			return fmt.Errorf("scan invoice line for recalc: %w", err)
		}
		if chargeType == "DISCOUNT" {
			discountTotal += amount
		} else {
			subtotal += amount
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate invoice lines for recalc: %w", err)
	}

	grandTotal := roundCurrencyGo(subtotal + discountTotal)
	subtotal = roundCurrencyGo(subtotal)
	discountTotal = roundCurrencyGo(discountTotal)

	if _, err := tx.ExecContext(ctx, `
		UPDATE billing_invoices
		SET subtotal = ?, discount_total = ?, grand_total = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, subtotal, discountTotal, grandTotal, invoiceID); err != nil {
		return mapDBError(fmt.Errorf("recalc billing invoice totals: %w", err))
	}

	return nil
}

func toBillingInvoice(row billingInvoiceRow) BillingInvoice {
	var rates BillingRatesSnapshot
	_ = json.Unmarshal([]byte(row.RatesJSON), &rates)
	rates = normalizeBillingRatesSnapshot(rates)

	containerType := ""
	if row.ContainerType.Valid && strings.TrimSpace(row.ContainerType.String) != "" {
		containerType = coalesceContainerType(row.ContainerType.String)
	} else if row.InvoiceType == BillingInvoiceTypeStorage {
		containerType = ContainerTypeNormal
	}

	invoice := BillingInvoice{
		ID:                   row.ID,
		InvoiceNo:            row.InvoiceNo,
		InvoiceType:          row.InvoiceType,
		CustomerID:           row.CustomerID,
		CustomerNameSnapshot: row.CustomerNameSnapshot,
		WarehouseNameSnapshot: coalesceNullString(row.WarehouseNameSnapshot),
		ContainerType:        containerType,
		PeriodStart:          row.PeriodStart.Format(time.DateOnly),
		PeriodEnd:            row.PeriodEnd.Format(time.DateOnly),
		CurrencyCode:         row.CurrencyCode,
		Rates:                rates,
		Subtotal:             row.Subtotal,
		DiscountTotal:        row.DiscountTotal,
		GrandTotal:           row.GrandTotal,
		Status:               row.Status,
		Notes:                coalesceNullString(row.Notes),
		CreatedByUserID:      row.CreatedByUserID,
		CreatedAt:            row.CreatedAt,
		UpdatedAt:            row.UpdatedAt,
		LineCount:            row.LineCount,
	}
	if row.WarehouseLocationID.Valid {
		invoice.WarehouseLocationID = &row.WarehouseLocationID.Int64
	}
	if row.FinalizedAt.Valid {
		invoice.FinalizedAt = &row.FinalizedAt.Time
	}
	if row.FinalizedByUserID.Valid {
		invoice.FinalizedByUserID = &row.FinalizedByUserID.Int64
	}
	if row.PaidAt.Valid {
		invoice.PaidAt = &row.PaidAt.Time
	}
	if row.VoidedAt.Valid {
		invoice.VoidedAt = &row.VoidedAt.Time
	}
	return invoice
}

func toBillingInvoiceLine(row billingInvoiceLineRow) BillingInvoiceLine {
	occurredOn := ""
	if row.OccurredOn.Valid {
		occurredOn = row.OccurredOn.Time.Format(time.DateOnly)
	}
	return BillingInvoiceLine{
		ID:          row.ID,
		InvoiceID:   row.InvoiceID,
		ChargeType:  row.ChargeType,
		Description: row.Description,
		Reference:   coalesceNullString(row.Reference),
		ContainerNo: coalesceNullString(row.ContainerNo),
		Warehouse:   coalesceNullString(row.Warehouse),
		OccurredOn:  occurredOn,
		Quantity:    row.Quantity,
		UnitRate:    row.UnitRate,
		Amount:      row.Amount,
		Notes:       coalesceNullString(row.Notes),
		SourceType:  row.SourceType,
		SortOrder:   row.SortOrder,
		CreatedAt:   row.CreatedAt.Format(time.RFC3339),
		Details:     detailsJSON(row.DetailsJSON),
	}
}

func coalesceNullString(ns sql.NullString) string {
	if ns.Valid {
		return ns.String
	}
	return ""
}

func generateBillingInvoiceNo(periodStart time.Time, customerID int64) string {
	return fmt.Sprintf("INV-%s-%d-%d", periodStart.Format("200601"), customerID, time.Now().UnixMilli()%100000)
}

func detailsJSON(value sql.NullString) json.RawMessage {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return nil
	}
	return json.RawMessage(value.String)
}

func nullableJSONString(value json.RawMessage) any {
	if len(value) == 0 {
		return nil
	}
	return string(value)
}

func nullableInt64Ptr(value *int64) any {
	if value == nil || *value <= 0 {
		return nil
	}
	return *value
}

func normalizeBillingRatesSnapshot(rates BillingRatesSnapshot) BillingRatesSnapshot {
	if rates.StorageFeePerPalletWeekNormal <= 0 && rates.StorageFeePerPalletWeekWestCoastTransfer <= 0 && rates.StorageFeePerPalletWeek > 0 {
		rates.StorageFeePerPalletWeekNormal = rates.StorageFeePerPalletWeek
		rates.StorageFeePerPalletWeekWestCoastTransfer = rates.StorageFeePerPalletWeek
	}
	if rates.StorageFeePerPalletWeek <= 0 {
		rates.StorageFeePerPalletWeek = rates.StorageFeePerPalletWeekNormal
	}
	return rates
}

func normalizeBillingInvoiceType(value string, allowEmpty bool) (string, error) {
	normalized := strings.TrimSpace(strings.ToUpper(value))
	if normalized == "" {
		if allowEmpty {
			return "", nil
		}
		return BillingInvoiceTypeMixed, nil
	}
	switch normalized {
	case BillingInvoiceTypeMixed, BillingInvoiceTypeStorage:
		return normalized, nil
	default:
		return "", fmt.Errorf("%w: billing invoice type must be MIXED or STORAGE_SETTLEMENT", ErrInvalidInput)
	}
}

func normalizeBillingInvoiceLineDetails(value json.RawMessage) (json.RawMessage, error) {
	if len(value) == 0 {
		return nil, nil
	}
	if !json.Valid(value) {
		return nil, fmt.Errorf("%w: billing invoice line details must be valid JSON", ErrInvalidInput)
	}
	return json.RawMessage(append([]byte(nil), value...)), nil
}

func roundCurrencyGo(value float64) float64 {
	return math.Round(value*100) / 100
}

func parseRequiredDate(value string) (time.Time, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return time.Time{}, fmt.Errorf("date is required")
	}
	for _, layout := range acceptedDateLayouts {
		if parsed, err := time.Parse(layout, trimmed); err == nil {
			return parsed, nil
		}
	}
	return time.Time{}, fmt.Errorf("could not parse date: %s", trimmed)
}
