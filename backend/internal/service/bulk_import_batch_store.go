package service

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

const (
	BulkImportTypeInbound  = "INBOUND"
	BulkImportTypeOutbound = "OUTBOUND"
	BulkImportTypeTransfer = "TRANSFER"

	BulkImportStatusUploaded      = "UPLOADED"
	BulkImportStatusPreviewed     = "PREVIEWED"
	BulkImportStatusPreviewFailed = "PREVIEW_FAILED"
	BulkImportStatusCommitting    = "COMMITTING"
	BulkImportStatusCompleted     = "COMPLETED"
	BulkImportStatusPartial       = "PARTIAL"
	BulkImportStatusFailed        = "FAILED"
)

type BulkImportBatch struct {
	ID               int64                     `db:"id" json:"id"`
	ImportID         string                    `db:"import_id" json:"importId"`
	ImportType       string                    `db:"import_type" json:"importType"`
	CustomerID       int64                     `db:"customer_id" json:"customerId"`
	CustomerName     string                    `db:"customer_name_snapshot" json:"customerName"`
	SourceFileName   string                    `db:"source_file_name" json:"sourceFileName"`
	ContentType      string                    `db:"content_type" json:"contentType"`
	FileSizeBytes    int64                     `db:"file_size_bytes" json:"fileSizeBytes"`
	FileSHA256       string                    `db:"file_sha256" json:"fileSha256"`
	Status           string                    `db:"status" json:"status"`
	TotalDocuments   int                       `db:"total_documents" json:"totalDocuments"`
	ValidDocuments   int                       `db:"valid_documents" json:"validDocuments"`
	InvalidDocuments int                       `db:"invalid_documents" json:"invalidDocuments"`
	TotalLines       int                       `db:"total_lines" json:"totalLines"`
	CreatedDocuments int                       `db:"created_documents" json:"createdDocuments"`
	FailedDocuments  int                       `db:"failed_documents" json:"failedDocuments"`
	ErrorMessage     string                    `db:"error_message" json:"errorMessage"`
	CreatedByUserID  int64                     `db:"created_by_user_id" json:"createdByUserId"`
	CreatedByName    string                    `db:"created_by_name_snapshot" json:"createdByName"`
	CreatedByEmail   string                    `db:"created_by_email_snapshot" json:"createdByEmail"`
	CommittedAt      *time.Time                `db:"committed_at" json:"committedAt"`
	CreatedAt        time.Time                 `db:"created_at" json:"createdAt"`
	UpdatedAt        time.Time                 `db:"updated_at" json:"updatedAt"`
	Documents        []BulkImportBatchDocument `json:"documents"`
}

type BulkImportBatchDocument struct {
	ID            int64     `db:"id" json:"id"`
	BatchID       int64     `db:"batch_id" json:"batchId"`
	DocumentKey   string    `db:"document_key" json:"documentKey"`
	DocumentID    int64     `db:"document_id" json:"documentId"`
	ReferenceCode string    `db:"reference_code" json:"referenceCode"`
	Status        string    `db:"status" json:"status"`
	ErrorMessage  string    `db:"error_message" json:"errorMessage"`
	CreatedAt     time.Time `db:"created_at" json:"createdAt"`
}

type BulkImportBatchFile struct {
	ID             int64
	SourceFileName string
	ContentType    string
	Data           []byte
}

type CreateBulkImportBatchInput struct {
	ImportType      string
	CustomerID      int64
	CustomerName    string
	SourceFileName  string
	ContentType     string
	Data            []byte
	CreatedByUserID int64
	CreatedByName   string
	CreatedByEmail  string
}

type BulkImportPreviewSummary struct {
	TotalDocuments   int
	ValidDocuments   int
	InvalidDocuments int
	TotalLines       int
}

type BulkImportCommitRecord struct {
	DocumentKey   string
	DocumentID    int64
	ReferenceCode string
	Success       bool
	ErrorMessage  string
}

type CompleteBulkImportBatchInput struct {
	ImportID         string
	ImportType       string
	CustomerID       int64
	CreatedDocuments int
	FailedDocuments  int
	Results          []BulkImportCommitRecord
}

