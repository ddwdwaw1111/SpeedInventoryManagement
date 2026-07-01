package service

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

const (
	ContainerStatusTrackingReceived = "TRACKING_RECEIVED"
	ContainerStatusPickupAssigned   = "PICKUP_ASSIGNED"
	ContainerStatusPickedUp         = "PICKED_UP"

	LifecycleEventVisibilityCustomer = "CUSTOMER"
	LifecycleEventVisibilityInternal = "INTERNAL"
	LifecycleEventVisibilityBoth     = "BOTH"

	DeliveryEventDispatched  = "DISPATCHED"
	DeliveryEventBOLReceived = "BOL_RECEIVED"
)

type Container struct {
	ID                int64      `json:"id"`
	CustomerID        int64      `json:"customerId"`
	CustomerName      string     `json:"customerName"`
	InboundDocumentID int64      `json:"inboundDocumentId"`
	LocationID        int64      `json:"locationId"`
	LocationName      string     `json:"locationName"`
	ContainerNo       string     `json:"containerNo"`
	ContainerType     string     `json:"containerType"`
	HandlingMode      string     `json:"handlingMode"`
	Status            string     `json:"status"`
	TrackingStatus    string     `json:"trackingStatus"`
	LastEventAt       *time.Time `json:"lastEventAt"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
}

type CreateContainerInput struct {
	CustomerID        int64  `json:"customerId"`
	InboundDocumentID int64  `json:"inboundDocumentId"`
	LocationID        int64  `json:"locationId"`
	ContainerNo       string `json:"containerNo"`
	ContainerType     string `json:"containerType"`
	HandlingMode      string `json:"handlingMode"`
	Status            string `json:"status"`
	TrackingStatus    string `json:"trackingStatus"`
	LastEventAt       string `json:"lastEventAt"`
}

type ContainerFilters struct {
	ID         int64
	CustomerID int64
	Search     string
}

type CreateContainerTrackingEventInput struct {
	CustomerID      int64  `json:"customerId"`
	ContainerID     int64  `json:"containerId"`
	ContainerNo     string `json:"containerNo"`
	EventType       string `json:"eventType"`
	EventTime       string `json:"eventTime"`
	Location        string `json:"location"`
	Notes           string `json:"notes"`
	Visibility      string `json:"visibility"`
	DisplayLabel    string `json:"displayLabel"`
	PublicStatus    string `json:"publicStatus"`
	PublicLabel     string `json:"publicLabel"`
	InternalStatus  string `json:"internalStatus"`
	InternalLabel   string `json:"internalLabel"`
	CreatedByUserID int64  `json:"createdByUserId"`
}

type ContainerTrackingEvent struct {
	ID              int64     `json:"id"`
	ContainerID     int64     `json:"containerId"`
	CustomerID      int64     `json:"customerId"`
	CustomerName    string    `json:"customerName"`
	ContainerNo     string    `json:"containerNo"`
	EventType       string    `json:"eventType"`
	EventTime       time.Time `json:"eventTime"`
	Location        string    `json:"location"`
	Notes           string    `json:"notes"`
	Visibility      string    `json:"visibility"`
	DisplayLabel    string    `json:"displayLabel"`
	PublicStatus    string    `json:"publicStatus"`
	PublicLabel     string    `json:"publicLabel"`
	InternalStatus  string    `json:"internalStatus"`
	InternalLabel   string    `json:"internalLabel"`
	CreatedByUserID int64     `json:"createdByUserId"`
	CreatedAt       time.Time `json:"createdAt"`
}

type ContainerTrackingEventFilters struct {
	ContainerID int64
	CustomerID  int64
	ContainerNo string
}

type CreateContainerPickupAssignmentInput struct {
	CustomerID        int64   `json:"customerId"`
	ContainerID       int64   `json:"containerId"`
	ContainerNo       string  `json:"containerNo"`
	AssignmentType    string  `json:"assignmentType"`
	DriverName        string  `json:"driverName"`
	VendorName        string  `json:"vendorName"`
	Phone             string  `json:"phone"`
	ScheduledPickupAt string  `json:"scheduledPickupAt"`
	ActualPickupAt    string  `json:"actualPickupAt"`
	Cost              float64 `json:"cost"`
	Status            string  `json:"status"`
	Notes             string  `json:"notes"`
	Visibility        string  `json:"visibility"`
	DisplayLabel      string  `json:"displayLabel"`
	PublicStatus      string  `json:"publicStatus"`
	PublicLabel       string  `json:"publicLabel"`
	InternalStatus    string  `json:"internalStatus"`
	InternalLabel     string  `json:"internalLabel"`
	CreatedByUserID   int64   `json:"createdByUserId"`
}

type ContainerPickupAssignment struct {
	ID                int64      `json:"id"`
	ContainerID       int64      `json:"containerId"`
	CustomerID        int64      `json:"customerId"`
	CustomerName      string     `json:"customerName"`
	ContainerNo       string     `json:"containerNo"`
	AssignmentType    string     `json:"assignmentType"`
	DriverName        string     `json:"driverName"`
	VendorName        string     `json:"vendorName"`
	Phone             string     `json:"phone"`
	ScheduledPickupAt *time.Time `json:"scheduledPickupAt"`
	ActualPickupAt    *time.Time `json:"actualPickupAt"`
	Cost              float64    `json:"cost"`
	Status            string     `json:"status"`
	Notes             string     `json:"notes"`
	Visibility        string     `json:"visibility"`
	DisplayLabel      string     `json:"displayLabel"`
	PublicStatus      string     `json:"publicStatus"`
	PublicLabel       string     `json:"publicLabel"`
	InternalStatus    string     `json:"internalStatus"`
	InternalLabel     string     `json:"internalLabel"`
	CreatedByUserID   int64      `json:"createdByUserId"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
}

type ContainerPickupAssignmentFilters struct {
	ContainerID int64
	CustomerID  int64
	ContainerNo string
}

