package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jmoiron/sqlx"
)

type CreateManagedUserInput struct {
	Email    string `json:"email"`
	FullName string `json:"fullName"`
	Password string `json:"password"`
	Role     string `json:"role"`
	IsActive bool   `json:"isActive"`
}

type UpdateUserAccessInput struct {
	Role     string `json:"role"`
	IsActive bool   `json:"isActive"`
}

func (s *Store) CanSelfRegister(ctx context.Context) (bool, error) {
	var userCount int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&userCount); err != nil {
		return false, fmt.Errorf("count users: %w", err)
	}

	return userCount == 0, nil
}

func (s *Store) ListUsers(ctx context.Context) ([]User, error) {
	users := []User{}
	if err := s.db.SelectContext(ctx, &users, `
		SELECT id, email, full_name, role, is_active, created_at
		FROM users
		ORDER BY created_at DESC, id DESC
	`); err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}

	return users, nil
}

func (s *Store) CreateManagedUser(ctx context.Context, input CreateManagedUserInput) (User, error) {
	input, err := sanitizeManagedUserInput(input)
	if err != nil {
		return User{}, err
	}

	passwordHash, err := hashPasswordBcrypt(input.Password)
	if err != nil {
		return User{}, fmt.Errorf("hash password: %w", err)
	}

	return s.createUserRecord(ctx, input.Email, input.FullName, passwordHash, "", input.Role, input.IsActive)
}

func (s *Store) UpdateUserAccess(ctx context.Context, actorUserID int64, userID int64, input UpdateUserAccessInput) (User, error) {
	input, err := sanitizeUserAccessInput(input)
	if err != nil {
		return User{}, err
	}

	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return User{}, fmt.Errorf("begin user access update: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	targetUser, err := getUserForAccessUpdate(ctx, tx, userID)
	if err != nil {
		return User{}, err
	}

	if actorUserID == userID {
		if !input.IsActive {
			return User{}, fmt.Errorf("%w: you cannot deactivate your own account", ErrInvalidInput)
		}
		if targetUser.Role == RoleAdmin && input.Role != RoleAdmin {
			return User{}, fmt.Errorf("%w: you cannot remove your own admin role", ErrInvalidInput)
		}
	}

	if targetUser.Role == RoleAdmin && (input.Role != RoleAdmin || !input.IsActive) {
		activeAdminCount, err := countActiveAdmins(ctx, tx)
		if err != nil {
			return User{}, err
		}
		if targetUser.IsActive && activeAdminCount <= 1 {
			return User{}, fmt.Errorf("%w: at least one active admin is required", ErrInvalidInput)
		}
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE users
		SET role = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, input.Role, input.IsActive, userID); err != nil {
		return User{}, mapDBError(fmt.Errorf("update user access: %w", err))
	}

	if !input.IsActive {
		if _, err := tx.ExecContext(ctx, `DELETE FROM user_sessions WHERE user_id = ?`, userID); err != nil {
			return User{}, fmt.Errorf("delete inactive user sessions: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return User{}, fmt.Errorf("commit user access update: %w", err)
	}

	return s.getUser(ctx, userID)
}

func sanitizeManagedUserInput(input CreateManagedUserInput) (CreateManagedUserInput, error) {
	registerInput, err := sanitizeAuthInput(input.Email, input.FullName, input.Password)
	if err != nil {
		return CreateManagedUserInput{}, err
	}

	role, err := normalizeUserRole(input.Role)
	if err != nil {
		return CreateManagedUserInput{}, err
	}

	return CreateManagedUserInput{
		Email:    registerInput.Email,
		FullName: registerInput.FullName,
		Password: registerInput.Password,
		Role:     role,
		IsActive: input.IsActive,
	}, nil
}

func sanitizeUserAccessInput(input UpdateUserAccessInput) (UpdateUserAccessInput, error) {
	role, err := normalizeUserRole(input.Role)
	if err != nil {
		return UpdateUserAccessInput{}, err
	}

	return UpdateUserAccessInput{
		Role:     role,
		IsActive: input.IsActive,
	}, nil
}

func normalizeUserRole(role string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case RoleAdmin:
		return RoleAdmin, nil
	case RoleOperator:
		return RoleOperator, nil
	case RoleViewer:
		return RoleViewer, nil
	default:
		return "", fmt.Errorf("%w: role must be admin, operator, or viewer", ErrInvalidInput)
	}
}

func getUserForAccessUpdate(ctx context.Context, tx *sqlx.Tx, userID int64) (User, error) {
	var user User
	if err := tx.QueryRowContext(ctx, `
		SELECT id, email, full_name, role, is_active, created_at
		FROM users
		WHERE id = ?
		FOR UPDATE
	`, userID).Scan(&user.ID, &user.Email, &user.FullName, &user.Role, &user.IsActive, &user.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return User{}, ErrNotFound
		}
		return User{}, fmt.Errorf("load user for access update: %w", err)
	}

	return user, nil
}

func countActiveAdmins(ctx context.Context, tx *sqlx.Tx) (int, error) {
	var count int
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM users
		WHERE role = ? AND is_active = TRUE
	`, RoleAdmin).Scan(&count); err != nil {
		return 0, fmt.Errorf("count active admins: %w", err)
	}

	return count, nil
}
