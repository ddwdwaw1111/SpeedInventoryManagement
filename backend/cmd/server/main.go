package main

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/api"
	"speed-inventory-management/backend/internal/config"
	"speed-inventory-management/backend/internal/database"
	"speed-inventory-management/backend/internal/objectstorage"
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

	store, err := service.NewStoreWithOptions(db, service.StoreOptions{
		RunStartupMaintenance: cfg.StartupDBMaintenance,
	})
	if err != nil {
		log.Fatalf("service initialization failed: %v", err)
	}

	var attachmentStorage api.AttachmentStorage
	if cfg.R2.AccountID != "" || cfg.R2.AccessKeyID != "" || cfg.R2.SecretAccessKey != "" || cfg.R2.Bucket != "" || cfg.R2.Endpoint != "" {
		attachmentStorage, err = objectstorage.NewR2Client(cfg.R2)
		if err != nil {
			log.Fatalf("attachment storage configuration failed: %v", err)
		}
		log.Printf("attachment storage enabled: provider=%s bucket=%s", attachmentStorage.Provider(), attachmentStorage.Bucket())
	} else {
		log.Printf("attachment storage disabled: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET or R2_S3_API_URL")
	}
	handler := api.NewHandlerWithAttachmentStorage(store, cfg.FrontendOrigin, cfg.SessionCookie, cfg.SessionSecure, attachmentStorage, cfg.Attachments.MaxUploadBytes)

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       2 * time.Minute,
		WriteTimeout:      2 * time.Minute,
		IdleTimeout:       60 * time.Second,
	}

	log.Printf("inventory API listening on %s", server.Addr)

	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server failed: %v", err)
	}
}