func (s *Store) CreateBulkImportBatch(ctx context.Context, input CreateBulkImportBatchInput) (BulkImportBatch, error) {
	input.ImportType = normalizeBulkImportType(input.ImportType)
	input.SourceFileName = cleanBulkImportFileName(input.SourceFileName)
	input.ContentType = strings.TrimSpace(input.ContentType)
	if input.ContentType == "" {
		input.ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	}
	if input.ImportType == "" || input.CustomerID <= 0 || input.CreatedByUserID <= 0 {
		return BulkImportBatch{}, fmt.Errorf("%w: import type, customer, and importing user are required", ErrInvalidInput)
	}
	if input.SourceFileName == "" || len(input.Data) == 0 {
		return BulkImportBatch{}, fmt.Errorf("%w: original import file is required", ErrInvalidInput)
	}
	if len(input.Data) > MaxInboundBulkImportFileSize {
		return BulkImportBatch{}, fmt.Errorf("%w: import file exceeds the 10 MB limit", ErrInvalidInput)
	}
	if strings.TrimSpace(input.CustomerName) == "" {
		if err := s.db.QueryRowContext(ctx, `SELECT name FROM customers WHERE id = ?`, input.CustomerID).Scan(&input.CustomerName); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return BulkImportBatch{}, ErrNotFound
			}
			return BulkImportBatch{}, fmt.Errorf("load bulk import customer: %w", err)
		}
	}

	importID, err := newInboundBulkImportID()
	if err != nil {
		return BulkImportBatch{}, err
	}
	digest := sha256.Sum256(input.Data)
	result, err := s.db.ExecContext(ctx, `
		INSERT INTO bulk_import_batches (
			import_id,
			import_type,
			customer_id,
			customer_name_snapshot,
			source_file_name,
			content_type,
			file_size_bytes,
			file_sha256,
			original_file,
			status,
			created_by_user_id,
			created_by_name_snapshot,
			created_by_email_snapshot
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		importID,
		input.ImportType,
		input.CustomerID,
		strings.TrimSpace(input.CustomerName),
		input.SourceFileName,
		input.ContentType,
		len(input.Data),
		hex.EncodeToString(digest[:]),
		input.Data,
		BulkImportStatusUploaded,
		input.CreatedByUserID,
		strings.TrimSpace(input.CreatedByName),
		strings.TrimSpace(strings.ToLower(input.CreatedByEmail)),
	)
	if err != nil {
		return BulkImportBatch{}, mapDBError(fmt.Errorf("retain original bulk import file: %w", err))
	}
	batchID, err := result.LastInsertId()
	if err != nil {
		return BulkImportBatch{}, fmt.Errorf("resolve bulk import batch id: %w", err)
	}
	return s.getBulkImportBatch(ctx, batchID)
}

func (s *Store) MarkBulkImportBatchPreview(ctx context.Context, importID string, importType string, customerID int64, summary BulkImportPreviewSummary, previewErr error) error {
	batch, err := s.validateBulkImportBatch(ctx, importID, importType, customerID)
	if err != nil {
		return err
	}
	status := BulkImportStatusPreviewed
	errorMessage := ""
	if previewErr != nil {
		status = BulkImportStatusPreviewFailed
		errorMessage = previewErr.Error()
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin bulk import preview state transaction: %w", err)
	}
	defer tx.Rollback()
	var currentStatus string
	if err := tx.QueryRowContext(ctx, `
		SELECT status
		FROM bulk_import_batches
		WHERE id = ?
		FOR UPDATE
	`, batch.ID).Scan(&currentStatus); err != nil {
		return mapDBError(fmt.Errorf("lock bulk import preview state: %w", err))
	}
	if !bulkImportPreviewStateCanChange(currentStatus) {
		return fmt.Errorf("%w: retained import batch cannot be revalidated from status %s", ErrInvalidInput, currentStatus)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE bulk_import_batches
		SET
			status = ?,
			total_documents = ?,
			valid_documents = ?,
			invalid_documents = ?,
			total_lines = ?,
			created_documents = 0,
			failed_documents = 0,
			error_message = ?,
			committed_at = NULL,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, status, summary.TotalDocuments, summary.ValidDocuments, summary.InvalidDocuments, summary.TotalLines, nullableString(errorMessage), batch.ID); err != nil {
		return mapDBError(fmt.Errorf("record bulk import preview: %w", err))
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM bulk_import_batch_documents WHERE batch_id = ?`, batch.ID); err != nil {
		return mapDBError(fmt.Errorf("clear previous bulk import document results: %w", err))
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit bulk import preview state: %w", err)
	}
	return nil
}

