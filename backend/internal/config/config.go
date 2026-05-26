package config

import (
	"os"
	"strconv"
)

type Config struct {
	Env            string
	Port           string
	FrontendOrigin string
	SessionCookie  string
	SessionSecure  bool
	Database       DatabaseConfig
	R2             R2Config
	Attachments    AttachmentConfig
}

type DatabaseConfig struct {
	Host     string
	Port     string
	Name     string
	User     string
	Password string
}

type R2Config struct {
	AccountID       string
	AccessKeyID     string
	SecretAccessKey string
	Bucket          string
	Endpoint        string
}

type AttachmentConfig struct {
	MaxUploadBytes int64
}

func Load() Config {
	return Config{
		Env:            getEnv("APP_ENV", "development"),
		Port:           getEnv("SERVER_PORT", "8080"),
		FrontendOrigin: getEnv("FRONTEND_ORIGIN", "http://localhost:5173"),
		SessionCookie:  getEnv("SESSION_COOKIE_NAME", "sim_session"),
		SessionSecure:  getEnvBool("SESSION_COOKIE_SECURE", false),
		R2: R2Config{
			AccountID:       getEnv("R2_ACCOUNT_ID", ""),
			AccessKeyID:     getEnv("R2_ACCESS_KEY_ID", ""),
			SecretAccessKey: getEnv("R2_SECRET_ACCESS_KEY", ""),
			Bucket:          getEnv("R2_BUCKET", ""),
			Endpoint:        getEnv("R2_ENDPOINT", ""),
		},
		Attachments: AttachmentConfig{
			MaxUploadBytes: getEnvInt64("ATTACHMENT_MAX_UPLOAD_BYTES", 25*1024*1024),
		},
		Database: DatabaseConfig{
			Host:     getEnv("DB_HOST", "127.0.0.1"),
			Port:     getEnv("DB_PORT", "3306"),
			Name:     getEnv("DB_NAME", "speed_inventory_management"),
			User:     getEnv("DB_USER", "inventory_user"),
			Password: getEnv("DB_PASSWORD", "inventory_pass"),
		},
	}
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}

	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}

	return parsed
}

func getEnvInt64(key string, fallback int64) int64 {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed <= 0 {
		return fallback
	}

	return parsed
}
