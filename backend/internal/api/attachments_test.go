package api

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

func TestReadAttachmentUploadAcceptsPDFAndDisplayName(t *testing.T) {
	context := newAttachmentUploadContext(t, []multipartPart{
		{name: "displayName", value: "  Custom invoice name  "},
		{name: "file", fileName: "invoice.pdf", contentType: "application/pdf", data: []byte("%PDF-1.7\nbody")},
	})
	server := &Server{maxAttachmentBytes: 1024}

	upload, err := server.readAttachmentUpload(context)
	if err != nil {
		t.Fatalf("read attachment upload: %v", err)
	}

	if upload.DisplayName != "Custom invoice name" {
		t.Fatalf("unexpected display name %q", upload.DisplayName)
	}
	if upload.OriginalFileName != "invoice.pdf" {
		t.Fatalf("unexpected original file name %q", upload.OriginalFileName)
	}
	if upload.ContentType != "application/pdf" {
		t.Fatalf("unexpected content type %q", upload.ContentType)
	}
	if !bytes.Equal(upload.Data, []byte("%PDF-1.7\nbody")) {
		t.Fatalf("unexpected uploaded data %q", string(upload.Data))
	}
}

func TestReadAttachmentUploadDefaultsDisplayNameToOriginalFileName(t *testing.T) {
	context := newAttachmentUploadContext(t, []multipartPart{
		{name: "file", fileName: "photo.png", contentType: "image/png", data: []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0x00}},
	})
	server := &Server{maxAttachmentBytes: 1024}

	upload, err := server.readAttachmentUpload(context)
	if err != nil {
		t.Fatalf("read attachment upload: %v", err)
	}

	if upload.DisplayName != "photo.png" {
		t.Fatalf("expected display name to fall back to file name, got %q", upload.DisplayName)
	}
	if upload.ContentType != "image/png" {
		t.Fatalf("unexpected content type %q", upload.ContentType)
	}
}

func TestReadAttachmentUploadRejectsUnsupportedFileType(t *testing.T) {
	context := newAttachmentUploadContext(t, []multipartPart{
		{name: "file", fileName: "notes.txt", contentType: "text/plain", data: []byte("plain text")},
	})
	server := &Server{maxAttachmentBytes: 1024}

	_, err := server.readAttachmentUpload(context)
	if err == nil || !strings.Contains(err.Error(), "PDF, JPG, PNG, and WebP") {
		t.Fatalf("expected unsupported file type error, got %v", err)
	}
}

func TestReadAttachmentUploadRejectsSpoofedContentType(t *testing.T) {
	context := newAttachmentUploadContext(t, []multipartPart{
		{name: "file", fileName: "fake.png", contentType: "image/png", data: []byte("plain text")},
	})
	server := &Server{maxAttachmentBytes: 1024}

	_, err := server.readAttachmentUpload(context)
	if err == nil || !strings.Contains(err.Error(), "PDF, JPG, PNG, and WebP") {
		t.Fatalf("expected spoofed content type to be rejected, got %v", err)
	}
}

func TestReadAttachmentUploadRejectsOversizedFile(t *testing.T) {
	context := newAttachmentUploadContext(t, []multipartPart{
		{name: "file", fileName: "large.pdf", contentType: "application/pdf", data: []byte("%PDF-large")},
	})
	server := &Server{maxAttachmentBytes: 4}

	_, err := server.readAttachmentUpload(context)
	if err == nil || !strings.Contains(err.Error(), "attachment limit") {
		t.Fatalf("expected attachment size error, got %v", err)
	}
}

func TestCleanUploadFileNameRemovesClientPath(t *testing.T) {
	if got := cleanUploadFileName(`C:\fakepath\nested\receipt.webp`); got != "receipt.webp" {
		t.Fatalf("unexpected cleaned file name %q", got)
	}
	if got := cleanUploadFileName("../receipt.jpg"); got != "receipt.jpg" {
		t.Fatalf("unexpected cleaned file name %q", got)
	}
}

func TestDocumentAttachmentJSONOmitsStorageLocation(t *testing.T) {
	attachment := service.DocumentAttachment{
		ID:               123,
		DocumentType:     service.DocumentAttachmentInbound,
		DocumentID:       456,
		DisplayName:      "Receipt",
		OriginalFileName: "receipt.pdf",
		StorageProvider:  "r2",
		StorageBucket:    "private-bucket",
		StorageKey:       "documents/inbound/456/receipt.pdf",
		ContentType:      "application/pdf",
		SizeBytes:        42,
		UploadedByUserID: 7,
	}

	body, err := json.Marshal(attachment)
	if err != nil {
		t.Fatalf("marshal attachment: %v", err)
	}

	payload := string(body)
	for _, hiddenValue := range []string{
		"storageProvider",
		"storageBucket",
		"storageKey",
		"private-bucket",
		"documents/inbound/456/receipt.pdf",
	} {
		if strings.Contains(payload, hiddenValue) {
			t.Fatalf("attachment JSON leaked storage value %q in %s", hiddenValue, payload)
		}
	}
	if !strings.Contains(payload, `"displayName":"Receipt"`) {
		t.Fatalf("attachment JSON should still include public fields, got %s", payload)
	}
}

type multipartPart struct {
	name        string
	value       string
	fileName    string
	contentType string
	data        []byte
}

func newAttachmentUploadContext(t *testing.T, parts []multipartPart) *gin.Context {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, part := range parts {
		if part.fileName == "" {
			if err := writer.WriteField(part.name, part.value); err != nil {
				t.Fatalf("write field %s: %v", part.name, err)
			}
			continue
		}

		headers := make(textproto.MIMEHeader)
		headers.Set("Content-Disposition", `form-data; name="`+part.name+`"; filename="`+part.fileName+`"`)
		headers.Set("Content-Type", part.contentType)
		fileWriter, err := writer.CreatePart(headers)
		if err != nil {
			t.Fatalf("create file field %s: %v", part.name, err)
		}
		if _, err := io.Copy(fileWriter, bytes.NewReader(part.data)); err != nil {
			t.Fatalf("write file field %s: %v", part.name, err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	request := httptest.NewRequest(http.MethodPost, "/upload", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	context.Request = request
	return context
}
