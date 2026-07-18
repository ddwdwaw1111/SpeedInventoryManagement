package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

const (
	DocumentAttachmentInbound  = "INBOUND"
	DocumentAttachmentOutbound = "OUTBOUND"
)

type DocumentAttachment struct {
	ID               int64     `json:"id"`
	DocumentType     string    `json:"documentType"`
	DocumentID       int64     `json:"documentId"`
	DisplayName      string    `json:"displayName"`
	OriginalFileName string    `json:"originalFileName"`
	StorageProvider  string    `json:"-"`
	StorageBucket    string    `json:"-"`
	StorageKey       string    `json:"-"`
	ContentType      string    `json:"contentType"`
	SizeBytes        int64     `json:"sizeBytes"`
	UploadedByUserID int64     `json:"uploadedByUserId"`
	CreatedAt        time.Time `json:"createdAt"`
}

type CreateDocumentAttachmentInput struct {
	DocumentType     string
	DocumentID       int64
	DisplayName      string
	OriginalFileName string
	StorageProvider  string
	StorageBucket    string
	StorageKey       string
	ContentType      string
	SizeBytes        int64
	UploadedByUserID int64
}

type documentAttachmentRow struct {
	ID               int64     `db:"id"`
	DocumentType     string    `db:"document_type"`
	DocumentID       int64     `db:"document_id"`
	DisplayName      string    `db:"display_name"`
	OriginalFileName string    `db:"original_file_name"`
	StorageProvider  string    `db:"storage_provider"`
	StorageBucket    string    `db:"storage_bucket"`
	StorageKey       string    `db:"storage_key"`
	ContentType      string    `db:"content_type"`
	SizeBytes        int64     `db:"size_bytes"`
	UploadedByUserID int64     `db:"uploaded_by_user_id"`
	CreatedAt        time.Time `db:"created_at"`
}

