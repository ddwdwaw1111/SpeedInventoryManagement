package config

import "os"

type Config struct {
	Env            string
	Port           string
	FrontendOrigin string
	SessionCookie  string
	Database       DatabaseConfig
}

type DatabaseConfig struct {
	Host     string
	Port     string
	Name     string
	User     string
	Password string
}

func Load() Config {
	return Config{
		Env:            getEnv("APP_ENV", "development"),
		Port:           getEnv("SERVER_PORT", "8080"),
		FrontendOrigin: getEnv("FRONTEND_ORIGIN", "http://localhost:5173"),
		SessionCookie:  getEnv("SESSION_COOKIE_NAME", "sim_session"),
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
