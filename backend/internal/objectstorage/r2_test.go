package objectstorage

import (
	"net/url"
	"strings"
	"testing"
	"time"

	"speed-inventory-management/backend/internal/config"
)

func TestNewR2ClientRequiresCoreSettings(t *testing.T) {
	base := config.R2Config{
		AccountID:       "account-id",
		AccessKeyID:     "access-key",
		SecretAccessKey: "secret-key",
		Bucket:          "speedwin-uploads",
	}

	testCases := []struct {
		name string
		cfg  config.R2Config
	}{
		{name: "missing account", cfg: config.R2Config{AccessKeyID: base.AccessKeyID, SecretAccessKey: base.SecretAccessKey, Bucket: base.Bucket}},
		{name: "missing access key", cfg: config.R2Config{AccountID: base.AccountID, SecretAccessKey: base.SecretAccessKey, Bucket: base.Bucket}},
		{name: "missing secret", cfg: config.R2Config{AccountID: base.AccountID, AccessKeyID: base.AccessKeyID, Bucket: base.Bucket}},
		{name: "missing bucket", cfg: config.R2Config{AccountID: base.AccountID, AccessKeyID: base.AccessKeyID, SecretAccessKey: base.SecretAccessKey}},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := NewR2Client(tc.cfg); err == nil {
				t.Fatal("expected missing R2 setting to fail")
			}
		})
	}
}

func TestR2ClientBuildsPathStyleObjectURL(t *testing.T) {
	client := newTestR2Client(t, config.R2Config{
		AccountID:       "account-id",
		AccessKeyID:     "access-key",
		SecretAccessKey: "secret-key",
		Bucket:          "speedwin-uploads",
		Endpoint:        "https://account-id.r2.cloudflarestorage.com",
	})

	objectURL := client.objectURL("documents/inbound/42/file name.pdf")

	if objectURL.Scheme != "https" {
		t.Fatalf("expected https scheme, got %q", objectURL.Scheme)
	}
	if objectURL.Host != "account-id.r2.cloudflarestorage.com" {
		t.Fatalf("unexpected R2 host %q", objectURL.Host)
	}
	if objectURL.Path != "/speedwin-uploads/documents/inbound/42/file name.pdf" {
		t.Fatalf("unexpected R2 object path %q", objectURL.Path)
	}
	if strings.Contains(objectURL.Path, "//") {
		t.Fatalf("object path should not contain duplicate separators: %q", objectURL.Path)
	}
}

func TestSignedGetURLUsesR2CredentialScopeAndClampsExpiry(t *testing.T) {
	client := newTestR2Client(t, config.R2Config{
		AccountID:       "account-id",
		AccessKeyID:     "access-key",
		SecretAccessKey: "secret-key",
		Bucket:          "speedwin-uploads",
		Endpoint:        "https://account-id.r2.cloudflarestorage.com",
	})

	signedURL, err := client.SignedGetURL("documents/outbound/9/label.pdf", 10*24*time.Hour)
	if err != nil {
		t.Fatalf("sign get URL: %v", err)
	}
	parsed, err := url.Parse(signedURL)
	if err != nil {
		t.Fatalf("parse signed URL: %v", err)
	}

	if parsed.Path != "/speedwin-uploads/documents/outbound/9/label.pdf" {
		t.Fatalf("unexpected signed URL path %q", parsed.Path)
	}
	query := parsed.Query()
	if query.Get("X-Amz-Algorithm") != "AWS4-HMAC-SHA256" {
		t.Fatalf("unexpected signing algorithm %q", query.Get("X-Amz-Algorithm"))
	}
	if query.Get("X-Amz-Expires") != "604800" {
		t.Fatalf("expected expiry to clamp to 7 days, got %q", query.Get("X-Amz-Expires"))
	}
	if query.Get("X-Amz-SignedHeaders") != "host" {
		t.Fatalf("unexpected signed headers %q", query.Get("X-Amz-SignedHeaders"))
	}
	credential := query.Get("X-Amz-Credential")
	if !strings.HasPrefix(credential, "access-key/") || !strings.Contains(credential, "/auto/s3/aws4_request") {
		t.Fatalf("unexpected R2 credential scope %q", credential)
	}
	if query.Get("X-Amz-Signature") == "" {
		t.Fatal("expected signed URL to include a signature")
	}
}

func TestCloudflareTokenValueHashMatchesR2SecretAccessKeyFormat(t *testing.T) {
	got := sha256Hex([]byte("cfat_example_token"))
	want := "8d048ea543f0af7849443b85868f383f580dee3a5cb5a42cd6653cc6976460a0"

	if got != want {
		t.Fatalf("unexpected SHA-256 token hash: got %q want %q", got, want)
	}
}

func newTestR2Client(t *testing.T, cfg config.R2Config) *R2Client {
	t.Helper()

	client, err := NewR2Client(cfg)
	if err != nil {
		t.Fatalf("create R2 client: %v", err)
	}
	return client
}
