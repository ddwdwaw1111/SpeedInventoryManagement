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
)

// --- public types ---

type BillingInvoice struct {
	ID                   int64                `json:"id"`
	InvoiceNo            string               `json:"invoiceNo"`
	CustomerID           int64                `json:"customerId"`
	CustomerNameSnapshot string               `json:"customerNameSnapshot"`
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
	Lines                []BillingInvoiceLine `json:"lines"`
}

type BillingInvoiceLine struct {
	ID          int64   `json:"id"`
	InvoiceID   int64   `json:"invoiceId"`
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
	SourceType  string  `json:"sourceType"`
	SortOrder   int     `json:"sortOrder"`
	CreatedAt   string  `json:"createdAt"`
}

type BillingRatesSnapshot struct {
	InboundContainerFee      float64 `json:"inboundContainerFee"`
	WrappingFeePerPallet     float64 `json:"wrappingFeePerPallet"`
	StorageFeePerPalletWeek  float64 `json:"storageFeePerPalletPerWeek"`
	OutboundFeePerPallet     float64 `json:"outboundFeePerPallet"`
}

// --- input types ---

type CreateBillingInvoiceInput struct {
	CustomerID   int64                       `json:"customerId"`
	CustomerName string                      `json:"customerName"`
	PeriodStart  string                      `json:"periodStart"`
	PeriodEnd    string                      `json:"periodEnd"`
	Rates        BillingRatesSnapshot        `json:"rates"`
	Notes        string                      `json:"notes"`
	Lines        []CreateBillingInvoiceLineInput `json:"lines"`
}

type CreateBillingInvoiceLineInput struct {
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
	SourceType  string  `json:"sourceType"`
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
	CustomerID           int64          `db:"customer_id"`
	CustomerNameSnapshot string         `db:"customer_name_snapshot"`
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
}

// --- store methods ---

func (s *Store) ListBillingInvoices(ctx context.Context, customerID int64, status string) ([]BillingInvoice, error) {
	query := `
		SELECT
			id, invoice_no, customer_id, customer_name_snapshot,
			period_start, period_end, currency_code, rates_json,
			subtotal, discount_total, grand_total, status, notes,
			finalized_at, finalized_by_user_id, paid_at, voided_at,
			created_by_user_id, created_at, updated_at
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
			id, invoice_no, customer_id, customer_name_snapshot,
			period_start, period_end, currency_code, rates_json,
			subtotal, discount_total, grand_total, status, notes,
			finalized_at, finalized_by_user_id, paid_at, voided_at,
			created_by_user_id, created_at, updated_at
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
			amount, notes, source_type, sort_order, created_at
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
	if strings.TrimSpace(input.PeriodStart) == "" || strings.TrimSpace(input.PeriodEnd) == "" {
		return BillingInvoice{}, fmt.Errorf("%w: billing period start and end are required", ErrInvalidInput)
	}

	periodStart, err := parseRequiredDate(input.PeriodStart)
	if err != nil {
		return BillingInvoice{}, fmt.Errorf("%w: invalid period start date", ErrInvalidInput)
	}
	periodEnd, err := parseRequiredDate(input.PeriodEnd)
	if err != nil {
		return BillingInvoice{}, fmt.Errorf("%w: invalid period end date", ErrInvalidInput)
	}

	ratesJSON, err := json.Marshal(input.Rates)
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

	result, err := tx.ExecContext(ctx, `
		INSERT INTO billing_invoices (
			invoice_no, customer_id, customer_name_snapshot,
			period_start, period_end, currency_code, rates_json,
			subtotal, discount_total, grand_total,
			status, notes, created_by_user_id
		) VALUES (?, ?, ?, ?, ?, 'USD', ?, 0, 0, 0, ?, ?, ?)
	`, invoiceNo, input.CustomerID, customerName,
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
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO billing_invoice_lines (
				invoice_id, charge_type, description, reference,
				container_no, warehouse, occurred_on,
				quantity, unit_rate, amount, notes,
				source_type, sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
			source_type, sort_order
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?)
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

	invoice := BillingInvoice{
		ID:                   row.ID,
		InvoiceNo:            row.InvoiceNo,
		CustomerID:           row.CustomerID,
		CustomerNameSnapshot: row.CustomerNameSnapshot,
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
