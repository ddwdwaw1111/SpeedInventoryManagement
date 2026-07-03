package service

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

const (
	ContainerLifecycleNodeKindContainer    = "container"
	ContainerLifecycleNodeKindTracking     = "tracking"
	ContainerLifecycleNodeKindPickup       = "pickup"
	ContainerLifecycleNodeKindReceiving    = "receiving"
	ContainerLifecycleNodeKindInventory    = "inventory"
	ContainerLifecycleNodeKindTransfer     = "transfer"
	ContainerLifecycleNodeKindPickingOrder = "picking-order"
	ContainerLifecycleNodeKindDelivery     = "delivery"

	ContainerLifecycleNodeSourceContainer      = "CONTAINER"
	ContainerLifecycleNodeSourceTrackingEvent  = "TRACKING_EVENT"
	ContainerLifecycleNodeSourcePickup         = "PICKUP_ASSIGNMENT"
	ContainerLifecycleNodeSourceInbound        = "INBOUND_DOCUMENT"
	ContainerLifecycleNodeSourceOutbound       = "OUTBOUND_DOCUMENT"
	ContainerLifecycleNodeSourceDelivery       = "DELIVERY_EVENT"
	ContainerLifecycleNodeSourceStockLifecycle = "STOCK_LIFECYCLE_EVENT"
)

type ContainerLifecycleNode struct {
	ID           int64     `json:"id"`
	ContainerID  int64     `json:"containerId"`
	ParentNodeID int64     `json:"parentNodeId"`
	NodeKey      string    `json:"nodeKey"`
	NodeKind     string    `json:"nodeKind"`
	Title        string    `json:"title"`
	SourceType   string    `json:"sourceType"`
	SourceID     int64     `json:"sourceId"`
	Visibility   string    `json:"visibility"`
	SortOrder    int       `json:"sortOrder"`
	PositionX    *float64  `json:"positionX"`
	PositionY    *float64  `json:"positionY"`
	MetadataJSON string    `json:"metadataJson"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type CreateContainerLifecycleNodeInput struct {
	ParentNodeID int64    `json:"parentNodeId"`
	NodeKey      string   `json:"nodeKey"`
	NodeKind     string   `json:"nodeKind"`
	Title        string   `json:"title"`
	SourceType   string   `json:"sourceType"`
	SourceID     int64    `json:"sourceId"`
	Visibility   string   `json:"visibility"`
	SortOrder    int      `json:"sortOrder"`
	PositionX    *float64 `json:"positionX"`
	PositionY    *float64 `json:"positionY"`
	MetadataJSON string   `json:"metadataJson"`
}

type UpdateContainerLifecycleNodeInput struct {
	ParentNodeID int64    `json:"parentNodeId"`
	Title        string   `json:"title"`
	SourceType   string   `json:"sourceType"`
	SourceID     int64    `json:"sourceId"`
	Visibility   string   `json:"visibility"`
	SortOrder    int      `json:"sortOrder"`
	PositionX    *float64 `json:"positionX"`
	PositionY    *float64 `json:"positionY"`
	MetadataJSON string   `json:"metadataJson"`
}

func (s *Store) ListContainerLifecycleNodes(ctx context.Context, containerID int64) ([]ContainerLifecycleNode, error) {
	if containerID <= 0 {
		return []ContainerLifecycleNode{}, nil
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT
			id,
			container_id,
			COALESCE(parent_node_id, 0),
			node_key,
			node_kind,
			COALESCE(title, ''),
			COALESCE(source_type, ''),
			COALESCE(source_id, 0),
			COALESCE(visibility, 'BOTH'),
			sort_order,
			position_x,
			position_y,
			COALESCE(CAST(metadata_json AS CHAR), ''),
			created_at,
			updated_at
		FROM container_lifecycle_nodes
		WHERE container_id = ?
		ORDER BY sort_order ASC, id ASC
	`, containerID)
	if err != nil {
		return nil, mapDBError(fmt.Errorf("list container lifecycle nodes: %w", err))
	}
	defer rows.Close()

	nodes := make([]ContainerLifecycleNode, 0)
	for rows.Next() {
		node, err := scanContainerLifecycleNode(rows)
		if err != nil {
			return nil, err
		}
		nodes = append(nodes, node)
	}
	return nodes, rows.Err()
}

