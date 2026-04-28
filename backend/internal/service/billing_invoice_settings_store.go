package service

import (
	"context"
	"database/sql"
	"time"
)

const billingInvoiceSettingsID = 1

type BillingInvoiceSettings struct {
	ID              int64                `db:"id" json:"id"`
	Header          BillingInvoiceHeader `json:"header"`
	UpdatedByUserID int64                `db:"updated_by_user_id" json:"updatedByUserId"`
	CreatedAt       time.Time            `db:"created_at" json:"createdAt"`
	UpdatedAt       time.Time            `db:"updated_at" json:"updatedAt"`
}

type UpdateBillingInvoiceSettingsInput struct {
	Header BillingInvoiceHeader `json:"header"`
}

type billingInvoiceSettingsRow struct {
	ID                  int64     `db:"id"`
	SellerName          string    `db:"seller_name"`
	Subtitle            string    `db:"subtitle"`
	RemitTo             string    `db:"remit_to"`
	Terms               string    `db:"terms"`
	PaymentDueDays      int       `db:"payment_due_days"`
	PaymentInstructions string    `db:"payment_instructions"`
	UpdatedByUserID     int64     `db:"updated_by_user_id"`
	CreatedAt           time.Time `db:"created_at"`
	UpdatedAt           time.Time `db:"updated_at"`
}

func (s *Store) GetBillingInvoiceSettings(ctx context.Context) (BillingInvoiceSettings, error) {
	var row billingInvoiceSettingsRow
	err := s.db.GetContext(ctx, &row, `
		SELECT
			id,
			seller_name,
			subtitle,
			remit_to,
			terms,
			payment_due_days,
			payment_instructions,
			COALESCE(updated_by_user_id, 0) AS updated_by_user_id,
			created_at,
			updated_at
		FROM billing_invoice_settings
		WHERE id = ?
		LIMIT 1
	`, billingInvoiceSettingsID)
	if err != nil {
		if err == sql.ErrNoRows {
			return BillingInvoiceSettings{
				ID:     billingInvoiceSettingsID,
				Header: defaultBillingInvoiceHeader(),
			}, nil
		}
		return BillingInvoiceSettings{}, err
	}

	return billingInvoiceSettingsFromRow(row), nil
}

func (s *Store) UpdateBillingInvoiceSettings(ctx context.Context, input UpdateBillingInvoiceSettingsInput, updatedByUserID int64) (BillingInvoiceSettings, error) {
	header := normalizeBillingInvoiceHeader(input.Header)
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO billing_invoice_settings (
			id,
			seller_name,
			subtitle,
			remit_to,
			terms,
			payment_due_days,
			payment_instructions,
			updated_by_user_id
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			seller_name = VALUES(seller_name),
			subtitle = VALUES(subtitle),
			remit_to = VALUES(remit_to),
			terms = VALUES(terms),
			payment_due_days = VALUES(payment_due_days),
			payment_instructions = VALUES(payment_instructions),
			updated_by_user_id = VALUES(updated_by_user_id),
			updated_at = CURRENT_TIMESTAMP
	`,
		billingInvoiceSettingsID,
		header.SellerName,
		header.Subtitle,
		header.RemitTo,
		header.Terms,
		header.PaymentDueDays,
		header.PaymentInstructions,
		updatedByUserID,
	); err != nil {
		return BillingInvoiceSettings{}, err
	}

	return s.GetBillingInvoiceSettings(ctx)
}

func billingInvoiceSettingsFromRow(row billingInvoiceSettingsRow) BillingInvoiceSettings {
	return BillingInvoiceSettings{
		ID: row.ID,
		Header: BillingInvoiceHeader{
			SellerName:          row.SellerName,
			Subtitle:            row.Subtitle,
			RemitTo:             row.RemitTo,
			Terms:               row.Terms,
			PaymentDueDays:      row.PaymentDueDays,
			PaymentInstructions: row.PaymentInstructions,
		},
		UpdatedByUserID: row.UpdatedByUserID,
		CreatedAt:       row.CreatedAt,
		UpdatedAt:       row.UpdatedAt,
	}
}