type documentAttachmentExecutor interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func (s *Store) CreateDocumentAttachment(ctx context.Context, input CreateDocumentAttachmentInput) (DocumentAttachment, error) {
	input.DocumentType = normalizeDocumentAttachmentType(input.DocumentType)
	input.DisplayName = sanitizeAttachmentDisplayName(input.DisplayName)
	input.OriginalFileName = sanitizeAttachmentDisplayName(input.OriginalFileName)
	input.StorageProvider = strings.TrimSpace(input.StorageProvider)
	input.StorageBucket = strings.TrimSpace(input.StorageBucket)
	input.StorageKey = strings.TrimSpace(input.StorageKey)
	input.ContentType = strings.TrimSpace(input.ContentType)

	if input.DocumentType == "" || input.DocumentID <= 0 {
		return DocumentAttachment{}, fmt.Errorf("%w: document reference is required", ErrInvalidInput)
	}
	if input.DisplayName == "" {
		input.DisplayName = input.OriginalFileName
	}
	if input.DisplayName == "" {
		return DocumentAttachment{}, fmt.Errorf("%w: file name is required", ErrInvalidInput)
	}
	if input.StorageProvider == "" || input.StorageBucket == "" || input.StorageKey == "" {
		return DocumentAttachment{}, fmt.Errorf("%w: storage location is required", ErrInvalidInput)
	}
	if input.ContentType == "" {
		input.ContentType = "application/octet-stream"
	}
	if input.SizeBytes <= 0 {
		return DocumentAttachment{}, fmt.Errorf("%w: file is empty", ErrInvalidInput)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return DocumentAttachment{}, fmt.Errorf("begin document attachment transaction: %w", err)
	}
	defer tx.Rollback()
	if err := ensureDocumentAttachmentMutableTx(ctx, tx, input.DocumentType, input.DocumentID); err != nil {
		return DocumentAttachment{}, err
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO document_attachments (
			document_type,
			document_id,
			display_name,
			original_file_name,
			storage_provider,
			storage_bucket,
			storage_key,
			content_type,
			size_bytes,
			uploaded_by_user_id
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		input.DocumentType,
		input.DocumentID,
		input.DisplayName,
		input.OriginalFileName,
		input.StorageProvider,
		input.StorageBucket,
		input.StorageKey,
		input.ContentType,
		input.SizeBytes,
		nullableInt64(input.UploadedByUserID),
	)
	if err != nil {
		return DocumentAttachment{}, fmt.Errorf("create document attachment: %w", err)
	}

	attachmentID, err := result.LastInsertId()
	if err != nil {
		return DocumentAttachment{}, fmt.Errorf("read document attachment id: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return DocumentAttachment{}, fmt.Errorf("commit document attachment: %w", err)
	}

	return s.GetDocumentAttachment(ctx, input.DocumentType, input.DocumentID, attachmentID)
}

func (s *Store) ListDocumentAttachments(ctx context.Context, documentType string, documentID int64) ([]DocumentAttachment, error) {
	attachmentsByDocumentID, err := s.ListDocumentAttachmentsForDocuments(ctx, documentType, []int64{documentID})
	if err != nil {
		return nil, err
	}
	return attachmentsByDocumentID[documentID], nil
}

func (s *Store) ListDocumentAttachmentsForDocuments(ctx context.Context, documentType string, documentIDs []int64) (map[int64][]DocumentAttachment, error) {
	documentType = normalizeDocumentAttachmentType(documentType)
	result := make(map[int64][]DocumentAttachment, len(documentIDs))
	if documentType == "" || len(documentIDs) == 0 {
		return result, nil
	}

	query, args, err := sqlx.In(`
		SELECT
			id,
			document_type,
			document_id,
			display_name,
			COALESCE(original_file_name, '') AS original_file_name,
			storage_provider,
			storage_bucket,
			storage_key,
			content_type,
			size_bytes,
			COALESCE(uploaded_by_user_id, 0) AS uploaded_by_user_id,
			created_at
		FROM document_attachments
		WHERE document_type = ?
			AND document_id IN (?)
			AND deleted_at IS NULL
		ORDER BY document_id ASC, created_at ASC, id ASC
	`, documentType, documentIDs)
	if err != nil {
		return nil, fmt.Errorf("build document attachment query: %w", err)
	}

	rows := make([]documentAttachmentRow, 0)
	if err := s.db.SelectContext(ctx, &rows, s.db.Rebind(query), args...); err != nil {
		return nil, fmt.Errorf("load document attachments: %w", err)
	}

	for _, row := range rows {
		result[row.DocumentID] = append(result[row.DocumentID], documentAttachmentFromRow(row))
	}
	return result, nil
}

func (s *Store) attachDocumentAttachments(ctx context.Context, documentType string, documentIDs []int64, setAttachments func(int64, []DocumentAttachment)) error {
	attachmentsByDocumentID, err := s.ListDocumentAttachmentsForDocuments(ctx, documentType, documentIDs)
	if err != nil {
		return err
	}
	for _, documentID := range documentIDs {
		attachments := attachmentsByDocumentID[documentID]
		if attachments == nil {
			attachments = []DocumentAttachment{}
		}
		setAttachments(documentID, attachments)
	}
	return nil
}

func (s *Store) GetDocumentAttachment(ctx context.Context, documentType string, documentID int64, attachmentID int64) (DocumentAttachment, error) {
	documentType = normalizeDocumentAttachmentType(documentType)
	if documentType == "" || documentID <= 0 || attachmentID <= 0 {
		return DocumentAttachment{}, ErrNotFound
	}

	var row documentAttachmentRow
	if err := s.db.GetContext(ctx, &row, `
		SELECT
			id,
			document_type,
			document_id,
			display_name,
			COALESCE(original_file_name, '') AS original_file_name,
			storage_provider,
			storage_bucket,
			storage_key,
			content_type,
			size_bytes,
			COALESCE(uploaded_by_user_id, 0) AS uploaded_by_user_id,
			created_at
		FROM document_attachments
		WHERE id = ?
			AND document_type = ?
			AND document_id = ?
			AND deleted_at IS NULL
	`, attachmentID, documentType, documentID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return DocumentAttachment{}, ErrNotFound
		}
		return DocumentAttachment{}, fmt.Errorf("load document attachment: %w", err)
	}

	return documentAttachmentFromRow(row), nil
}

func (s *Store) MarkDocumentAttachmentDeleted(ctx context.Context, documentType string, documentID int64, attachmentID int64) error {
	documentType = normalizeDocumentAttachmentType(documentType)
	if documentType == "" || documentID <= 0 || attachmentID <= 0 {
		return ErrNotFound
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin document attachment delete transaction: %w", err)
	}
	defer tx.Rollback()
	if err := ensureDocumentAttachmentMutableTx(ctx, tx, documentType, documentID); err != nil {
		return err
	}

	result, err := tx.ExecContext(ctx, `
		UPDATE document_attachments
		SET deleted_at = CURRENT_TIMESTAMP
		WHERE id = ?
			AND document_type = ?
			AND document_id = ?
			AND deleted_at IS NULL
	`, attachmentID, documentType, documentID)
	if err != nil {
		return fmt.Errorf("delete document attachment: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read document attachment delete count: %w", err)
	}
	if affected == 0 {
		return ErrNotFound
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit document attachment delete: %w", err)
	}
	return nil
}

func (s *Store) MarkDocumentAttachmentsDeletedForDocument(ctx context.Context, documentType string, documentID int64) error {
	return markDocumentAttachmentsDeletedForDocument(ctx, s.db, documentType, documentID)
}

func markDocumentAttachmentsDeletedForDocument(ctx context.Context, executor documentAttachmentExecutor, documentType string, documentID int64) error {
	documentType = normalizeDocumentAttachmentType(documentType)
	if documentType == "" || documentID <= 0 {
		return ErrNotFound
	}

	if _, err := executor.ExecContext(ctx, `
		UPDATE document_attachments
		SET deleted_at = CURRENT_TIMESTAMP
		WHERE document_type = ?
			AND document_id = ?
			AND deleted_at IS NULL
	`, documentType, documentID); err != nil {
		return fmt.Errorf("delete document attachments: %w", err)
	}
	return nil
}

func (s *Store) EnsureDocumentExists(ctx context.Context, documentType string, documentID int64) error {
	return s.ensureDocumentExists(ctx, documentType, documentID)
}

func (s *Store) EnsureDocumentAttachmentMutable(ctx context.Context, documentType string, documentID int64) error {
	documentType = normalizeDocumentAttachmentType(documentType)
	if documentType == "" || documentID <= 0 {
		return ErrNotFound
	}

	tableName := "outbound_documents"
	if documentType == DocumentAttachmentInbound {
		tableName = "inbound_documents"
	}
	var status string
	if err := s.db.QueryRowxContext(ctx, fmt.Sprintf("SELECT status FROM %s WHERE id = ?", tableName), documentID).Scan(&status); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("check attachment document status: %w", err)
	}
	if normalizeDocumentStatus(status) == DocumentStatusDeleted {
		return fmt.Errorf("%w: deleted document cannot modify attachments", ErrInvalidInput)
	}
	return nil
}