type CreateDeliveryEventInput struct {
	OutboundDocumentID int64  `json:"outboundDocumentId"`
	CustomerID         int64  `json:"customerId"`
	ContainerID        int64  `json:"containerId"`
	ContainerNo        string `json:"containerNo"`
	EventType          string `json:"eventType"`
	EventTime          string `json:"eventTime"`
	DriverName         string `json:"driverName"`
	VendorName         string `json:"vendorName"`
	VehicleNo          string `json:"vehicleNo"`
	BOLNumber          string `json:"bolNumber"`
	Notes              string `json:"notes"`
	Visibility         string `json:"visibility"`
	DisplayLabel       string `json:"displayLabel"`
	PublicStatus       string `json:"publicStatus"`
	PublicLabel        string `json:"publicLabel"`
	InternalStatus     string `json:"internalStatus"`
	InternalLabel      string `json:"internalLabel"`
}

type DeliveryEvent struct {
	ID                 int64      `json:"id"`
	OutboundDocumentID int64      `json:"outboundDocumentId"`
	CustomerID         int64      `json:"customerId"`
	CustomerName       string     `json:"customerName"`
	ContainerID        int64      `json:"containerId"`
	ContainerNo        string     `json:"containerNo"`
	EventType          string     `json:"eventType"`
	EventTime          time.Time  `json:"eventTime"`
	DriverName         string     `json:"driverName"`
	VendorName         string     `json:"vendorName"`
	VehicleNo          string     `json:"vehicleNo"`
	BOLNumber          string     `json:"bolNumber"`
	BOLReceivedAt      *time.Time `json:"bolReceivedAt"`
	Notes              string     `json:"notes"`
	Visibility         string     `json:"visibility"`
	DisplayLabel       string     `json:"displayLabel"`
	PublicStatus       string     `json:"publicStatus"`
	PublicLabel        string     `json:"publicLabel"`
	InternalStatus     string     `json:"internalStatus"`
	InternalLabel      string     `json:"internalLabel"`
	CreatedAt          time.Time  `json:"createdAt"`
	UpdatedAt          time.Time  `json:"updatedAt"`
}

type DeliveryEventFilters struct {
	ContainerID int64
	CustomerID  int64
	ContainerNo string
}

func (s *Store) ensureContainerRecordTx(
	ctx context.Context,
	tx *sql.Tx,
	customerID int64,
	inboundDocumentID int64,
	locationID int64,
	containerNo string,
	containerType string,
	handlingMode string,
	status string,
	trackingStatus string,
	lastEventAt *time.Time,
) (int64, error) {
	normalizedContainerNo := normalizeContainerNo(containerNo)
	if customerID <= 0 || normalizedContainerNo == "" {
		return 0, nil
	}
	normalizedStatus := strings.ToUpper(strings.TrimSpace(status))
	normalizedTrackingStatus := strings.ToUpper(strings.TrimSpace(trackingStatus))
	if normalizedTrackingStatus == "" {
		normalizedTrackingStatus = normalizedStatus
	}
	normalizedStatus = firstNonEmpty(normalizedStatus, "IN_STOCK")
	normalizedTrackingStatus = firstNonEmpty(normalizedTrackingStatus, normalizedStatus, "RECEIVED")

	result, err := tx.ExecContext(ctx, `
		INSERT INTO containers (
			customer_id,
			inbound_document_id,
			location_id,
			container_no,
			container_type,
			handling_mode,
			status,
			tracking_status,
			last_event_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			id = LAST_INSERT_ID(id),
			inbound_document_id = COALESCE(VALUES(inbound_document_id), inbound_document_id),
			location_id = COALESCE(VALUES(location_id), location_id),
			container_type = COALESCE(NULLIF(VALUES(container_type), ''), container_type),
			handling_mode = COALESCE(NULLIF(VALUES(handling_mode), ''), handling_mode),
			status = COALESCE(NULLIF(VALUES(status), ''), status),
			tracking_status = COALESCE(NULLIF(VALUES(tracking_status), ''), tracking_status),
			last_event_at = CASE
				WHEN VALUES(last_event_at) IS NULL THEN last_event_at
				WHEN last_event_at IS NULL OR VALUES(last_event_at) > last_event_at THEN VALUES(last_event_at)
				ELSE last_event_at
			END
	`,
		customerID,
		nullableInt64(inboundDocumentID),
		nullableInt64(locationID),
		normalizedContainerNo,
		firstNonEmpty(normalizeContainerType(containerType), ContainerTypeNormal),
		firstNonEmpty(normalizeInboundHandlingMode(handlingMode), InboundHandlingModePalletized),
		normalizedStatus,
		normalizedTrackingStatus,
		nullableTime(lastEventAt),
	)
	if err != nil {
		return 0, mapDBError(fmt.Errorf("ensure container record: %w", err))
	}
	containerID, err := result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("resolve container id: %w", err)
	}
	return containerID, nil
}