func (s *Store) MarkBulkImportBatchCommitting(ctx context.Context, importID string, importType string, customerID int64) (BulkImportBatch, error) {
	batch, err := s.validateBulkImportBatch(ctx, importID, importType, customerID)
	if err != nil {
		return BulkImportBatch{}, err
	}
	if !bulkImportBatchCanAttemptCommit(batch.Status) {
		return BulkImportBatch{}, fmt.Errorf("%w: this retained import batch is not ready to commit (current status: %s)", ErrInvalidInput, batch.Status)
	}
	// Use the database clock for the lease comparison so application and
	// database timezone settings cannot make an active batch look stale.
	result, err := s.db.ExecContext(ctx, `
		UPDATE bulk_import_batches
		SET status = ?, error_message = NULL, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
			AND (
				status = ?
				OR (status = ? AND updated_at <= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 MINUTE))
			)
	`, BulkImportStatusCommitting, batch.ID, BulkImportStatusPreviewed, BulkImportStatusCommitting)
	if err != nil {
		return BulkImportBatch{}, mapDBError(fmt.Errorf("mark bulk import committing: %w", err))
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return BulkImportBatch{}, fmt.Errorf("verify bulk import commit lock: %w", err)
	}
	if rowsAffected != 1 {
		return BulkImportBatch{}, fmt.Errorf("%w: this retained import batch is already being committed", ErrInvalidInput)
	}
	batch.Status = BulkImportStatusCommitting
	batch.UpdatedAt = time.Now().UTC()
	return batch, nil
}

func (s *Store) MarkBulkImportBatchFailed(ctx context.Context, importID string, importType string, customerID int64, cause error) error {
	batch, err := s.validateBulkImportBatch(ctx, importID, importType, customerID)
	if err != nil {
		return err
	}
	errorMessage := "bulk import failed"
	if cause != nil {
		errorMessage = cause.Error()
	}
	result, err := s.db.ExecContext(ctx, `
		UPDATE bulk_import_batches
		SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ? AND status = ?
	`, BulkImportStatusFailed, errorMessage, batch.ID, BulkImportStatusCommitting)
	if err != nil {
		return mapDBError(fmt.Errorf("mark bulk import failed: %w", err))
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("verify bulk import failed state: %w", err)
	}
	if rowsAffected != 1 {
		return fmt.Errorf("%w: retained import batch cannot fail from status %s", ErrInvalidInput, batch.Status)
	}
	return nil
}

func (s *Store) CompleteBulkImportBatch(ctx context.Context, input CompleteBulkImportBatchInput) error {
	batch, err := s.validateBulkImportBatch(ctx, input.ImportID, input.ImportType, input.CustomerID)
	if err != nil {
		return err
	}
	status := BulkImportStatusCompleted
	if input.FailedDocuments > 0 && input.CreatedDocuments > 0 {
		status = BulkImportStatusPartial
	} else if input.FailedDocuments > 0 {
		status = BulkImportStatusFailed
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin bulk import result transaction: %w", err)
	}
	defer tx.Rollback()
	if err := completeBulkImportBatchTx(ctx, tx, batch.ID, status, input.CreatedDocuments, input.FailedDocuments, input.Results); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit bulk import result transaction: %w", err)
	}
	return nil
}

func (s *Store) RecordBulkImportBatchDocument(ctx context.Context, batchID int64, result BulkImportCommitRecord) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin bulk import document record transaction: %w", err)
	}
	defer tx.Rollback()
	if err := recordBulkImportBatchDocumentTx(ctx, tx, batchID, result); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit bulk import document record: %w", err)
	}
	return nil
}

