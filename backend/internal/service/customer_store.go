package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

func (s *Store) ListCustomers(ctx context.Context) ([]Customer, error) {
	customers := make([]Customer, 0)
	if err := s.db.SelectContext(ctx, &customers, `
		SELECT
			id,
			name,
			COALESCE(contact_name, '') AS contact_name,
			COALESCE(email, '') AS email,
			COALESCE(phone, '') AS phone,
			COALESCE(notes, '') AS notes,
			created_at,
			updated_at
		FROM customers
		ORDER BY name ASC
	`); err != nil {
		return nil, fmt.Errorf("load customers: %w", err)
	}

	return customers, nil
}

func (s *Store) CreateCustomer(ctx context.Context, input CreateCustomerInput) (Customer, error) {
	input = sanitizeCustomerInput(input)
	if err := validateCustomerInput(input); err != nil {
		return Customer{}, err
	}

	result, err := s.db.ExecContext(ctx, `
		INSERT INTO customers (name, contact_name, email, phone, notes)
		VALUES (?, ?, ?, ?, ?)
	`,
		input.Name,
		nullableString(input.ContactName),
		nullableString(input.Email),
		nullableString(input.Phone),
		nullableString(input.Notes),
	)
	if err != nil {
		return Customer{}, mapDBError(fmt.Errorf("create customer: %w", err))
	}

	customerID, err := result.LastInsertId()
	if err != nil {
		return Customer{}, fmt.Errorf("resolve customer id: %w", err)
	}

	return s.getCustomer(ctx, customerID)
}

func (s *Store) UpdateCustomer(ctx context.Context, customerID int64, input CreateCustomerInput) (Customer, error) {
	input = sanitizeCustomerInput(input)
	if err := validateCustomerInput(input); err != nil {
		return Customer{}, err
	}

	result, err := s.db.ExecContext(ctx, `
		UPDATE customers
		SET
			name = ?,
			contact_name = ?,
			email = ?,
			phone = ?,
			notes = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`,
		input.Name,
		nullableString(input.ContactName),
		nullableString(input.Email),
		nullableString(input.Phone),
		nullableString(input.Notes),
		customerID,
	)
	if err != nil {
		return Customer{}, mapDBError(fmt.Errorf("update customer: %w", err))
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return Customer{}, fmt.Errorf("resolve updated customer rows: %w", err)
	}
	if rowsAffected == 0 {
		return Customer{}, ErrNotFound
	}

	return s.getCustomer(ctx, customerID)
}

func (s *Store) DeleteCustomer(ctx context.Context, customerID int64) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM customers WHERE id = ?`, customerID)
	if err != nil {
		return mapDBError(fmt.Errorf("delete customer: %w", err))
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("resolve deleted customer rows: %w", err)
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}

	return nil
}

func (s *Store) getCustomer(ctx context.Context, customerID int64) (Customer, error) {
	var customer Customer
	if err := s.db.GetContext(ctx, &customer, `
		SELECT
			id,
			name,
			COALESCE(contact_name, '') AS contact_name,
			COALESCE(email, '') AS email,
			COALESCE(phone, '') AS phone,
			COALESCE(notes, '') AS notes,
			created_at,
			updated_at
		FROM customers
		WHERE id = ?
	`, customerID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Customer{}, ErrNotFound
		}
		return Customer{}, fmt.Errorf("load customer: %w", err)
	}

	return customer, nil
}

func sanitizeCustomerInput(input CreateCustomerInput) CreateCustomerInput {
	input.Name = strings.TrimSpace(input.Name)
	input.ContactName = strings.TrimSpace(input.ContactName)
	input.Email = strings.TrimSpace(strings.ToLower(input.Email))
	input.Phone = strings.TrimSpace(input.Phone)
	input.Notes = strings.TrimSpace(input.Notes)
	return input
}

func validateCustomerInput(input CreateCustomerInput) error {
	switch {
	case input.Name == "":
		return fmt.Errorf("%w: customer name is required", ErrInvalidInput)
	default:
		return nil
	}
}