func (s *Store) syncContainerNumberTx(ctx context.Context, tx *sql.Tx, containerID int64, customerID int64, locationID int64, containerNo string) error {
	containerNo = normalizeContainerNo(containerNo)
	if containerID <= 0 || customerID <= 0 || containerNo == "" {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE containers
		SET
			container_no = ?,
			location_id = COALESCE(?, location_id),
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
			AND customer_id = ?
	`, containerNo, nullableInt64(locationID), containerID, customerID); err != nil {
		return mapDBError(fmt.Errorf("sync container number: %w", err))
	}
	return nil
}

func (s *Store) syncContainerDocumentLinkTx(ctx context.Context, tx *sql.Tx, containerID int64, inboundDocumentID int64, locationID int64) error {
	if containerID <= 0 || inboundDocumentID <= 0 {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE containers
		SET
			inbound_document_id = ?,
			location_id = COALESCE(?, location_id),
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, inboundDocumentID, nullableInt64(locationID), containerID); err != nil {
		return mapDBError(fmt.Errorf("sync container document link: %w", err))
	}
	return nil
}

func (s *Store) CreateContainer(ctx context.Context, input CreateContainerInput) (Container, error) {
	customerID := input.CustomerID
	containerNo := normalizeContainerNo(input.ContainerNo)
	if customerID <= 0 || containerNo == "" {
		return Container{}, ErrInvalidInput
	}
	if input.InboundDocumentID > 0 {
		document, err := s.getInboundDocument(ctx, input.InboundDocumentID)
		if err != nil {
			return Container{}, err
		}
		if document.CustomerID != customerID {
			return Container{}, fmt.Errorf("%w: container inbound document must belong to the same customer", ErrInvalidInput)
		}
		if documentContainerNo := normalizeContainerNo(document.ContainerNo); documentContainerNo != "" && documentContainerNo != containerNo {
			return Container{}, fmt.Errorf("%w: container number must match inbound document container number", ErrInvalidInput)
		}
	}
	lastEventAt, err := parseOptionalDateTime(input.LastEventAt)
	if err != nil {
		return Container{}, err
	}
	containerTypeInput := normalizeContainerType(input.ContainerType)
	handlingModeInput := normalizeInboundHandlingMode(input.HandlingMode)
	statusInput := strings.ToUpper(strings.TrimSpace(input.Status))
	trackingStatusInput := strings.ToUpper(strings.TrimSpace(input.TrackingStatus))
	if trackingStatusInput == "" && statusInput != "" {
		trackingStatusInput = statusInput
	}
	status := firstNonEmpty(statusInput, ContainerStatusTrackingReceived)
	trackingStatus := firstNonEmpty(trackingStatusInput, status)

	result, err := s.db.ExecContext(ctx, `
		INSERT INTO containers (
			customer_id,
			inbound_document_id,
			location_id,
			container_no,
			container_type,
			handling_mode,
			status,
			tracking_status,
			last_event_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			id = LAST_INSERT_ID(id),
			inbound_document_id = COALESCE(VALUES(inbound_document_id), inbound_document_id),
			location_id = COALESCE(VALUES(location_id), location_id),
			container_type = COALESCE(NULLIF(?, ''), container_type),
			handling_mode = COALESCE(NULLIF(?, ''), handling_mode),
			status = COALESCE(NULLIF(?, ''), status),
			tracking_status = COALESCE(NULLIF(?, ''), tracking_status),
			last_event_at = CASE
				WHEN VALUES(last_event_at) IS NULL THEN last_event_at
				WHEN last_event_at IS NULL OR VALUES(last_event_at) > last_event_at THEN VALUES(last_event_at)
				ELSE last_event_at
			END
	`,
		customerID,
		nullableInt64(input.InboundDocumentID),
		nullableInt64(input.LocationID),
		containerNo,
		firstNonEmpty(containerTypeInput, ContainerTypeNormal),
		firstNonEmpty(handlingModeInput, InboundHandlingModePalletized),
		status,
		trackingStatus,
		nullableTime(lastEventAt),
		containerTypeInput,
		handlingModeInput,
		statusInput,
		trackingStatusInput,
	)
	if err != nil {
		return Container{}, mapDBError(fmt.Errorf("create container: %w", err))
	}
	containerID, err := result.LastInsertId()
	if err != nil {
		return Container{}, fmt.Errorf("resolve container id: %w", err)
	}
	return s.getContainerByID(ctx, containerID)
}

func (s *Store) ListContainerRecords(ctx context.Context, limit int, filters ContainerFilters) ([]Container, error) {
	if limit <= 0 {
		limit = 1000
	}
	whereClauses := []string{"1 = 1"}
	args := make([]any, 0)
	if filters.ID > 0 {
		whereClauses = append(whereClauses, "cn.id = ?")
		args = append(args, filters.ID)
	}
	if filters.CustomerID > 0 {
		whereClauses = append(whereClauses, "cn.customer_id = ?")
		args = append(args, filters.CustomerID)
	}
	if search := strings.TrimSpace(strings.ToLower(filters.Search)); search != "" {
		whereClauses = append(whereClauses, `(LOWER(cn.container_no) LIKE ? OR LOWER(c.name) LIKE ? OR LOWER(COALESCE(l.name, '')) LIKE ?)`)
		like := "%" + search + "%"
		args = append(args, like, like, like)
	}
	query := fmt.Sprintf(`
		SELECT
			cn.id,
			cn.customer_id,
			c.name,
			COALESCE(cn.inbound_document_id, 0),
			COALESCE(cn.location_id, 0),
			COALESCE(l.name, ''),
			cn.container_no,
			cn.container_type,
			cn.handling_mode,
			cn.status,
			cn.tracking_status,
			cn.last_event_at,
			cn.created_at,
			cn.updated_at
		FROM containers cn
		JOIN customers c ON c.id = cn.customer_id
		LEFT JOIN storage_locations l ON l.id = cn.location_id
		WHERE %s
		ORDER BY COALESCE(cn.last_event_at, cn.updated_at) DESC, cn.id DESC
		LIMIT ?
	`, strings.Join(whereClauses, "\n\t\tAND "))
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, mapDBError(fmt.Errorf("list containers: %w", err))
	}
	defer rows.Close()

	containers := make([]Container, 0)
	for rows.Next() {
		container, err := scanContainer(rows)
		if err != nil {
			return nil, err
		}
		containers = append(containers, container)
	}
	return containers, rows.Err()
}

func (s *Store) GetContainerByNo(ctx context.Context, customerID int64, containerNo string) (Container, error) {
	normalized := normalizeContainerNo(containerNo)
	if normalized == "" {
		return Container{}, ErrInvalidInput
	}
	whereClauses := []string{"UPPER(TRIM(cn.container_no)) = ?"}
	args := []any{normalized}
	if customerID > 0 {
		whereClauses = append(whereClauses, "cn.customer_id = ?")
		args = append(args, customerID)
	}
	query := fmt.Sprintf(`
		SELECT
			cn.id,
			cn.customer_id,
			c.name,
			COALESCE(cn.inbound_document_id, 0),
			COALESCE(cn.location_id, 0),
			COALESCE(l.name, ''),
			cn.container_no,
			cn.container_type,
			cn.handling_mode,
			cn.status,
			cn.tracking_status,
			cn.last_event_at,
			cn.created_at,
			cn.updated_at
		FROM containers cn
		JOIN customers c ON c.id = cn.customer_id
		LEFT JOIN storage_locations l ON l.id = cn.location_id
		WHERE %s
		ORDER BY cn.id DESC
		LIMIT 1
	`, strings.Join(whereClauses, "\n\t\tAND "))
	return scanContainer(s.db.QueryRowContext(ctx, query, args...))
}

func (s *Store) GetContainerByID(ctx context.Context, containerID int64) (Container, error) {
	if containerID <= 0 {
		return Container{}, ErrInvalidInput
	}
	return s.getContainerByID(ctx, containerID)
}

func (s *Store) CreateContainerTrackingEvent(ctx context.Context, input CreateContainerTrackingEventInput) (ContainerTrackingEvent, error) {
	customerID := input.CustomerID
	containerID := input.ContainerID
	containerNo := normalizeContainerNo(input.ContainerNo)
	if containerID > 0 {
		container, err := s.getContainerByID(ctx, containerID)
		if err != nil {
			return ContainerTrackingEvent{}, err
		}
		if customerID > 0 && customerID != container.CustomerID {
			return ContainerTrackingEvent{}, fmt.Errorf("%w: tracking customer does not match container", ErrInvalidInput)
		}
		customerID = container.CustomerID
		containerNo = normalizeContainerNo(container.ContainerNo)
	}
	eventType := firstNonEmpty(strings.ToUpper(strings.TrimSpace(input.EventType)), ContainerStatusTrackingReceived)
	if customerID <= 0 || containerNo == "" {
		return ContainerTrackingEvent{}, ErrInvalidInput
	}
	eventTime, err := parseOptionalDateTime(input.EventTime)
	if err != nil {
		return ContainerTrackingEvent{}, err
	}
	visibility := normalizeLifecycleEventVisibility(input.Visibility)
	publicStatus := firstNonEmpty(strings.ToUpper(strings.TrimSpace(input.PublicStatus)), eventType)
	internalStatus := firstNonEmpty(strings.ToUpper(strings.TrimSpace(input.InternalStatus)), eventType)
	displayLabel := strings.TrimSpace(input.DisplayLabel)
	publicLabel := firstNonEmpty(strings.TrimSpace(input.PublicLabel), displayLabel)
	internalLabel := firstNonEmpty(strings.TrimSpace(input.InternalLabel), displayLabel, strings.TrimSpace(input.Notes), publicLabel)
	container, err := s.CreateContainer(ctx, CreateContainerInput{
		CustomerID:     customerID,
		ContainerNo:    containerNo,
		Status:         eventType,
		TrackingStatus: eventType,
		LastEventAt:    input.EventTime,
	})
	if err != nil {
		return ContainerTrackingEvent{}, err
	}
	result, err := s.db.ExecContext(ctx, `
		INSERT INTO container_tracking_events (
			container_id,
			customer_id,
			container_no,
			event_type,
			event_time,
			location,
			notes,
			visibility,
			public_status,
			public_label,
			internal_status,
			internal_label,
			created_by_user_id
		) VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		container.ID,
		input.CustomerID,
		containerNo,
		eventType,
		nullableTime(eventTime),
		nullableString(input.Location),
		nullableString(input.Notes),
		visibility,
		nullableString(publicStatus),
		nullableString(publicLabel),
		nullableString(internalStatus),
		nullableString(internalLabel),
		nullableInt64(input.CreatedByUserID),
	)
	if err != nil {
		return ContainerTrackingEvent{}, mapDBError(fmt.Errorf("create container tracking event: %w", err))
	}
	eventID, err := result.LastInsertId()
	if err != nil {
		return ContainerTrackingEvent{}, fmt.Errorf("resolve container tracking event id: %w", err)
	}
	return s.getContainerTrackingEventByID(ctx, eventID)
}

func (s *Store) ListContainerTrackingEvents(ctx context.Context, limit int, filters ContainerTrackingEventFilters) ([]ContainerTrackingEvent, error) {
	if limit <= 0 {
		limit = 1000
	}
	whereClauses := []string{"1 = 1"}
	args := make([]any, 0)
	if filters.ContainerID > 0 {
		whereClauses = append(whereClauses, "COALESCE(cte.container_id, 0) = ?")
		args = append(args, filters.ContainerID)
	}
	if filters.CustomerID > 0 {
		whereClauses = append(whereClauses, "cte.customer_id = ?")
		args = append(args, filters.CustomerID)
	}
	if containerNo := normalizeContainerNo(filters.ContainerNo); filters.ContainerID <= 0 && containerNo != "" {
		whereClauses = append(whereClauses, "UPPER(TRIM(cte.container_no)) = ?")
		args = append(args, containerNo)
	}
	query := fmt.Sprintf(`
		SELECT
			cte.id,
			COALESCE(cte.container_id, 0),
			cte.customer_id,
			c.name,
			cte.container_no,
			cte.event_type,
			cte.event_time,
			COALESCE(cte.location, ''),
			COALESCE(cte.notes, ''),
			COALESCE(cte.visibility, 'BOTH'),
			COALESCE(cte.public_status, ''),
			COALESCE(cte.public_label, ''),
			COALESCE(cte.internal_status, ''),
			COALESCE(cte.internal_label, ''),
			COALESCE(cte.created_by_user_id, 0),
			cte.created_at
		FROM container_tracking_events cte
		JOIN customers c ON c.id = cte.customer_id
		WHERE %s
		ORDER BY cte.event_time DESC, cte.id DESC
		LIMIT ?
	`, strings.Join(whereClauses, "\n\t\tAND "))
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, mapDBError(fmt.Errorf("list container tracking events: %w", err))
	}
	defer rows.Close()

	events := make([]ContainerTrackingEvent, 0)
	for rows.Next() {
		var event ContainerTrackingEvent
		if err := rows.Scan(&event.ID, &event.ContainerID, &event.CustomerID, &event.CustomerName, &event.ContainerNo, &event.EventType, &event.EventTime, &event.Location, &event.Notes, &event.Visibility, &event.PublicStatus, &event.PublicLabel, &event.InternalStatus, &event.InternalLabel, &event.CreatedByUserID, &event.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan container tracking event: %w", err)
		}
		event.DisplayLabel = lifecycleDisplayLabel(event.PublicLabel, event.InternalLabel)
		events = append(events, event)
	}
	return events, rows.Err()
}