func completeBulkImportBatchTx(ctx context.Context, tx *sql.Tx, batchID int64, status string, createdDocuments int, failedDocuments int, results []BulkImportCommitRecord) error {
	if batchID <= 0 {
		return fmt.Errorf("%w: retained import batch is required", ErrInvalidInput)
	}
	if err := validateUniqueBulkImportCommitRecords(results); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM bulk_import_batch_documents WHERE batch_id = ?`, batchID); err != nil {
		return mapDBError(fmt.Errorf("replace bulk import document records: %w", err))
	}
	for _, result := range results {
		if err := recordBulkImportBatchDocumentTx(ctx, tx, batchID, result); err != nil {
			return err
		}
	}
	now := time.Now().UTC()
	updateResult, err := tx.ExecContext(ctx, `
		UPDATE bulk_import_batches
		SET
			status = ?,
			created_documents = ?,
			failed_documents = ?,
			error_message = NULL,
			committed_at = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ? AND status = ?
	`, status, createdDocuments, failedDocuments, now, batchID, BulkImportStatusCommitting)
	if err != nil {
		return mapDBError(fmt.Errorf("complete bulk import batch: %w", err))
	}
	rowsAffected, err := updateResult.RowsAffected()
	if err != nil {
		return fmt.Errorf("verify completed bulk import state: %w", err)
	}
	if rowsAffected != 1 {
		return fmt.Errorf("%w: retained import batch is no longer committing", ErrInvalidInput)
	}
	return nil
}

func recordBulkImportBatchDocumentTx(ctx context.Context, tx *sql.Tx, batchID int64, result BulkImportCommitRecord) error {
	resultStatus := "FAILED"
	if result.Success {
		resultStatus = "CREATED"
	}
	documentKey := strings.TrimSpace(result.DocumentKey)
	if batchID <= 0 || documentKey == "" {
		return fmt.Errorf("%w: retained import batch and document key are required", ErrInvalidInput)
	}
	referenceCode := strings.TrimSpace(result.ReferenceCode)
	errorMessage := strings.TrimSpace(result.ErrorMessage)
	_, err := tx.ExecContext(ctx, `
		INSERT INTO bulk_import_batch_documents (
			batch_id, document_key, document_id, reference_code, status, error_message
		)
		SELECT id, ?, ?, ?, ?, ?
		FROM bulk_import_batches
		WHERE id = ? AND status = ?
		ON DUPLICATE KEY UPDATE
			document_key = document_key
	`, documentKey, nullableInt64(result.DocumentID), referenceCode, resultStatus, nullableString(errorMessage), batchID, BulkImportStatusCommitting)
	if err != nil {
		return mapDBError(fmt.Errorf("record bulk import document result: %w", err))
	}
	var retainedDocumentID sql.NullInt64
	var retainedReferenceCode string
	var retainedStatus string
	var retainedErrorMessage string
	if err := tx.QueryRowContext(ctx, `
		SELECT
			document.document_id,
			COALESCE(document.reference_code, ''),
			document.status,
			COALESCE(document.error_message, '')
		FROM bulk_import_batch_documents document
		JOIN bulk_import_batches batch ON batch.id = document.batch_id
		WHERE document.batch_id = ?
			AND document.document_key = ?
			AND batch.status = ?
	`, batchID, documentKey, BulkImportStatusCommitting).Scan(
		&retainedDocumentID,
		&retainedReferenceCode,
		&retainedStatus,
		&retainedErrorMessage,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("%w: retained import batch is no longer committing", ErrInvalidInput)
		}
		return mapDBError(fmt.Errorf("verify bulk import document result: %w", err))
	}
	actualDocumentID := int64(0)
	if retainedDocumentID.Valid {
		actualDocumentID = retainedDocumentID.Int64
	}
	if actualDocumentID != result.DocumentID || retainedReferenceCode != referenceCode || retainedStatus != resultStatus || retainedErrorMessage != errorMessage {
		return fmt.Errorf("%w: duplicate document key %q has conflicting import provenance", ErrInvalidInput, documentKey)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE bulk_import_batches
		SET updated_at = CURRENT_TIMESTAMP
		WHERE id = ? AND status = ?
	`, batchID, BulkImportStatusCommitting); err != nil {
		return mapDBError(fmt.Errorf("refresh bulk import commit lease: %w", err))
	}
	return nil
}