func (s *Store) CreateContainerLifecycleNode(ctx context.Context, containerID int64, input CreateContainerLifecycleNodeInput) (ContainerLifecycleNode, error) {
	if containerID <= 0 {
		return ContainerLifecycleNode{}, ErrInvalidInput
	}
	if _, err := s.getContainerByID(ctx, containerID); err != nil {
		return ContainerLifecycleNode{}, err
	}
	nodeKind := normalizeContainerLifecycleNodeKind(input.NodeKind)
	if nodeKind == "" {
		return ContainerLifecycleNode{}, fmt.Errorf("%w: lifecycle node kind is required", ErrInvalidInput)
	}
	if input.ParentNodeID > 0 {
		if err := s.requireLifecycleNodeBelongsToContainer(ctx, containerID, input.ParentNodeID); err != nil {
			return ContainerLifecycleNode{}, err
		}
	}
	sortOrder := input.SortOrder
	if sortOrder <= 0 {
		sortOrder = s.nextContainerLifecycleNodeSortOrder(ctx, containerID)
	}
	nodeKey := strings.TrimSpace(input.NodeKey)
	if nodeKey == "" {
		nodeKey = fmt.Sprintf("manual:%s:%d", nodeKind, time.Now().UnixNano())
	}
	sourceType := normalizeContainerLifecycleNodeSourceType(input.SourceType)
	visibility := normalizeLifecycleEventVisibility(input.Visibility)
	result, err := s.db.ExecContext(ctx, `
		INSERT INTO container_lifecycle_nodes (
			container_id,
			parent_node_id,
			node_key,
			node_kind,
			title,
			source_type,
			source_id,
			visibility,
			sort_order,
			position_x,
			position_y,
			metadata_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		containerID,
		nullableInt64(input.ParentNodeID),
		nodeKey,
		nodeKind,
		nullableString(input.Title),
		nullableString(sourceType),
		input.SourceID,
		visibility,
		sortOrder,
		nullableFloat64(input.PositionX),
		nullableFloat64(input.PositionY),
		nullableString(input.MetadataJSON),
	)
	if err != nil {
		return ContainerLifecycleNode{}, mapDBError(fmt.Errorf("create container lifecycle node: %w", err))
	}
	nodeID, err := result.LastInsertId()
	if err != nil {
		return ContainerLifecycleNode{}, fmt.Errorf("resolve container lifecycle node id: %w", err)
	}
	return s.getContainerLifecycleNodeByID(ctx, containerID, nodeID)
}

func (s *Store) UpdateContainerLifecycleNode(ctx context.Context, containerID int64, nodeID int64, input UpdateContainerLifecycleNodeInput) (ContainerLifecycleNode, error) {
	if containerID <= 0 || nodeID <= 0 {
		return ContainerLifecycleNode{}, ErrInvalidInput
	}
	existing, err := s.getContainerLifecycleNodeByID(ctx, containerID, nodeID)
	if err != nil {
		return ContainerLifecycleNode{}, err
	}
	parentNodeID := existing.ParentNodeID
	if input.ParentNodeID > 0 {
		if input.ParentNodeID == nodeID {
			return ContainerLifecycleNode{}, fmt.Errorf("%w: lifecycle node cannot parent itself", ErrInvalidInput)
		}
		if err := s.requireLifecycleNodeBelongsToContainer(ctx, containerID, input.ParentNodeID); err != nil {
			return ContainerLifecycleNode{}, err
		}
		parentNodeID = input.ParentNodeID
	}
	title := existing.Title
	if strings.TrimSpace(input.Title) != "" {
		title = strings.TrimSpace(input.Title)
	}
	sourceType := existing.SourceType
	sourceID := existing.SourceID
	if strings.TrimSpace(input.SourceType) != "" {
		sourceType = normalizeContainerLifecycleNodeSourceType(input.SourceType)
		sourceID = input.SourceID
	}
	visibility := existing.Visibility
	if strings.TrimSpace(input.Visibility) != "" {
		visibility = normalizeLifecycleEventVisibility(input.Visibility)
	}
	sortOrder := existing.SortOrder
	if input.SortOrder > 0 {
		sortOrder = input.SortOrder
	}
	positionX := existing.PositionX
	if input.PositionX != nil {
		positionX = input.PositionX
	}
	positionY := existing.PositionY
	if input.PositionY != nil {
		positionY = input.PositionY
	}
	metadataJSON := existing.MetadataJSON
	if strings.TrimSpace(input.MetadataJSON) != "" {
		metadataJSON = strings.TrimSpace(input.MetadataJSON)
	}

	if _, err := s.db.ExecContext(ctx, `
		UPDATE container_lifecycle_nodes
		SET
			parent_node_id = ?,
			title = ?,
			source_type = ?,
			source_id = ?,
			visibility = ?,
			sort_order = ?,
			position_x = ?,
			position_y = ?,
			metadata_json = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
			AND container_id = ?
	`,
		nullableInt64(parentNodeID),
		nullableString(title),
		nullableString(sourceType),
		sourceID,
		visibility,
		sortOrder,
		nullableFloat64(positionX),
		nullableFloat64(positionY),
		nullableString(metadataJSON),
		nodeID,
		containerID,
	); err != nil {
		return ContainerLifecycleNode{}, mapDBError(fmt.Errorf("update container lifecycle node: %w", err))
	}
	return s.getContainerLifecycleNodeByID(ctx, containerID, nodeID)
}

func (s *Store) DeleteContainerLifecycleNode(ctx context.Context, containerID int64, nodeID int64) error {
	if containerID <= 0 || nodeID <= 0 {
		return ErrInvalidInput
	}
	existing, err := s.getContainerLifecycleNodeByID(ctx, containerID, nodeID)
	if err != nil {
		return err
	}
	if existing.NodeKind == ContainerLifecycleNodeKindContainer || existing.NodeKey == "container" {
		return fmt.Errorf("%w: container lifecycle root node cannot be deleted", ErrInvalidInput)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return mapDBError(fmt.Errorf("begin delete container lifecycle node: %w", err))
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		UPDATE container_lifecycle_nodes
		SET
			parent_node_id = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE container_id = ?
			AND parent_node_id = ?
	`, nullableInt64(existing.ParentNodeID), containerID, nodeID); err != nil {
		return mapDBError(fmt.Errorf("reparent container lifecycle child nodes: %w", err))
	}

	result, err := tx.ExecContext(ctx, `
		DELETE FROM container_lifecycle_nodes
		WHERE id = ?
			AND container_id = ?
	`, nodeID, containerID)
	if err != nil {
		return mapDBError(fmt.Errorf("delete container lifecycle node: %w", err))
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("resolve deleted container lifecycle node count: %w", err)
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}
	if err := tx.Commit(); err != nil {
		return mapDBError(fmt.Errorf("commit delete container lifecycle node: %w", err))
	}
	return nil
}

