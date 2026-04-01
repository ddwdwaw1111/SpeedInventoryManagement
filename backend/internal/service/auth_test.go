package service

import (
	"errors"
	"testing"
)

func TestVerifyPasswordSupportsBcryptAndLegacy(t *testing.T) {
	t.Run("verifies bcrypt hashes", func(t *testing.T) {
		hash, err := hashPasswordBcrypt("password123")
		if err != nil {
			t.Fatalf("hashPasswordBcrypt returned error: %v", err)
		}
		if !isBcryptHash(hash) {
			t.Fatalf("expected bcrypt hash, got %q", hash)
		}
		if !verifyPassword("password123", hash, "") {
			t.Fatal("expected bcrypt password verification to succeed")
		}
		if verifyPassword("wrong-password", hash, "") {
			t.Fatal("expected bcrypt password verification to fail for wrong password")
		}
	})

	t.Run("verifies legacy hashes", func(t *testing.T) {
		salt := "0123456789abcdef0123456789abcdef"
		hash := hashPasswordLegacy("password123", salt)
		if !verifyPassword("password123", hash, salt) {
			t.Fatal("expected legacy password verification to succeed")
		}
		if verifyPassword("wrong-password", hash, salt) {
			t.Fatal("expected legacy password verification to fail for wrong password")
		}
	})
}

func TestSanitizeAuthInput(t *testing.T) {
	t.Run("sanitizes valid input", func(t *testing.T) {
		input, err := sanitizeAuthInput("  USER@Example.com ", "  Jane Doe  ", "  password123  ")
		if err != nil {
			t.Fatalf("sanitizeAuthInput returned error: %v", err)
		}

		if input.Email != "user@example.com" {
			t.Fatalf("expected normalized email, got %q", input.Email)
		}
		if input.FullName != "Jane Doe" {
			t.Fatalf("expected trimmed full name, got %q", input.FullName)
		}
		if input.Password != "password123" {
			t.Fatalf("expected trimmed password, got %q", input.Password)
		}
	})

	t.Run("rejects invalid input", func(t *testing.T) {
		testCases := []struct {
			name     string
			email    string
			fullName string
			password string
		}{
			{name: "missing full name", email: "user@example.com", password: "password123"},
			{name: "missing email", fullName: "Jane Doe", password: "password123"},
			{name: "invalid email", email: "user-example.com", fullName: "Jane Doe", password: "password123"},
			{name: "short password", email: "user@example.com", fullName: "Jane Doe", password: "short"},
		}

		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				_, err := sanitizeAuthInput(tc.email, tc.fullName, tc.password)
				if err == nil {
					t.Fatal("expected validation error")
				}
				if !errors.Is(err, ErrInvalidInput) {
					t.Fatalf("expected ErrInvalidInput, got %v", err)
				}
			})
		}
	})
}

func TestNormalizeUserRole(t *testing.T) {
	t.Run("normalizes supported roles", func(t *testing.T) {
		testCases := map[string]string{
			" ADMIN ":   RoleAdmin,
			"operator":  RoleOperator,
			"Viewer  ":  RoleViewer,
		}

		for input, want := range testCases {
			got, err := normalizeUserRole(input)
			if err != nil {
				t.Fatalf("normalizeUserRole(%q) returned error: %v", input, err)
			}
			if got != want {
				t.Fatalf("normalizeUserRole(%q) = %q, want %q", input, got, want)
			}
		}
	})

	t.Run("rejects unsupported roles", func(t *testing.T) {
		_, err := normalizeUserRole("owner")
		if err == nil {
			t.Fatal("expected validation error")
		}
		if !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("expected ErrInvalidInput, got %v", err)
		}
	})
}

func TestSanitizeManagedUserInput(t *testing.T) {
	input, err := sanitizeManagedUserInput(CreateManagedUserInput{
		Email:    "  USER@Example.com ",
		FullName: "  Jane Doe  ",
		Password: "  password123  ",
		Role:     " Viewer ",
		IsActive: true,
	})
	if err != nil {
		t.Fatalf("sanitizeManagedUserInput returned error: %v", err)
	}

	if input.Email != "user@example.com" {
		t.Fatalf("expected normalized email, got %q", input.Email)
	}
	if input.FullName != "Jane Doe" {
		t.Fatalf("expected trimmed full name, got %q", input.FullName)
	}
	if input.Password != "password123" {
		t.Fatalf("expected trimmed password, got %q", input.Password)
	}
	if input.Role != RoleViewer {
		t.Fatalf("expected normalized role %q, got %q", RoleViewer, input.Role)
	}
	if !input.IsActive {
		t.Fatal("expected active flag to be preserved")
	}
}
