package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

const sessionTTL = 7 * 24 * time.Hour

type User struct {
	ID        int64     `json:"id"`
	Email     string    `json:"email"`
	FullName  string    `json:"fullName"`
	CreatedAt time.Time `json:"createdAt"`
}

type AuthPayload struct {
	User      User      `json:"user"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type RegisterUserInput struct {
	Email    string `json:"email"`
	FullName string `json:"fullName"`
	Password string `json:"password"`
}

type LoginInput struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (s *Store) RegisterUser(ctx context.Context, input RegisterUserInput) (AuthPayload, string, error) {
	input, err := sanitizeAuthInput(input.Email, input.FullName, input.Password)
	if err != nil {
		return AuthPayload{}, "", err
	}

	salt, err := randomHex(16)
	if err != nil {
		return AuthPayload{}, "", fmt.Errorf("generate password salt: %w", err)
	}
	passwordHash := hashPassword(input.Password, salt)

	result, err := s.db.ExecContext(ctx, `
		INSERT INTO users (email, full_name, password_salt, password_hash)
		VALUES (?, ?, ?, ?)
	`, input.Email, input.FullName, salt, passwordHash)
	if err != nil {
		return AuthPayload{}, "", mapDBError(fmt.Errorf("create user: %w", err))
	}

	userID, err := result.LastInsertId()
	if err != nil {
		return AuthPayload{}, "", fmt.Errorf("resolve user id: %w", err)
	}

	user, err := s.getUser(ctx, userID)
	if err != nil {
		return AuthPayload{}, "", err
	}

	return s.createSession(ctx, user)
}

func (s *Store) Login(ctx context.Context, input LoginInput) (AuthPayload, string, error) {
	email := strings.TrimSpace(strings.ToLower(input.Email))
	password := strings.TrimSpace(input.Password)
	if email == "" || password == "" {
		return AuthPayload{}, "", fmt.Errorf("%w: email and password are required", ErrInvalidInput)
	}

	var user User
	var salt string
	var passwordHash string
	err := s.db.QueryRowContext(ctx, `
		SELECT id, email, full_name, password_salt, password_hash, created_at
		FROM users
		WHERE email = ?
	`, email).Scan(
		&user.ID,
		&user.Email,
		&user.FullName,
		&salt,
		&passwordHash,
		&user.CreatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return AuthPayload{}, "", fmt.Errorf("%w: invalid email or password", ErrInvalidInput)
		}
		return AuthPayload{}, "", fmt.Errorf("load user for login: %w", err)
	}

	if hashPassword(password, salt) != passwordHash {
		return AuthPayload{}, "", fmt.Errorf("%w: invalid email or password", ErrInvalidInput)
	}

	return s.createSession(ctx, user)
}

func (s *Store) GetUserBySessionToken(ctx context.Context, token string) (AuthPayload, error) {
	tokenHash := hashToken(token)
	if tokenHash == "" {
		return AuthPayload{}, fmt.Errorf("%w: missing session token", ErrInvalidInput)
	}

	var payload AuthPayload
	err := s.db.QueryRowContext(ctx, `
		SELECT u.id, u.email, u.full_name, u.created_at, us.expires_at
		FROM user_sessions us
		JOIN users u ON u.id = us.user_id
		WHERE us.token_hash = ? AND us.expires_at > CURRENT_TIMESTAMP
	`, tokenHash).Scan(
		&payload.User.ID,
		&payload.User.Email,
		&payload.User.FullName,
		&payload.User.CreatedAt,
		&payload.ExpiresAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return AuthPayload{}, ErrNotFound
		}
		return AuthPayload{}, fmt.Errorf("load session: %w", err)
	}

	return payload, nil
}

func (s *Store) Logout(ctx context.Context, token string) error {
	tokenHash := hashToken(token)
	if tokenHash == "" {
		return nil
	}

	if _, err := s.db.ExecContext(ctx, `DELETE FROM user_sessions WHERE token_hash = ?`, tokenHash); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}

	return nil
}

func (s *Store) createSession(ctx context.Context, user User) (AuthPayload, string, error) {
	token, err := randomToken(32)
	if err != nil {
		return AuthPayload{}, "", fmt.Errorf("generate session token: %w", err)
	}

	expiresAt := time.Now().UTC().Add(sessionTTL)
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO user_sessions (user_id, token_hash, expires_at)
		VALUES (?, ?, ?)
	`, user.ID, hashToken(token), expiresAt); err != nil {
		return AuthPayload{}, "", fmt.Errorf("create session: %w", err)
	}

	return AuthPayload{
		User:      user,
		ExpiresAt: expiresAt,
	}, token, nil
}

func (s *Store) getUser(ctx context.Context, userID int64) (User, error) {
	var user User
	err := s.db.QueryRowContext(ctx, `
		SELECT id, email, full_name, created_at
		FROM users
		WHERE id = ?
	`, userID).Scan(&user.ID, &user.Email, &user.FullName, &user.CreatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return User{}, ErrNotFound
		}
		return User{}, fmt.Errorf("load user: %w", err)
	}

	return user, nil
}

func sanitizeAuthInput(email, fullName, password string) (RegisterUserInput, error) {
	sanitized := RegisterUserInput{
		Email:    strings.TrimSpace(strings.ToLower(email)),
		FullName: strings.TrimSpace(fullName),
		Password: strings.TrimSpace(password),
	}

	switch {
	case sanitized.FullName == "":
		return RegisterUserInput{}, fmt.Errorf("%w: full name is required", ErrInvalidInput)
	case sanitized.Email == "":
		return RegisterUserInput{}, fmt.Errorf("%w: email is required", ErrInvalidInput)
	case !strings.Contains(sanitized.Email, "@"):
		return RegisterUserInput{}, fmt.Errorf("%w: email must be valid", ErrInvalidInput)
	case len(sanitized.Password) < 8:
		return RegisterUserInput{}, fmt.Errorf("%w: password must be at least 8 characters", ErrInvalidInput)
	default:
		return sanitized, nil
	}
}

func randomHex(size int) (string, error) {
	bytes := make([]byte, size)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}

	return hex.EncodeToString(bytes), nil
}

func randomToken(size int) (string, error) {
	return randomHex(size)
}

func hashPassword(password, salt string) string {
	sum := sha256.Sum256([]byte(salt + ":" + password))
	block := sum[:]
	for range 120000 {
		next := sha256.Sum256(block)
		block = next[:]
	}
	return hex.EncodeToString(block)
}

func hashToken(token string) string {
	token = strings.TrimSpace(token)
	if token == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