func (s *Store) ensureDefaultContainerLifecycleNodes(ctx context.Context, container Container) error {
	if container.ID <= 0 {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO container_lifecycle_nodes (
			container_id,
			parent_node_id,
			node_key,
			node_kind,
			title,
			source_type,
			source_id,
			visibility,
			sort_order,
			position_x,
			position_y
		) VALUES (?, NULL, 'container', ?, ?, ?, ?, 'BOTH', 10, 0, 160)
		ON DUPLICATE KEY UPDATE
			title = VALUES(title),
			source_type = VALUES(source_type),
			source_id = VALUES(source_id),
			updated_at = CURRENT_TIMESTAMP
	`,
		container.ID,
		ContainerLifecycleNodeKindContainer,
		container.ContainerNo,
		ContainerLifecycleNodeSourceContainer,
		container.ID,
	)
	if err != nil {
		return mapDBError(fmt.Errorf("ensure container lifecycle root node: %w", err))
	}
	return nil
}

func (s *Store) getContainerLifecycleNodeByID(ctx context.Context, containerID int64, nodeID int64) (ContainerLifecycleNode, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT
			id,
			container_id,
			COALESCE(parent_node_id, 0),
			node_key,
			node_kind,
			COALESCE(title, ''),
			COALESCE(source_type, ''),
			COALESCE(source_id, 0),
			COALESCE(visibility, 'BOTH'),
			sort_order,
			position_x,
			position_y,
			COALESCE(CAST(metadata_json AS CHAR), ''),
			created_at,
			updated_at
		FROM container_lifecycle_nodes
		WHERE id = ?
			AND container_id = ?
	`, nodeID, containerID)
	return scanContainerLifecycleNode(row)
}

