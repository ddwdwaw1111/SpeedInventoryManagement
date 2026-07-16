package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

const attachmentDownloadTTL = 10 * time.Minute

type AttachmentStorage interface {
	Bucket() string
	Provider() string
	PutObject(ctx context.Context, key string, contentType string, data []byte) error
	DeleteObject(ctx context.Context, key string) error
	SignedGetURL(key string, expires time.Duration) (string, error)
}

type attachmentUploadInput struct {
	DisplayName      string
	OriginalFileName string
	ContentType      string
	Data             []byte
}

func (s *Server) handleUploadInboundDocumentAttachment(c *gin.Context) {
	s.handleUploadDocumentAttachment(c, service.DocumentAttachmentInbound)
}

func (s *Server) handleUploadOutboundDocumentAttachment(c *gin.Context) {
	s.handleUploadDocumentAttachment(c, service.DocumentAttachmentOutbound)
}

func (s *Server) handleGetInboundDocumentAttachmentDownloadURL(c *gin.Context) {
	s.handleGetDocumentAttachmentDownloadURL(c, service.DocumentAttachmentInbound)
}

func (s *Server) handleGetOutboundDocumentAttachmentDownloadURL(c *gin.Context) {
	s.handleGetDocumentAttachmentDownloadURL(c, service.DocumentAttachmentOutbound)
}

func (s *Server) handleDeleteInboundDocumentAttachment(c *gin.Context) {
	s.handleDeleteDocumentAttachment(c, service.DocumentAttachmentInbound)
}

func (s *Server) handleDeleteOutboundDocumentAttachment(c *gin.Context) {
	s.handleDeleteDocumentAttachment(c, service.DocumentAttachmentOutbound)
}

func (s *Server) handleUploadDocumentAttachment(c *gin.Context, documentType string) {
	if s.attachmentStorage == nil {
		writeError(c, http.StatusServiceUnavailable, "attachment storage is not configured")
		return
	}

	documentID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.EnsureDocumentAttachmentMutable(c.Request.Context(), documentType, documentID); err != nil {
		writeDomainError(c, err)
		return
	}

	upload, err := s.readAttachmentUpload(c)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	objectKey, err := newAttachmentObjectKey(documentType, documentID, upload.ContentType)
	if err != nil {
		writeServerError(c, err)
		return
	}
	if err := s.attachmentStorage.PutObject(c.Request.Context(), objectKey, upload.ContentType, upload.Data); err != nil {
		writeServerError(c, err)
		return
	}

	var uploadedByUserID int64
	if authPayload, ok := userFromContext(c); ok {
		uploadedByUserID = authPayload.User.ID
	}

	attachment, err := s.store.CreateDocumentAttachment(c.Request.Context(), service.CreateDocumentAttachmentInput{
		DocumentType:     documentType,
		DocumentID:       documentID,
		DisplayName:      upload.DisplayName,
		OriginalFileName: upload.OriginalFileName,
		StorageProvider:  s.attachmentStorage.Provider(),
		StorageBucket:    s.attachmentStorage.Bucket(),
		StorageKey:       objectKey,
		ContentType:      upload.ContentType,
		SizeBytes:        int64(len(upload.Data)),
		UploadedByUserID: uploadedByUserID,
	})
	if err != nil {
		_ = s.attachmentStorage.DeleteObject(context.Background(), objectKey)
		writeDomainError(c, err)
		return
	}

	s.writeAuditLog(c, "ATTACH", strings.ToLower(documentType)+"_document", documentID, upload.DisplayName, "Uploaded document attachment", map[string]any{
		"attachmentId": attachment.ID,
		"displayName":  attachment.DisplayName,
		"contentType":  attachment.ContentType,
		"sizeBytes":    attachment.SizeBytes,
	})

	writeJSON(c, http.StatusCreated, attachment)
}

func (s *Server) handleGetDocumentAttachmentDownloadURL(c *gin.Context, documentType string) {
	if s.attachmentStorage == nil {
		writeError(c, http.StatusServiceUnavailable, "attachment storage is not configured")
		return
	}

	documentID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	attachmentID, err := parseIDParam(c, "attachmentId")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	attachment, err := s.store.GetDocumentAttachment(c.Request.Context(), documentType, documentID, attachmentID)
	if err != nil {
		writeDomainError(c, err)
		return
	}
	if !strings.EqualFold(attachment.StorageProvider, s.attachmentStorage.Provider()) || attachment.StorageBucket != s.attachmentStorage.Bucket() {
		writeError(c, http.StatusConflict, "attachment storage does not match current storage configuration")
		return
	}

	url, err := s.attachmentStorage.SignedGetURL(attachment.StorageKey, attachmentDownloadTTL)
	if err != nil {
		writeServerError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, gin.H{
		"url":       url,
		"expiresAt": time.Now().UTC().Add(attachmentDownloadTTL).Format(time.RFC3339),
	})
}