func (s *Store) CreateContainerPickupAssignment(ctx context.Context, input CreateContainerPickupAssignmentInput) (ContainerPickupAssignment, error) {
	customerID := input.CustomerID
	containerID := input.ContainerID
	containerNo := normalizeContainerNo(input.ContainerNo)
	if containerID > 0 {
		container, err := s.getContainerByID(ctx, containerID)
		if err != nil {
			return ContainerPickupAssignment{}, err
		}
		if customerID > 0 && customerID != container.CustomerID {
			return ContainerPickupAssignment{}, fmt.Errorf("%w: pickup customer does not match container", ErrInvalidInput)
		}
		customerID = container.CustomerID
		containerNo = normalizeContainerNo(container.ContainerNo)
	}
	if customerID <= 0 || containerNo == "" {
		return ContainerPickupAssignment{}, ErrInvalidInput
	}
	scheduledPickupAt, err := parseOptionalDateTime(input.ScheduledPickupAt)
	if err != nil {
		return ContainerPickupAssignment{}, err
	}
	actualPickupAt, err := parseOptionalDateTime(input.ActualPickupAt)
	if err != nil {
		return ContainerPickupAssignment{}, err
	}
	status := firstNonEmpty(strings.ToUpper(strings.TrimSpace(input.Status)), "SCHEDULED")
	assignmentType := firstNonEmpty(strings.ToUpper(strings.TrimSpace(input.AssignmentType)), "INTERNAL")
	containerStatus := ContainerStatusPickupAssigned
	lastEventAt := input.ScheduledPickupAt
	if actualPickupAt != nil {
		containerStatus = ContainerStatusPickedUp
		lastEventAt = input.ActualPickupAt
	}
	visibility := normalizeLifecycleEventVisibility(input.Visibility)
	publicStatus := firstNonEmpty(strings.ToUpper(strings.TrimSpace(input.PublicStatus)), containerStatus)
	internalStatus := firstNonEmpty(strings.ToUpper(strings.TrimSpace(input.InternalStatus)), assignmentType)
	displayLabel := strings.TrimSpace(input.DisplayLabel)
	publicLabel := firstNonEmpty(strings.TrimSpace(input.PublicLabel), displayLabel)
	internalLabel := firstNonEmpty(strings.TrimSpace(input.InternalLabel), displayLabel, buildPickupInternalLabel(input, assignmentType, status), publicLabel)
	container, err := s.CreateContainer(ctx, CreateContainerInput{
		CustomerID:     customerID,
		ContainerNo:    containerNo,
		Status:         containerStatus,
		TrackingStatus: containerStatus,
		LastEventAt:    lastEventAt,
	})
	if err != nil {
		return ContainerPickupAssignment{}, err
	}
	result, err := s.db.ExecContext(ctx, `
		INSERT INTO container_pickup_assignments (
			container_id,
			customer_id,
			container_no,
			assignment_type,
			driver_name,
			vendor_name,
			phone,
			scheduled_pickup_at,
			actual_pickup_at,
			cost,
			status,
			notes,
			visibility,
			public_status,
			public_label,
			internal_status,
			internal_label,
			created_by_user_id
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		container.ID,
		input.CustomerID,
		containerNo,
		assignmentType,
		nullableString(input.DriverName),
		nullableString(input.VendorName),
		nullableString(input.Phone),
		nullableTime(scheduledPickupAt),
		nullableTime(actualPickupAt),
		input.Cost,
		status,
		nullableString(input.Notes),
		visibility,
		nullableString(publicStatus),
		nullableString(publicLabel),
		nullableString(internalStatus),
		nullableString(internalLabel),
		nullableInt64(input.CreatedByUserID),
	)
	if err != nil {
		return ContainerPickupAssignment{}, mapDBError(fmt.Errorf("create container pickup assignment: %w", err))
	}
	assignmentID, err := result.LastInsertId()
	if err != nil {
		return ContainerPickupAssignment{}, fmt.Errorf("resolve container pickup assignment id: %w", err)
	}
	return s.getContainerPickupAssignmentByID(ctx, assignmentID)
}

func (s *Store) ListContainerPickupAssignments(ctx context.Context, limit int, filters ContainerPickupAssignmentFilters) ([]ContainerPickupAssignment, error) {
	if limit <= 0 {
		limit = 1000
	}
	whereClauses := []string{"1 = 1"}
	args := make([]any, 0)
	if filters.ContainerID > 0 {
		whereClauses = append(whereClauses, "COALESCE(cpa.container_id, 0) = ?")
		args = append(args, filters.ContainerID)
	}
	if filters.CustomerID > 0 {
		whereClauses = append(whereClauses, "cpa.customer_id = ?")
		args = append(args, filters.CustomerID)
	}
	if containerNo := normalizeContainerNo(filters.ContainerNo); filters.ContainerID <= 0 && containerNo != "" {
		whereClauses = append(whereClauses, "UPPER(TRIM(cpa.container_no)) = ?")
		args = append(args, containerNo)
	}
	query := fmt.Sprintf(`
		SELECT
			cpa.id,
			COALESCE(cpa.container_id, 0),
			cpa.customer_id,
			c.name,
			cpa.container_no,
			cpa.assignment_type,
			COALESCE(cpa.driver_name, ''),
			COALESCE(cpa.vendor_name, ''),
			COALESCE(cpa.phone, ''),
			cpa.scheduled_pickup_at,
			cpa.actual_pickup_at,
			cpa.cost,
			cpa.status,
			COALESCE(cpa.notes, ''),
			COALESCE(cpa.visibility, 'BOTH'),
			COALESCE(cpa.public_status, ''),
			COALESCE(cpa.public_label, ''),
			COALESCE(cpa.internal_status, ''),
			COALESCE(cpa.internal_label, ''),
			COALESCE(cpa.created_by_user_id, 0),
			cpa.created_at,
			cpa.updated_at
		FROM container_pickup_assignments cpa
		JOIN customers c ON c.id = cpa.customer_id
		WHERE %s
		ORDER BY COALESCE(cpa.actual_pickup_at, cpa.scheduled_pickup_at, cpa.created_at) DESC, cpa.id DESC
		LIMIT ?
	`, strings.Join(whereClauses, "\n\t\tAND "))
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, mapDBError(fmt.Errorf("list container pickup assignments: %w", err))
	}
	defer rows.Close()

	assignments := make([]ContainerPickupAssignment, 0)
	for rows.Next() {
		var assignment ContainerPickupAssignment
		if err := rows.Scan(&assignment.ID, &assignment.ContainerID, &assignment.CustomerID, &assignment.CustomerName, &assignment.ContainerNo, &assignment.AssignmentType, &assignment.DriverName, &assignment.VendorName, &assignment.Phone, &assignment.ScheduledPickupAt, &assignment.ActualPickupAt, &assignment.Cost, &assignment.Status, &assignment.Notes, &assignment.Visibility, &assignment.PublicStatus, &assignment.PublicLabel, &assignment.InternalStatus, &assignment.InternalLabel, &assignment.CreatedByUserID, &assignment.CreatedAt, &assignment.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan container pickup assignment: %w", err)
		}
		assignment.DisplayLabel = lifecycleDisplayLabel(assignment.PublicLabel, assignment.InternalLabel)
		assignments = append(assignments, assignment)
	}
	return assignments, rows.Err()
}

func (s *Store) CreateDeliveryEvent(ctx context.Context, input CreateDeliveryEventInput) (DeliveryEvent, error) {
	eventTime, err := parseOptionalDateTime(input.EventTime)
	if err != nil {
		return DeliveryEvent{}, err
	}
	customerID, containerID, containerNo, err := s.resolveDeliveryContext(ctx, input.CustomerID, input.ContainerID, input.OutboundDocumentID, input.ContainerNo)
	if err != nil {
		return DeliveryEvent{}, err
	}
	eventType := firstNonEmpty(strings.ToUpper(strings.TrimSpace(input.EventType)), DeliveryEventDispatched)
	var bolReceivedAt *time.Time
	if eventType == DeliveryEventBOLReceived {
		if eventTime == nil {
			now := time.Now().UTC()
			eventTime = &now
		}
		bolReceivedAt = eventTime
	}
	visibility := normalizeLifecycleEventVisibility(input.Visibility)
	publicStatus := firstNonEmpty(strings.ToUpper(strings.TrimSpace(input.PublicStatus)), eventType)
	internalStatus := firstNonEmpty(strings.ToUpper(strings.TrimSpace(input.InternalStatus)), eventType)
	displayLabel := strings.TrimSpace(input.DisplayLabel)
	publicLabel := firstNonEmpty(strings.TrimSpace(input.PublicLabel), displayLabel)
	internalLabel := firstNonEmpty(strings.TrimSpace(input.InternalLabel), displayLabel, buildDeliveryInternalLabel(input, eventType), publicLabel)
	result, err := s.db.ExecContext(ctx, `
		INSERT INTO delivery_events (
			outbound_document_id,
			customer_id,
			container_id,
			container_no,
			event_type,
			event_time,
			driver_name,
			vendor_name,
			vehicle_no,
			bol_number,
			bol_received_at,
			notes,
			visibility,
			public_status,
			public_label,
			internal_status,
			internal_label
		) VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		nullableInt64(input.OutboundDocumentID),
		nullableInt64(customerID),
		containerID,
		containerNo,
		eventType,
		nullableTime(eventTime),
		nullableString(input.DriverName),
		nullableString(input.VendorName),
		nullableString(input.VehicleNo),
		nullableString(input.BOLNumber),
		nullableTime(bolReceivedAt),
		nullableString(input.Notes),
		visibility,
		nullableString(publicStatus),
		nullableString(publicLabel),
		nullableString(internalStatus),
		nullableString(internalLabel),
	)
	if err != nil {
		return DeliveryEvent{}, mapDBError(fmt.Errorf("create delivery event: %w", err))
	}
	eventID, err := result.LastInsertId()
	if err != nil {
		return DeliveryEvent{}, fmt.Errorf("resolve delivery event id: %w", err)
	}
	return s.getDeliveryEventByID(ctx, eventID)
}