func (s *Store) requireLifecycleNodeBelongsToContainer(ctx context.Context, containerID int64, nodeID int64) error {
	var found int
	if err := s.db.QueryRowContext(ctx, `
		SELECT 1
		FROM container_lifecycle_nodes
		WHERE id = ?
			AND container_id = ?
	`, nodeID, containerID).Scan(&found); err != nil {
		if err == sql.ErrNoRows {
			return ErrNotFound
		}
		return mapDBError(fmt.Errorf("load container lifecycle parent node: %w", err))
	}
	return nil
}

func (s *Store) nextContainerLifecycleNodeSortOrder(ctx context.Context, containerID int64) int {
	var maxSort sql.NullInt64
	if err := s.db.QueryRowContext(ctx, `
		SELECT MAX(sort_order)
		FROM container_lifecycle_nodes
		WHERE container_id = ?
	`, containerID).Scan(&maxSort); err != nil || !maxSort.Valid {
		return 10
	}
	return int(maxSort.Int64) + 10
}

func scanContainerLifecycleNode(scanner itemScanner) (ContainerLifecycleNode, error) {
	var node ContainerLifecycleNode
	var positionX sql.NullFloat64
	var positionY sql.NullFloat64
	if err := scanner.Scan(
		&node.ID,
		&node.ContainerID,
		&node.ParentNodeID,
		&node.NodeKey,
		&node.NodeKind,
		&node.Title,
		&node.SourceType,
		&node.SourceID,
		&node.Visibility,
		&node.SortOrder,
		&positionX,
		&positionY,
		&node.MetadataJSON,
		&node.CreatedAt,
		&node.UpdatedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return ContainerLifecycleNode{}, ErrNotFound
		}
		return ContainerLifecycleNode{}, fmt.Errorf("scan container lifecycle node: %w", err)
	}
	if positionX.Valid {
		value := positionX.Float64
		node.PositionX = &value
	}
	if positionY.Valid {
		value := positionY.Float64
		node.PositionY = &value
	}
	return node, nil
}

func normalizeContainerLifecycleNodeKind(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case ContainerLifecycleNodeKindContainer:
		return ContainerLifecycleNodeKindContainer
	case ContainerLifecycleNodeKindTracking:
		return ContainerLifecycleNodeKindTracking
	case ContainerLifecycleNodeKindPickup:
		return ContainerLifecycleNodeKindPickup
	case ContainerLifecycleNodeKindReceiving:
		return ContainerLifecycleNodeKindReceiving
	case ContainerLifecycleNodeKindInventory:
		return ContainerLifecycleNodeKindInventory
	case ContainerLifecycleNodeKindTransfer:
		return ContainerLifecycleNodeKindTransfer
	case ContainerLifecycleNodeKindPickingOrder:
		return ContainerLifecycleNodeKindPickingOrder
	case ContainerLifecycleNodeKindDelivery:
		return ContainerLifecycleNodeKindDelivery
	default:
		return ""
	}
}

func normalizeContainerLifecycleNodeSourceType(value string) string {
	normalized := strings.ToUpper(strings.TrimSpace(value))
	switch normalized {
	case "", ContainerLifecycleNodeSourceContainer, ContainerLifecycleNodeSourceTrackingEvent, ContainerLifecycleNodeSourcePickup, ContainerLifecycleNodeSourceInbound, ContainerLifecycleNodeSourceOutbound, ContainerLifecycleNodeSourceDelivery, ContainerLifecycleNodeSourceStockLifecycle:
		return normalized
	default:
		return normalized
	}
}

func nullableFloat64(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}
