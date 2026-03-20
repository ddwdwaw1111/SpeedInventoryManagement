package main

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/api"
	"speed-inventory-management/backend/internal/config"
	"speed-inventory-management/backend/internal/database"
	"speed-inventory-management/backend/internal/service"
)

func main() {
	cfg := config.Load()

	if cfg.Env == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}
	defer db.Close()

	if err := database.Migrate(db.DB); err != nil {
		log.Fatalf("database migration failed: %v", err)
	}

	store := service.NewStore(db)
	handler := api.NewHandler(store, cfg.FrontendOrigin, cfg.SessionCookie, cfg.SessionSecure)

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	log.Printf("inventory API listening on %s", server.Addr)

	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server failed: %v", err)
	}
}