func (s *Store) ReceiveDeliveryBOL(ctx context.Context, deliveryEventID int64, input CreateDeliveryEventInput) (DeliveryEvent, error) {
	if deliveryEventID <= 0 {
		return DeliveryEvent{}, ErrInvalidInput
	}
	existing, err := s.getDeliveryEventByID(ctx, deliveryEventID)
	if err != nil {
		return DeliveryEvent{}, err
	}
	return s.CreateDeliveryEvent(ctx, CreateDeliveryEventInput{
		OutboundDocumentID: existing.OutboundDocumentID,
		CustomerID:         existing.CustomerID,
		ContainerID:        existing.ContainerID,
		ContainerNo:        existing.ContainerNo,
		EventType:          DeliveryEventBOLReceived,
		EventTime:          input.EventTime,
		DriverName:         firstNonEmpty(strings.TrimSpace(input.DriverName), existing.DriverName),
		VendorName:         firstNonEmpty(strings.TrimSpace(input.VendorName), existing.VendorName),
		VehicleNo:          firstNonEmpty(strings.TrimSpace(input.VehicleNo), existing.VehicleNo),
		BOLNumber:          firstNonEmpty(strings.TrimSpace(input.BOLNumber), existing.BOLNumber),
		Notes:              firstNonEmpty(strings.TrimSpace(input.Notes), existing.Notes),
		Visibility:         firstNonEmpty(strings.TrimSpace(input.Visibility), existing.Visibility),
		DisplayLabel:       firstNonEmpty(strings.TrimSpace(input.DisplayLabel), existing.DisplayLabel),
		PublicStatus:       input.PublicStatus,
		PublicLabel:        input.PublicLabel,
		InternalStatus:     input.InternalStatus,
		InternalLabel:      input.InternalLabel,
	})
}