func validateUniqueBulkImportCommitRecords(results []BulkImportCommitRecord) error {
	seen := make(map[string]struct{}, len(results))
	for _, result := range results {
		documentKey := strings.TrimSpace(result.DocumentKey)
		if documentKey == "" {
			return fmt.Errorf("%w: retained import document key is required", ErrInvalidInput)
		}
		normalizedDocumentKey := strings.ToUpper(documentKey)
		if _, exists := seen[normalizedDocumentKey]; exists {
			return fmt.Errorf("%w: duplicate document key %q in import results", ErrInvalidInput, documentKey)
		}
		seen[normalizedDocumentKey] = struct{}{}
	}
	return nil
}

func (s *Store) ListBulkImportBatches(ctx context.Context, importType string, customerID int64, beforeID int64, limit int) ([]BulkImportBatch, error) {
	rawImportType := strings.TrimSpace(importType)
	importType = normalizeBulkImportType(rawImportType)
	if importType == "" && rawImportType != "" {
		return nil, fmt.Errorf("%w: invalid bulk import type", ErrInvalidInput)
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	where := []string{"1 = 1"}
	args := make([]any, 0, 3)
	if importType != "" {
		where = append(where, "import_type = ?")
		args = append(args, importType)
	}
	if customerID > 0 {
		where = append(where, "customer_id = ?")
		args = append(args, customerID)
	}
	if beforeID > 0 {
		where = append(where, "id < ?")
		args = append(args, beforeID)
	}
	args = append(args, limit)
	batches := make([]BulkImportBatch, 0)
	query := fmt.Sprintf(`
		SELECT
			id, import_id, import_type, customer_id, customer_name_snapshot,
			source_file_name, content_type, file_size_bytes, file_sha256, status,
			total_documents, valid_documents, invalid_documents, total_lines,
			created_documents, failed_documents, COALESCE(error_message, '') AS error_message,
			created_by_user_id, created_by_name_snapshot, created_by_email_snapshot,
			committed_at, created_at, updated_at
		FROM bulk_import_batches
		WHERE %s
		ORDER BY id DESC
		LIMIT ?
	`, strings.Join(where, " AND "))
	if err := s.db.SelectContext(ctx, &batches, query, args...); err != nil {
		return nil, fmt.Errorf("list bulk import batches: %w", err)
	}
	if len(batches) == 0 {
		return batches, nil
	}
	batchIDs := make([]string, len(batches))
	documentArgs := make([]any, len(batches))
	batchByID := make(map[int64]int, len(batches))
	for index, batch := range batches {
		batchIDs[index] = "?"
		documentArgs[index] = batch.ID
		batchByID[batch.ID] = index
		batches[index].Documents = make([]BulkImportBatchDocument, 0)
	}
	documents := make([]BulkImportBatchDocument, 0)
	if err := s.db.SelectContext(ctx, &documents, fmt.Sprintf(`
		SELECT
			id, batch_id, COALESCE(document_key, '') AS document_key,
			COALESCE(document_id, 0) AS document_id,
			COALESCE(reference_code, '') AS reference_code,
			status, COALESCE(error_message, '') AS error_message, created_at
		FROM bulk_import_batch_documents
		WHERE batch_id IN (%s)
		ORDER BY batch_id DESC, id ASC
	`, strings.Join(batchIDs, ",")), documentArgs...); err != nil {
		return nil, fmt.Errorf("list bulk import document records: %w", err)
	}
	for _, document := range documents {
		if index, ok := batchByID[document.BatchID]; ok {
			batches[index].Documents = append(batches[index].Documents, document)
		}
	}
	return batches, nil
}

func bulkImportPreviewStateCanChange(status string) bool {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case BulkImportStatusUploaded, BulkImportStatusPreviewed, BulkImportStatusPreviewFailed, BulkImportStatusFailed:
		return true
	default:
		return false
	}
}

