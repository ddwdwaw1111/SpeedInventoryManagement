package service

import (
	"context"
	"errors"
	"fmt"
	"testing"

	mysql "github.com/go-sql-driver/mysql"
)

func TestRetryInventoryTransferTransactionRetriesDeadlock(t *testing.T) {
	attempts := 0
	transfer, err := retryInventoryTransferTransaction(context.Background(), func() (InventoryTransfer, error) {
		attempts++
		if attempts < inventoryTransferTransactionAttempts {
			return InventoryTransfer{}, fmt.Errorf("post transfer: %w", &mysql.MySQLError{Number: 1213, Message: "deadlock found"})
		}
		return InventoryTransfer{ID: 42}, nil
	})
	if err != nil {
		t.Fatalf("retry deadlocked transfer: %v", err)
	}
	if attempts != inventoryTransferTransactionAttempts {
		t.Fatalf("expected %d attempts, got %d", inventoryTransferTransactionAttempts, attempts)
	}
	if transfer.ID != 42 {
		t.Fatalf("expected successful transfer after retry, got %+v", transfer)
	}
}

func TestRetryInventoryTransferTransactionDoesNotRetryDomainError(t *testing.T) {
	attempts := 0
	_, err := retryInventoryTransferTransaction(context.Background(), func() (InventoryTransfer, error) {
		attempts++
		return InventoryTransfer{}, ErrInsufficientStock
	})
	if !errors.Is(err, ErrInsufficientStock) {
		t.Fatalf("expected insufficient stock error, got %v", err)
	}
	if attempts != 1 {
		t.Fatalf("expected one attempt for a domain error, got %d", attempts)
	}
}

func TestRetryInventoryTransferTransactionStopsWhenContextIsCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	attempts := 0
	_, err := retryInventoryTransferTransaction(ctx, func() (InventoryTransfer, error) {
		attempts++
		cancel()
		return InventoryTransfer{}, &mysql.MySQLError{Number: 1213, Message: "deadlock found"}
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation, got %v", err)
	}
	if attempts != 1 {
		t.Fatalf("expected cancellation before a second attempt, got %d attempts", attempts)
	}
}