func (s *Store) ListDeliveryEvents(ctx context.Context, limit int, filters DeliveryEventFilters) ([]DeliveryEvent, error) {
	if limit <= 0 {
		limit = 1000
	}
	whereClauses := []string{"1 = 1"}
	args := make([]any, 0)
	if filters.ContainerID > 0 {
		whereClauses = append(whereClauses, "COALESCE(de.container_id, 0) = ?")
		args = append(args, filters.ContainerID)
	}
	if filters.CustomerID > 0 {
		whereClauses = append(whereClauses, "de.customer_id = ?")
		args = append(args, filters.CustomerID)
	}
	if containerNo := normalizeContainerNo(filters.ContainerNo); filters.ContainerID <= 0 && containerNo != "" {
		whereClauses = append(whereClauses, "UPPER(TRIM(de.container_no)) = ?")
		args = append(args, containerNo)
	}
	query := fmt.Sprintf(`
		SELECT
			de.id,
			COALESCE(de.outbound_document_id, 0),
			COALESCE(de.customer_id, 0),
			COALESCE(c.name, ''),
			COALESCE(de.container_id, 0),
			COALESCE(de.container_no, ''),
			de.event_type,
			de.event_time,
			COALESCE(de.driver_name, ''),
			COALESCE(de.vendor_name, ''),
			COALESCE(de.vehicle_no, ''),
			COALESCE(de.bol_number, ''),
			de.bol_received_at,
			COALESCE(de.notes, ''),
			COALESCE(de.visibility, 'BOTH'),
			COALESCE(de.public_status, ''),
			COALESCE(de.public_label, ''),
			COALESCE(de.internal_status, ''),
			COALESCE(de.internal_label, ''),
			de.created_at,
			de.updated_at
		FROM delivery_events de
		LEFT JOIN customers c ON c.id = de.customer_id
		WHERE %s
		ORDER BY de.event_time DESC, de.id DESC
		LIMIT ?
	`, strings.Join(whereClauses, "\n\t\tAND "))
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, mapDBError(fmt.Errorf("list delivery events: %w", err))
	}
	defer rows.Close()
	events := make([]DeliveryEvent, 0)
	for rows.Next() {
		event, err := scanDeliveryEvent(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func (s *Store) getContainerByID(ctx context.Context, containerID int64) (Container, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT
			cn.id,
			cn.customer_id,
			c.name,
			COALESCE(cn.inbound_document_id, 0),
			COALESCE(cn.location_id, 0),
			COALESCE(l.name, ''),
			cn.container_no,
			cn.container_type,
			cn.handling_mode,
			cn.status,
			cn.tracking_status,
			cn.last_event_at,
			cn.created_at,
			cn.updated_at
		FROM containers cn
		JOIN customers c ON c.id = cn.customer_id
		LEFT JOIN storage_locations l ON l.id = cn.location_id
		WHERE cn.id = ?
	`, containerID)
	return scanContainer(row)
}

func scanContainer(scanner itemScanner) (Container, error) {
	var container Container
	if err := scanner.Scan(
		&container.ID,
		&container.CustomerID,
		&container.CustomerName,
		&container.InboundDocumentID,
		&container.LocationID,
		&container.LocationName,
		&container.ContainerNo,
		&container.ContainerType,
		&container.HandlingMode,
		&container.Status,
		&container.TrackingStatus,
		&container.LastEventAt,
		&container.CreatedAt,
		&container.UpdatedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return Container{}, ErrNotFound
		}
		return Container{}, fmt.Errorf("scan container: %w", err)
	}
	return container, nil
}

func (s *Store) getContainerTrackingEventByID(ctx context.Context, eventID int64) (ContainerTrackingEvent, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT
			cte.id,
			COALESCE(cte.container_id, 0),
			cte.customer_id,
			c.name,
			cte.container_no,
			cte.event_type,
			cte.event_time,
			COALESCE(cte.location, ''),
			COALESCE(cte.notes, ''),
			COALESCE(cte.visibility, 'BOTH'),
			COALESCE(cte.public_status, ''),
			COALESCE(cte.public_label, ''),
			COALESCE(cte.internal_status, ''),
			COALESCE(cte.internal_label, ''),
			COALESCE(cte.created_by_user_id, 0),
			cte.created_at
		FROM container_tracking_events cte
		JOIN customers c ON c.id = cte.customer_id
		WHERE cte.id = ?
	`, eventID)
	var event ContainerTrackingEvent
	if err := row.Scan(&event.ID, &event.ContainerID, &event.CustomerID, &event.CustomerName, &event.ContainerNo, &event.EventType, &event.EventTime, &event.Location, &event.Notes, &event.Visibility, &event.PublicStatus, &event.PublicLabel, &event.InternalStatus, &event.InternalLabel, &event.CreatedByUserID, &event.CreatedAt); err != nil {
		if err == sql.ErrNoRows {
			return ContainerTrackingEvent{}, ErrNotFound
		}
		return ContainerTrackingEvent{}, fmt.Errorf("scan container tracking event: %w", err)
	}
	event.DisplayLabel = lifecycleDisplayLabel(event.PublicLabel, event.InternalLabel)
	return event, nil
}

func (s *Store) getContainerPickupAssignmentByID(ctx context.Context, assignmentID int64) (ContainerPickupAssignment, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT
			cpa.id,
			COALESCE(cpa.container_id, 0),
			cpa.customer_id,
			c.name,
			cpa.container_no,
			cpa.assignment_type,
			COALESCE(cpa.driver_name, ''),
			COALESCE(cpa.vendor_name, ''),
			COALESCE(cpa.phone, ''),
			cpa.scheduled_pickup_at,
			cpa.actual_pickup_at,
			cpa.cost,
			cpa.status,
			COALESCE(cpa.notes, ''),
			COALESCE(cpa.visibility, 'BOTH'),
			COALESCE(cpa.public_status, ''),
			COALESCE(cpa.public_label, ''),
			COALESCE(cpa.internal_status, ''),
			COALESCE(cpa.internal_label, ''),
			COALESCE(cpa.created_by_user_id, 0),
			cpa.created_at,
			cpa.updated_at
		FROM container_pickup_assignments cpa
		JOIN customers c ON c.id = cpa.customer_id
		WHERE cpa.id = ?
	`, assignmentID)
	var assignment ContainerPickupAssignment
	if err := row.Scan(&assignment.ID, &assignment.ContainerID, &assignment.CustomerID, &assignment.CustomerName, &assignment.ContainerNo, &assignment.AssignmentType, &assignment.DriverName, &assignment.VendorName, &assignment.Phone, &assignment.ScheduledPickupAt, &assignment.ActualPickupAt, &assignment.Cost, &assignment.Status, &assignment.Notes, &assignment.Visibility, &assignment.PublicStatus, &assignment.PublicLabel, &assignment.InternalStatus, &assignment.InternalLabel, &assignment.CreatedByUserID, &assignment.CreatedAt, &assignment.UpdatedAt); err != nil {
		if err == sql.ErrNoRows {
			return ContainerPickupAssignment{}, ErrNotFound
		}
		return ContainerPickupAssignment{}, fmt.Errorf("scan container pickup assignment: %w", err)
	}
	assignment.DisplayLabel = lifecycleDisplayLabel(assignment.PublicLabel, assignment.InternalLabel)
	return assignment, nil
}

func (s *Store) resolveDeliveryContext(ctx context.Context, customerID int64, containerID int64, outboundDocumentID int64, containerNo string) (int64, int64, string, error) {
	normalizedContainerNo := normalizeContainerNo(containerNo)
	if containerID > 0 {
		container, err := s.getContainerByID(ctx, containerID)
		if err != nil {
			return 0, 0, "", err
		}
		if customerID > 0 && customerID != container.CustomerID {
			return 0, 0, "", fmt.Errorf("%w: delivery customer does not match container", ErrInvalidInput)
		}
		customerID = container.CustomerID
		normalizedContainerNo = normalizeContainerNo(container.ContainerNo)
	}
	if outboundDocumentID <= 0 {
		if customerID <= 0 || (containerID <= 0 && normalizedContainerNo == "") {
			return 0, 0, "", ErrInvalidInput
		}
		return customerID, containerID, normalizedContainerNo, nil
	}

	document, err := s.getOutboundDocument(ctx, outboundDocumentID)
	if err != nil {
		return 0, 0, "", err
	}
	if customerID > 0 && customerID != document.CustomerID {
		return 0, 0, "", fmt.Errorf("%w: delivery customer does not match outbound document", ErrInvalidInput)
	}
	if containerID > 0 {
		if !outboundDocumentReferencesContainer(document, containerID, normalizedContainerNo) {
			return 0, 0, "", fmt.Errorf("%w: delivery container does not match outbound document allocations", ErrInvalidInput)
		}
		return document.CustomerID, containerID, normalizedContainerNo, nil
	}

	containerRefs := outboundDocumentContainerRefs(document)
	if normalizedContainerNo == "" {
		switch len(containerRefs) {
		case 1:
			containerID = containerRefs[0].ContainerID
			normalizedContainerNo = containerRefs[0].ContainerNo
		case 0:
			return 0, 0, "", fmt.Errorf("%w: delivery container is required when outbound document has no container allocations", ErrInvalidInput)
		default:
			return 0, 0, "", fmt.Errorf("%w: delivery container is required when outbound document spans multiple containers", ErrInvalidInput)
		}
	} else {
		if !outboundDocumentReferencesContainer(document, 0, normalizedContainerNo) {
			return 0, 0, "", fmt.Errorf("%w: delivery container does not match outbound document allocations", ErrInvalidInput)
		}
		for _, ref := range containerRefs {
			if ref.ContainerID > 0 && ref.ContainerNo == normalizedContainerNo {
				if containerID > 0 && containerID != ref.ContainerID {
					containerID = 0
					break
				}
				containerID = ref.ContainerID
			}
		}
	}
	return document.CustomerID, containerID, normalizedContainerNo, nil
}

func (s *Store) getDeliveryEventByID(ctx context.Context, eventID int64) (DeliveryEvent, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT
			de.id,
			COALESCE(de.outbound_document_id, 0),
			COALESCE(de.customer_id, 0),
			COALESCE(c.name, ''),
			COALESCE(de.container_id, 0),
			COALESCE(de.container_no, ''),
			de.event_type,
			de.event_time,
			COALESCE(de.driver_name, ''),
			COALESCE(de.vendor_name, ''),
			COALESCE(de.vehicle_no, ''),
			COALESCE(de.bol_number, ''),
			de.bol_received_at,
			COALESCE(de.notes, ''),
			COALESCE(de.visibility, 'BOTH'),
			COALESCE(de.public_status, ''),
			COALESCE(de.public_label, ''),
			COALESCE(de.internal_status, ''),
			COALESCE(de.internal_label, ''),
			de.created_at,
			de.updated_at
		FROM delivery_events de
		LEFT JOIN customers c ON c.id = de.customer_id
		WHERE de.id = ?
	`, eventID)
	event, err := scanDeliveryEvent(row)
	if err != nil {
		return DeliveryEvent{}, err
	}
	event.DisplayLabel = lifecycleDisplayLabel(event.PublicLabel, event.InternalLabel)
	return event, nil
}

