package database

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"
	"strings"
)

// v1Schema is a clean snapshot of the container-centric v1 data model. It is
// intentionally independent of every pre-v1 migration so a new environment
// creates only structures used by the current application.
//
//go:embed v1_schema.sql
var v1Schema string

func applyV1ContainerCentricBaseline(db *sql.DB) error {
	ctx := context.Background()
	conn, err := db.Conn(ctx)
	if err != nil {
		return fmt.Errorf("open v1 schema connection: %w", err)
	}
	defer conn.Close()

	// The schema dump is alphabetic rather than dependency ordered. Keeping all
	// statements on one connection makes this session setting deterministic.
	if _, err := conn.ExecContext(ctx, `SET FOREIGN_KEY_CHECKS = 0`); err != nil {
		return fmt.Errorf("disable foreign key checks: %w", err)
	}
	defer func() {
		_, _ = conn.ExecContext(context.Background(), `SET FOREIGN_KEY_CHECKS = 1`)
	}()

	for _, statement := range strings.Split(v1Schema, ";") {
		statement = strings.TrimSpace(statement)
		if statement == "" {
			continue
		}
		if _, err := conn.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("create v1 schema: %w", err)
		}
	}

	if _, err := conn.ExecContext(ctx, `
		INSERT INTO users (email, full_name, role, is_active, password_salt, password_hash)
		VALUES ('admin@gmail.com', 'Admin', 'admin', TRUE, '', '$2a$12$PbWf4UovuWL.gD5YI8xt5Om8JjdcN2VXeqaXrUcWe8Nrlu6gVmL8e')
		ON DUPLICATE KEY UPDATE
			full_name = VALUES(full_name),
			role = VALUES(role),
			is_active = VALUES(is_active)
	`); err != nil {
		return fmt.Errorf("seed local administrator: %w", err)
	}
	return nil
}