func bulkImportBatchCanAttemptCommit(status string) bool {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case BulkImportStatusPreviewed, BulkImportStatusCommitting:
		return true
	default:
		return false
	}
}

func (s *Store) GetBulkImportBatchFile(ctx context.Context, batchID int64) (BulkImportBatchFile, error) {
	if batchID <= 0 {
		return BulkImportBatchFile{}, ErrNotFound
	}
	var file BulkImportBatchFile
	if err := s.db.QueryRowContext(ctx, `
		SELECT id, source_file_name, content_type, original_file
		FROM bulk_import_batches
		WHERE id = ?
	`, batchID).Scan(&file.ID, &file.SourceFileName, &file.ContentType, &file.Data); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return BulkImportBatchFile{}, ErrNotFound
		}
		return BulkImportBatchFile{}, fmt.Errorf("load original bulk import file: %w", err)
	}
	return file, nil
}

func (s *Store) validateBulkImportBatch(ctx context.Context, importID string, importType string, customerID int64) (BulkImportBatch, error) {
	importID, err := normalizeInboundBulkImportID(importID)
	if err != nil {
		return BulkImportBatch{}, err
	}
	importType = normalizeBulkImportType(importType)
	if importType == "" || customerID <= 0 {
		return BulkImportBatch{}, fmt.Errorf("%w: import type and customer are required", ErrInvalidInput)
	}
	var batch BulkImportBatch
	if err := s.db.GetContext(ctx, &batch, `
		SELECT
			id, import_id, import_type, customer_id, customer_name_snapshot,
			source_file_name, content_type, file_size_bytes, file_sha256, status,
			total_documents, valid_documents, invalid_documents, total_lines,
			created_documents, failed_documents, COALESCE(error_message, '') AS error_message,
			created_by_user_id, created_by_name_snapshot, created_by_email_snapshot,
			committed_at, created_at, updated_at
		FROM bulk_import_batches
		WHERE import_id = ?
	`, importID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return BulkImportBatch{}, fmt.Errorf("%w: retained bulk import batch was not found", ErrInvalidInput)
		}
		return BulkImportBatch{}, fmt.Errorf("load bulk import batch: %w", err)
	}
	if batch.ImportType != importType || batch.CustomerID != customerID {
		return BulkImportBatch{}, fmt.Errorf("%w: bulk import batch does not match the requested customer or import type", ErrInvalidInput)
	}
	return batch, nil
}

func (s *Store) getBulkImportBatch(ctx context.Context, batchID int64) (BulkImportBatch, error) {
	var batch BulkImportBatch
	if err := s.db.GetContext(ctx, &batch, `
		SELECT
			id, import_id, import_type, customer_id, customer_name_snapshot,
			source_file_name, content_type, file_size_bytes, file_sha256, status,
			total_documents, valid_documents, invalid_documents, total_lines,
			created_documents, failed_documents, COALESCE(error_message, '') AS error_message,
			created_by_user_id, created_by_name_snapshot, created_by_email_snapshot,
			committed_at, created_at, updated_at
		FROM bulk_import_batches
		WHERE id = ?
	`, batchID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return BulkImportBatch{}, ErrNotFound
		}
		return BulkImportBatch{}, fmt.Errorf("load bulk import batch: %w", err)
	}
	batch.Documents = make([]BulkImportBatchDocument, 0)
	return batch, nil
}

func normalizeBulkImportType(value string) string {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case BulkImportTypeInbound:
		return BulkImportTypeInbound
	case BulkImportTypeOutbound:
		return BulkImportTypeOutbound
	case BulkImportTypeTransfer:
		return BulkImportTypeTransfer
	default:
		return ""
	}
}

func cleanBulkImportFileName(value string) string {
	value = strings.ReplaceAll(strings.TrimSpace(value), "\\", "/")
	return strings.TrimSpace(filepath.Base(value))
}