func scanDeliveryEvent(scanner itemScanner) (DeliveryEvent, error) {
	var event DeliveryEvent
	if err := scanner.Scan(
		&event.ID,
		&event.OutboundDocumentID,
		&event.CustomerID,
		&event.CustomerName,
		&event.ContainerID,
		&event.ContainerNo,
		&event.EventType,
		&event.EventTime,
		&event.DriverName,
		&event.VendorName,
		&event.VehicleNo,
		&event.BOLNumber,
		&event.BOLReceivedAt,
		&event.Notes,
		&event.Visibility,
		&event.PublicStatus,
		&event.PublicLabel,
		&event.InternalStatus,
		&event.InternalLabel,
		&event.CreatedAt,
		&event.UpdatedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return DeliveryEvent{}, ErrNotFound
		}
		return DeliveryEvent{}, fmt.Errorf("scan delivery event: %w", err)
	}
	return event, nil
}

func normalizeLifecycleEventVisibility(value string) string {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case LifecycleEventVisibilityCustomer:
		return LifecycleEventVisibilityCustomer
	case LifecycleEventVisibilityBoth, "PUBLIC":
		return LifecycleEventVisibilityBoth
	case LifecycleEventVisibilityInternal:
		return LifecycleEventVisibilityInternal
	default:
		return LifecycleEventVisibilityBoth
	}
}

