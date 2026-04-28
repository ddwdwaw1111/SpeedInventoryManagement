package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const sessionTTL = 30 * 24 * time.Hour

const (
	RoleAdmin    = "admin"
	RoleOperator = "operator"
	RoleViewer   = "viewer"
)

type User struct {
	ID        int64     `db:"id" json:"id"`
	Email     string    `db:"email" json:"email"`
	FullName  string    `db:"full_name" json:"fullName"`
	Role      string    `db:"role" json:"role"`
	IsActive  bool      `db:"is_active" json:"isActive"`
	CreatedAt time.Time `db:"created_at" json:"createdAt"`
}

type userCredentialRow struct {
	ID           int64     `db:"id"`
	Email        string    `db:"email"`
	FullName     string    `db:"full_name"`
	Role         string    `db:"role"`
	IsActive     bool      `db:"is_active"`
	PasswordSalt string    `db:"password_salt"`
	PasswordHash string    `db:"password_hash"`
	CreatedAt    time.Time `db:"created_at"`
}

func (row userCredentialRow) toUser() User {
	return User{
		ID:        row.ID,
		Email:     row.Email,
		FullName:  row.FullName,
		Role:      row.Role,
		IsActive:  row.IsActive,
		CreatedAt: row.CreatedAt,
	}
}

type sessionUserRow struct {
	ID        int64     `db:"id"`
	Email     string    `db:"email"`
	FullName  string    `db:"full_name"`
	Role      string    `db:"role"`
	IsActive  bool      `db:"is_active"`
	CreatedAt time.Time `db:"created_at"`
	ExpiresAt time.Time `db:"expires_at"`
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

	passwordHash, err := hashPasswordBcrypt(input.Password)
	if err != nil {
		return AuthPayload{}, "", fmt.Errorf("hash password: %w", err)
	}
	role, err := s.resolveNewUserRole(ctx)
	if err != nil {
		return AuthPayload{}, "", err
	}

	user, err := s.createUserRecord(ctx, input.Email, input.FullName, passwordHash, "", role, true)
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

	var row userCredentialRow
	err := s.db.GetContext(ctx, &row, `
		SELECT id, email, full_name, role, is_active, password_salt, password_hash, created_at
		FROM users
		WHERE email = ?
	`, email)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return AuthPayload{}, "", fmt.Errorf("%w: invalid email or password", ErrInvalidInput)
		}
		return AuthPayload{}, "", fmt.Errorf("load user for login: %w", err)
	}

	if !verifyPassword(password, row.PasswordHash, row.PasswordSalt) {
		return AuthPayload{}, "", fmt.Errorf("%w: invalid email or password", ErrInvalidInput)
	}
	if !row.IsActive {
		return AuthPayload{}, "", fmt.Errorf("%w: this account is inactive", ErrInvalidInput)
	}

	// Transparently upgrade legacy SHA256 hash to bcrypt on successful login.
	if !isBcryptHash(row.PasswordHash) {
		go s.upgradePasswordHash(row.ID, password)
	}

	return s.createSession(ctx, row.toUser())
}

func (s *Store) GetUserBySessionToken(ctx context.Context, token string) (AuthPayload, error) {
	tokenHash := hashToken(token)
	if tokenHash == "" {
		return AuthPayload{}, fmt.Errorf("%w: missing session token", ErrInvalidInput)
	}

	var row sessionUserRow
	err := s.db.GetContext(ctx, &row, `
		SELECT u.id, u.email, u.full_name, u.role, u.is_active, u.created_at, us.expires_at
		FROM user_sessions us
		JOIN users u ON u.id = us.user_id
		WHERE us.token_hash = ? AND us.expires_at > CURRENT_TIMESTAMP AND u.is_active = TRUE
	`, tokenHash)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return AuthPayload{}, ErrNotFound
		}
		return AuthPayload{}, fmt.Errorf("load session: %w", err)
	}

	return AuthPayload{
		User: User{
			ID:        row.ID,
			Email:     row.Email,
			FullName:  row.FullName,
			Role:      row.Role,
			IsActive:  row.IsActive,
			CreatedAt: row.CreatedAt,
		},
		ExpiresAt: row.ExpiresAt,
	}, nil
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
	err := s.db.GetContext(ctx, &user, `
		SELECT id, email, full_name, role, is_active, created_at
		FROM users
		WHERE id = ?
	`, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return User{}, ErrNotFound
		}
		return User{}, fmt.Errorf("load user: %w", err)
	}

	return user, nil
}

func (s *Store) createUserRecord(ctx context.Context, email string, fullName string, passwordHash string, salt string, role string, isActive bool) (User, error) {
	result, err := s.db.ExecContext(ctx, `
		INSERT INTO users (email, full_name, role, is_active, password_salt, password_hash)
		VALUES (?, ?, ?, ?, ?, ?)
	`, email, fullName, role, isActive, salt, passwordHash)
	if err != nil {
		return User{}, mapDBError(fmt.Errorf("create user: %w", err))
	}

	userID, err := result.LastInsertId()
	if err != nil {
		return User{}, fmt.Errorf("resolve user id: %w", err)
	}

	return s.getUser(ctx, userID)
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

func (s *Store) resolveNewUserRole(ctx context.Context) (string, error) {
	var userCount int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&userCount); err != nil {
		return "", fmt.Errorf("count users: %w", err)
	}

	if userCount == 0 {
		return RoleAdmin, nil
	}

	return RoleOperator, nil
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

// hashPasswordBcrypt creates a new bcrypt hash (cost 12).
func hashPasswordBcrypt(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return "", fmt.Errorf("bcrypt hash: %w", err)
	}
	return string(hash), nil
}

// isBcryptHash returns true if the stored hash is a bcrypt hash.
func isBcryptHash(hash string) bool {
	return strings.HasPrefix(hash, "$2a$") || strings.HasPrefix(hash, "$2b$")
}

// verifyPassword checks the password against bcrypt or legacy SHA256 hash.
func verifyPassword(password, storedHash, salt string) bool {
	if isBcryptHash(storedHash) {
		return bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(password)) == nil
	}
	return hashPasswordLegacy(password, salt) == storedHash
}

// hashPasswordLegacy is the old SHA256-iterated scheme, kept for verifying existing passwords.
func hashPasswordLegacy(password, salt string) string {
	sum := sha256.Sum256([]byte(salt + ":" + password))
	block := sum[:]
	for range 120000 {
		next := sha256.Sum256(block)
		block = next[:]
	}
	return hex.EncodeToString(block)
}

// upgradePasswordHash transparently re-hashes a legacy password to bcrypt.
func (s *Store) upgradePasswordHash(userID int64, plainPassword string) {
	newHash, err := hashPasswordBcrypt(plainPassword)
	if err != nil {
		log.Printf("[WARN] failed to generate bcrypt hash for user %d: %v", userID, err)
		return
	}
	if _, err := s.db.Exec(`
		UPDATE users SET password_hash = ?, password_salt = '' WHERE id = ?
	`, newHash, userID); err != nil {
		log.Printf("[WARN] failed to upgrade password hash for user %d: %v", userID, err)
	}
}

func hashToken(token string) string {
	token = strings.TrimSpace(token)
	if token == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
