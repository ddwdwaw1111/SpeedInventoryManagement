package config

import "testing"

func TestLoadUsesR2S3APIURLAsEndpointFallback(t *testing.T) {
	t.Setenv("R2_ENDPOINT", "")
	t.Setenv("R2_S3_API_URL", "https://account-id.r2.cloudflarestorage.com/speedwin-uploads")
	t.Setenv("CLOUDFLARE_R2_S3_API_URL", "https://ignored.r2.cloudflarestorage.com/ignored")

	cfg := Load()
	if cfg.R2.Endpoint != "https://account-id.r2.cloudflarestorage.com/speedwin-uploads" {
		t.Fatalf("unexpected R2 endpoint %q", cfg.R2.Endpoint)
	}
}

func TestLoadPrefersExplicitR2Endpoint(t *testing.T) {
	t.Setenv("R2_ENDPOINT", "https://explicit.r2.cloudflarestorage.com")
	t.Setenv("R2_S3_API_URL", "https://fallback.r2.cloudflarestorage.com/speedwin-uploads")

	cfg := Load()
	if cfg.R2.Endpoint != "https://explicit.r2.cloudflarestorage.com" {
		t.Fatalf("unexpected R2 endpoint %q", cfg.R2.Endpoint)
	}
}