func lifecycleDisplayLabel(publicLabel string, internalLabel string) string {
	return firstNonEmpty(strings.TrimSpace(publicLabel), strings.TrimSpace(internalLabel))
}

func buildPickupInternalLabel(input CreateContainerPickupAssignmentInput, assignmentType string, status string) string {
	parts := []string{assignmentType, status}
	if trimmed := strings.TrimSpace(input.DriverName); trimmed != "" {
		parts = append(parts, trimmed)
	}
	if trimmed := strings.TrimSpace(input.VendorName); trimmed != "" {
		parts = append(parts, trimmed)
	}
	if input.Cost > 0 {
		parts = append(parts, fmt.Sprintf("$%.2f", input.Cost))
	}
	return strings.Join(nonEmptyStrings(parts...), " / ")
}

func buildDeliveryInternalLabel(input CreateDeliveryEventInput, eventType string) string {
	parts := []string{eventType}
	if trimmed := strings.TrimSpace(input.DriverName); trimmed != "" {
		parts = append(parts, trimmed)
	}
	if trimmed := strings.TrimSpace(input.VendorName); trimmed != "" {
		parts = append(parts, trimmed)
	}
	if trimmed := strings.TrimSpace(input.VehicleNo); trimmed != "" {
		parts = append(parts, trimmed)
	}
	if trimmed := strings.TrimSpace(input.BOLNumber); trimmed != "" {
		parts = append(parts, trimmed)
	}
	return strings.Join(nonEmptyStrings(parts...), " / ")
}

func nonEmptyStrings(values ...string) []string {
	filtered := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			filtered = append(filtered, trimmed)
		}
	}
	return filtered
}
