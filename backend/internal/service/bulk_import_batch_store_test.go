package service

import (
	"bytes"
	"context"
	"errors"
	"testing"
)

func TestCleanBulkImportFileName(t *testing.T) {
	t.Parallel()

	if actual := cleanBulkImportFileName(` C:\uploads\receipts.xlsx `); actual != "receipts.xlsx" {
		t.Fatalf("cleanBulkImportFileName() = %q, want receipts.xlsx", actual)
	}
}

func TestBulkImportBatchCanAttemptCommit(t *testing.T) {
	t.Parallel()
	if !bulkImportBatchCanAttemptCommit(BulkImportStatusPreviewed) {
		t.Fatal("previewed batch should be committable")
	}
	if !bulkImportBatchCanAttemptCommit(BulkImportStatusCommitting) {
		t.Fatal("committing batch should reach the database lease check")
	}
	if bulkImportBatchCanAttemptCommit(BulkImportStatusCompleted) {
		t.Fatal("completed batch must not be committable")
	}
}

func TestValidateUniqueBulkImportCommitRecordsRejectsCaseInsensitiveDuplicates(t *testing.T) {
	t.Parallel()
	err := validateUniqueBulkImportCommitRecords([]BulkImportCommitRecord{
		{DocumentKey: "Receipt-1"},
		{DocumentKey: " receipt-1 "},
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("duplicate commit record error = %v, want invalid input", err)
	}
}

func TestBulkImportBatchRetentionIntegration(t *testing.T) {
	store := newIntegrationStore(t)
	ctx := context.Background()
	suffix := integrationSuffix()

	auth, _, err := store.RegisterUser(ctx, RegisterUserInput{
		Email:    "bulk-import-" + suffix + "@example.com",
		FullName: "Bulk Import Tester",
		Password: "Password123!",
	})
	if err != nil {
		t.Fatalf("register import user: %v", err)
	}
	customer := mustCreateCustomer(t, ctx, store, "Bulk Import Customer "+suffix)
	original := []byte("original-xlsx-bytes")

	batch, err := store.CreateBulkImportBatch(ctx, CreateBulkImportBatchInput{
		ImportType:      BulkImportTypeInbound,
		CustomerID:      customer.ID,
		SourceFileName:  `C:\uploads\receipts.xlsx`,
		Data:            original,
		CreatedByUserID: auth.User.ID,
		CreatedByName:   auth.User.FullName,
		CreatedByEmail:  auth.User.Email,
	})
	if err != nil {
		t.Fatalf("create retained import batch: %v", err)
	}
	if batch.SourceFileName != "receipts.xlsx" || batch.Status != BulkImportStatusUploaded {
		t.Fatalf("unexpected retained batch: %+v", batch)
	}

	if err := store.MarkBulkImportBatchPreview(ctx, batch.ImportID, BulkImportTypeInbound, customer.ID, BulkImportPreviewSummary{
		TotalDocuments: 2, ValidDocuments: 1, InvalidDocuments: 1, TotalLines: 3,
	}, nil); err != nil {
		t.Fatalf("record preview: %v", err)
	}
	if _, err := store.MarkBulkImportBatchCommitting(ctx, batch.ImportID, BulkImportTypeInbound, customer.ID); err != nil {
		t.Fatalf("mark committing: %v", err)
	}
	if _, err := store.MarkBulkImportBatchCommitting(ctx, batch.ImportID, BulkImportTypeInbound, customer.ID); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("second commit lock error = %v, want invalid input", err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE bulk_import_batches SET updated_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 31 MINUTE) WHERE id = ?`, batch.ID); err != nil {
		t.Fatalf("expire committing lease: %v", err)
	}
	if _, err := store.MarkBulkImportBatchCommitting(ctx, batch.ImportID, BulkImportTypeInbound, customer.ID); err != nil {
		t.Fatalf("recover expired committing batch: %v", err)
	}
	atomicRecord := BulkImportCommitRecord{DocumentKey: "receipt-1", DocumentID: 101, ReferenceCode: "CONT-001", Success: true}
	if err := store.RecordBulkImportBatchDocument(ctx, batch.ID, atomicRecord); err != nil {
		t.Fatalf("record committed document provenance: %v", err)
	}
	if err := store.RecordBulkImportBatchDocument(ctx, batch.ID, atomicRecord); err != nil {
		t.Fatalf("record idempotent document provenance: %v", err)
	}
	conflictingRecord := atomicRecord
	conflictingRecord.ReferenceCode = "CONT-DIFFERENT"
	if err := store.RecordBulkImportBatchDocument(ctx, batch.ID, conflictingRecord); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("conflicting document provenance error = %v, want invalid input", err)
	}
	if err := store.CompleteBulkImportBatch(ctx, CompleteBulkImportBatchInput{
		ImportID: batch.ImportID, ImportType: BulkImportTypeInbound, CustomerID: customer.ID,
		CreatedDocuments: 1, FailedDocuments: 1,
		Results: []BulkImportCommitRecord{
			{DocumentKey: "receipt-1", DocumentID: 101, ReferenceCode: "CONT-001", Success: true},
			{DocumentKey: "receipt-2", ReferenceCode: "CONT-002", ErrorMessage: "invalid row"},
		},
	}); err != nil {
		t.Fatalf("complete retained import: %v", err)
	}

	batches, err := store.ListBulkImportBatches(ctx, BulkImportTypeInbound, customer.ID, 0, 10)
	if err != nil {
		t.Fatalf("list retained imports: %v", err)
	}
	if len(batches) != 1 || batches[0].Status != BulkImportStatusPartial || len(batches[0].Documents) != 2 {
		t.Fatalf("unexpected retained import history: %+v", batches)
	}
	if err := store.MarkBulkImportBatchPreview(ctx, batch.ImportID, BulkImportTypeInbound, customer.ID, BulkImportPreviewSummary{}, nil); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("revalidate completed retained import error = %v, want invalid input", err)
	}
	file, err := store.GetBulkImportBatchFile(ctx, batch.ID)
	if err != nil {
		t.Fatalf("load original import file: %v", err)
	}
	if file.SourceFileName != "receipts.xlsx" || !bytes.Equal(file.Data, original) {
		t.Fatalf("unexpected retained original file: name=%q data=%q", file.SourceFileName, file.Data)
	}

	failedBatch, err := store.CreateBulkImportBatch(ctx, CreateBulkImportBatchInput{
		ImportType:      BulkImportTypeInbound,
		CustomerID:      customer.ID,
		SourceFileName:  "retry.xlsx",
		Data:            original,
		CreatedByUserID: auth.User.ID,
		CreatedByName:   auth.User.FullName,
		CreatedByEmail:  auth.User.Email,
	})
	if err != nil {
		t.Fatalf("create failed retained batch: %v", err)
	}
	if err := store.MarkBulkImportBatchPreview(ctx, failedBatch.ImportID, BulkImportTypeInbound, customer.ID, BulkImportPreviewSummary{TotalDocuments: 1, InvalidDocuments: 1}, nil); err != nil {
		t.Fatalf("preview failed retained batch: %v", err)
	}
	if _, err := store.MarkBulkImportBatchCommitting(ctx, failedBatch.ImportID, BulkImportTypeInbound, customer.ID); err != nil {
		t.Fatalf("commit failed retained batch: %v", err)
	}
	if err := store.CompleteBulkImportBatch(ctx, CompleteBulkImportBatchInput{
		ImportID: failedBatch.ImportID, ImportType: BulkImportTypeInbound, CustomerID: customer.ID,
		FailedDocuments: 1,
		Results:         []BulkImportCommitRecord{{DocumentKey: "failed-1", ErrorMessage: "invalid row"}},
	}); err != nil {
		t.Fatalf("finalize failed retained batch: %v", err)
	}
	if err := store.MarkBulkImportBatchPreview(ctx, failedBatch.ImportID, BulkImportTypeInbound, customer.ID, BulkImportPreviewSummary{TotalDocuments: 1, ValidDocuments: 1}, nil); err != nil {
		t.Fatalf("revalidate failed retained batch: %v", err)
	}
	batches, err = store.ListBulkImportBatches(ctx, BulkImportTypeInbound, customer.ID, 0, 10)
	if err != nil {
		t.Fatalf("list revalidated import: %v", err)
	}
	var revalidated *BulkImportBatch
	for index := range batches {
		if batches[index].ID == failedBatch.ID {
			revalidated = &batches[index]
			break
		}
	}
	if revalidated == nil {
		t.Fatalf("revalidated batch %d was not returned", failedBatch.ID)
	}
	if revalidated.Status != BulkImportStatusPreviewed || revalidated.CreatedDocuments != 0 || revalidated.FailedDocuments != 0 || revalidated.CommittedAt != nil || len(revalidated.Documents) != 0 {
		t.Fatalf("revalidation retained stale commit results: %+v", *revalidated)
	}
}