func ensureDocumentAttachmentMutableTx(ctx context.Context, tx *sql.Tx, documentType string, documentID int64) error {
	documentType = normalizeDocumentAttachmentType(documentType)
	if documentType == "" || documentID <= 0 {
		return ErrNotFound
	}
	if documentType == DocumentAttachmentInbound {
		var status string
		if err := tx.QueryRowContext(ctx, `
			SELECT status
			FROM inbound_documents
			WHERE id = ?
			FOR UPDATE
		`, documentID).Scan(&status); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return fmt.Errorf("lock inbound attachment document: %w", err)
		}
		if normalizeDocumentStatus(status) == DocumentStatusDeleted {
			return fmt.Errorf("%w: deleted document cannot modify attachments", ErrInvalidInput)
		}
		return nil
	}

	var status string
	if err := tx.QueryRowContext(ctx, `
		SELECT status
		FROM outbound_documents
		WHERE id = ?
		FOR UPDATE
	`, documentID).Scan(&status); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("lock outbound attachment document: %w", err)
	}
	if normalizeDocumentStatus(status) == DocumentStatusDeleted {
		return fmt.Errorf("%w: deleted document cannot modify attachments", ErrInvalidInput)
	}
	return nil
}

func (s *Store) ensureDocumentExists(ctx context.Context, documentType string, documentID int64) error {
	tableName := ""
	switch normalizeDocumentAttachmentType(documentType) {
	case DocumentAttachmentInbound:
		tableName = "inbound_documents"
	case DocumentAttachmentOutbound:
		tableName = "outbound_documents"
	default:
		return fmt.Errorf("%w: unsupported document type", ErrInvalidInput)
	}

	var id int64
	if err := s.db.QueryRowxContext(ctx, fmt.Sprintf("SELECT id FROM %s WHERE id = ?", tableName), documentID).Scan(&id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("check document exists: %w", err)
	}
	return nil
}

func documentAttachmentFromRow(row documentAttachmentRow) DocumentAttachment {
	return DocumentAttachment{
		ID:               row.ID,
		DocumentType:     row.DocumentType,
		DocumentID:       row.DocumentID,
		DisplayName:      row.DisplayName,
		OriginalFileName: row.OriginalFileName,
		StorageProvider:  row.StorageProvider,
		StorageBucket:    row.StorageBucket,
		StorageKey:       row.StorageKey,
		ContentType:      row.ContentType,
		SizeBytes:        row.SizeBytes,
		UploadedByUserID: row.UploadedByUserID,
		CreatedAt:        row.CreatedAt,
	}
}

func normalizeDocumentAttachmentType(value string) string {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case DocumentAttachmentInbound:
		return DocumentAttachmentInbound
	case DocumentAttachmentOutbound:
		return DocumentAttachmentOutbound
	default:
		return ""
	}
}

func sanitizeAttachmentDisplayName(value string) string {
	value = strings.TrimSpace(value)
	value = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		switch r {
		case '/', '\\':
			return '-'
		default:
			return r
		}
	}, value)
	value = strings.Join(strings.Fields(value), " ")
	runes := []rune(value)
	if len(runes) > 190 {
		value = strings.TrimSpace(string(runes[:190]))
	}
	return value
}