func (s *Server) handleDeleteDocumentAttachment(c *gin.Context, documentType string) {
	if s.attachmentStorage == nil {
		writeError(c, http.StatusServiceUnavailable, "attachment storage is not configured")
		return
	}

	documentID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	attachmentID, err := parseIDParam(c, "attachmentId")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	attachment, err := s.store.GetDocumentAttachment(c.Request.Context(), documentType, documentID, attachmentID)
	if err != nil {
		writeDomainError(c, err)
		return
	}
	if !strings.EqualFold(attachment.StorageProvider, s.attachmentStorage.Provider()) || attachment.StorageBucket != s.attachmentStorage.Bucket() {
		writeError(c, http.StatusConflict, "attachment storage does not match current storage configuration")
		return
	}
	if err := s.store.MarkDocumentAttachmentDeleted(c.Request.Context(), documentType, documentID, attachmentID); err != nil {
		writeDomainError(c, err)
		return
	}
	if err := s.attachmentStorage.DeleteObject(c.Request.Context(), attachment.StorageKey); err != nil {
		log.Printf("delete document attachment object failed: document_type=%s document_id=%d attachment_id=%d storage_key=%q error=%v", documentType, documentID, attachmentID, attachment.StorageKey, err)
	}

	s.writeAuditLog(c, "DETACH", strings.ToLower(documentType)+"_document", documentID, attachment.DisplayName, "Deleted document attachment", map[string]any{
		"attachmentId": attachment.ID,
		"displayName":  attachment.DisplayName,
		"contentType":  attachment.ContentType,
		"sizeBytes":    attachment.SizeBytes,
	})

	c.Status(http.StatusNoContent)
}

func (s *Server) deleteDocumentAttachmentObjectsAfterCancel(documentType string, documentID int64, attachments []service.DocumentAttachment) {
	if s.attachmentStorage == nil || len(attachments) == 0 {
		return
	}

	for _, attachment := range attachments {
		if !strings.EqualFold(attachment.StorageProvider, s.attachmentStorage.Provider()) || attachment.StorageBucket != s.attachmentStorage.Bucket() {
			log.Printf("skip document attachment object cleanup: document_type=%s document_id=%d attachment_id=%d storage_provider=%q storage_bucket=%q", documentType, documentID, attachment.ID, attachment.StorageProvider, attachment.StorageBucket)
			continue
		}
		if err := s.attachmentStorage.DeleteObject(context.Background(), attachment.StorageKey); err != nil {
			log.Printf("delete cancelled document attachment object failed: document_type=%s document_id=%d attachment_id=%d storage_key=%q error=%v", documentType, documentID, attachment.ID, attachment.StorageKey, err)
		}
	}
}

func (s *Server) readAttachmentUpload(c *gin.Context) (attachmentUploadInput, error) {
	reader, err := c.Request.MultipartReader()
	if err != nil {
		return attachmentUploadInput{}, fmt.Errorf("multipart form data is required")
	}

	var upload attachmentUploadInput
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return attachmentUploadInput{}, fmt.Errorf("read multipart form: %w", err)
		}

		switch part.FormName() {
		case "displayName":
			value, err := io.ReadAll(io.LimitReader(part, 1024))
			if err != nil {
				return attachmentUploadInput{}, fmt.Errorf("read displayName: %w", err)
			}
			upload.DisplayName = strings.TrimSpace(string(value))
		case "file":
			if upload.Data != nil {
				return attachmentUploadInput{}, fmt.Errorf("only one file can be uploaded per request")
			}
			upload.OriginalFileName = cleanUploadFileName(part.FileName())
			if upload.OriginalFileName == "" {
				return attachmentUploadInput{}, fmt.Errorf("file name is required")
			}

			var buffer bytes.Buffer
			if _, err := io.Copy(&buffer, io.LimitReader(part, s.maxAttachmentBytes+1)); err != nil {
				return attachmentUploadInput{}, fmt.Errorf("read attachment file: %w", err)
			}
			if int64(buffer.Len()) > s.maxAttachmentBytes {
				return attachmentUploadInput{}, fmt.Errorf("file exceeds the %d byte attachment limit", s.maxAttachmentBytes)
			}
			upload.Data = buffer.Bytes()
			upload.ContentType = part.Header.Get("Content-Type")
		}
	}

	if len(upload.Data) == 0 {
		return attachmentUploadInput{}, fmt.Errorf("file is required")
	}

	contentType, err := detectAttachmentContentType(upload.ContentType, upload.Data)
	if err != nil {
		return attachmentUploadInput{}, err
	}
	upload.ContentType = contentType
	upload.DisplayName = firstNonEmptyString(upload.DisplayName, upload.OriginalFileName)

	return upload, nil
}

func detectAttachmentContentType(_ string, data []byte) (string, error) {
	switch {
	case hasPrefix(data, "%PDF-"):
		return "application/pdf", nil
	case len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff:
		return "image/jpeg", nil
	case len(data) >= 8 && bytes.Equal(data[:8], []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}):
		return "image/png", nil
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return "image/webp", nil
	default:
		return "", fmt.Errorf("only PDF, JPG, PNG, and WebP attachments are allowed")
	}
}

func newAttachmentObjectKey(documentType string, documentID int64, contentType string) (string, error) {
	randomBytes := make([]byte, 16)
	if _, err := rand.Read(randomBytes); err != nil {
		return "", fmt.Errorf("generate attachment key: %w", err)
	}
	return fmt.Sprintf(
		"documents/%s/%d/%s-%s%s",
		strings.ToLower(documentType),
		documentID,
		time.Now().UTC().Format("20060102T150405"),
		hex.EncodeToString(randomBytes),
		attachmentExtension(contentType),
	), nil
}

func attachmentExtension(contentType string) string {
	switch strings.ToLower(strings.TrimSpace(contentType)) {
	case "application/pdf":
		return ".pdf"
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	default:
		return ""
	}
}

func cleanUploadFileName(fileName string) string {
	fileName = strings.ReplaceAll(fileName, "\\", "/")
	fileName = path.Base(fileName)
	fileName = strings.TrimSpace(fileName)
	if fileName == "." || fileName == "/" {
		return ""
	}
	return fileName
}

func hasPrefix(data []byte, prefix string) bool {
	return len(data) >= len(prefix) && string(data[:len(prefix)]) == prefix
}
