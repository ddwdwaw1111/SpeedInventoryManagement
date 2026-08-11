package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

const inboundDeletionRollbackSource = "CASCADE_DELETE"

type InboundDeletionDependency struct {
	SourceType         string     `json:"sourceType"`
	DocumentID         int64      `json:"documentId"`
	Reference          string     `json:"reference"`
	ActivityAt         *time.Time `json:"activityAt"`
	LastLedgerID       int64      `json:"lastLedgerId"`
	AffectedQty        int        `json:"affectedQty"`
	AffectedPallets    float64    `json:"affectedPallets"`
	AffectedContainers []string   `json:"affectedContainers,omitempty"`
	Reversible         bool       `json:"reversible"`
	BlockingReason     string     `json:"blockingReason,omitempty"`
	IncludesTransfer   bool       `json:"includesTransfer,omitempty"`
}

type InboundDeletionImpact struct {
	DocumentID      int64                       `json:"documentId"`
	ContainerNo     string                      `json:"containerNo"`
	HasDependencies bool                        `json:"hasDependencies"`
	CanExecute      bool                        `json:"canExecute"`
	Dependencies    []InboundDeletionDependency `json:"dependencies"`
}

type InboundDeletionSelection struct {
	SourceType   string `json:"sourceType"`
	DocumentID   int64  `json:"documentId"`
	LastLedgerID int64  `json:"lastLedgerId"`
}

type DeleteInboundWithDependenciesInput struct {
	Dependencies []InboundDeletionSelection `json:"dependencies"`
}

type DeleteInboundWithDependenciesResponse struct {
	DocumentID                  int64                       `json:"documentId"`
	ContainerNo                 string                      `json:"containerNo"`
	DeletedAt                   time.Time                   `json:"deletedAt"`
	DeletedDependencies         []InboundDeletionDependency `json:"deletedDependencies"`
	DeletedImplicitDependencies []InboundDeletionDependency `json:"deletedImplicitDependencies,omitempty"`
}

type inboundDeletionLedgerRow struct {
	ID                  int64
	EventType           string
	OccurredAt          sql.NullTime
	CreatedAt           time.Time
	SKUMasterID         sql.NullInt64
	CustomerID          int64
	ContainerID         sql.NullInt64
	LocationID          int64
	StorageSection      string
	QuantityChange      int
	PalletChange        float64
	SourceDocumentType  string
	SourceDocumentID    sql.NullInt64
	SourceLineID        sql.NullInt64
	ContainerNo         string
	ItemNumber          string
	DescriptionSnapshot string
}

type inboundDeletionDependencyGroup struct {
	SourceType       string
	DocumentID       int64
	LastLedgerID     int64
	ActivityAt       time.Time
	PositiveQty      int
	NegativeQty      int
	PositivePallets  float64
	NegativePallets  float64
	CoveredTransfers map[int64]struct{}
	Containers       map[string]struct{}
}

func (s *Store) PreviewInboundDeletion(ctx context.Context, documentID int64) (InboundDeletionImpact, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return InboundDeletionImpact{}, fmt.Errorf("begin inbound deletion preview: %w", err)
	}
	defer tx.Rollback()

	document, err := s.loadInboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return InboundDeletionImpact{}, err
	}
	return s.buildInboundDeletionImpactTx(ctx, tx, document)
}

func (s *Store) DeleteInboundWithDependencies(
	ctx context.Context,
	documentID int64,
	input DeleteInboundWithDependenciesInput,
) (DeleteInboundWithDependenciesResponse, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return DeleteInboundWithDependenciesResponse{}, fmt.Errorf("begin inbound dependency deletion: %w", err)
	}
	defer tx.Rollback()

	document, err := s.loadInboundDocumentForUpdateTx(ctx, tx, documentID)
	if err != nil {
		return DeleteInboundWithDependenciesResponse{}, err
	}
	if normalizeDocumentStatus(document.Status) == DocumentStatusDeleted {
		return DeleteInboundWithDependenciesResponse{}, fmt.Errorf("%w: inbound document is already deleted", ErrInvalidInput)
	}
	if err := lockBillingSourceCustomersTx(ctx, tx, []int64{document.CustomerID}); err != nil {
		return DeleteInboundWithDependenciesResponse{}, err
	}

	impact, err := s.buildInboundDeletionImpactTx(ctx, tx, document)
	if err != nil {
		return DeleteInboundWithDependenciesResponse{}, err
	}
	if !impact.CanExecute {
		return DeleteInboundWithDependenciesResponse{}, fmt.Errorf("%w: one or more later activities cannot be rolled back", ErrInvalidInput)
	}
	if err := validateInboundDeletionSelections(impact.Dependencies, input.Dependencies); err != nil {
		return DeleteInboundWithDependenciesResponse{}, err
	}

	coveredSources, err := s.inboundDeletionCoveredSourcesTx(ctx, tx, document, impact.Dependencies)
	if err != nil {
		return DeleteInboundWithDependenciesResponse{}, err
	}
	ledgerRows, err := s.loadInboundDeletionLedgerRowsTx(ctx, tx, coveredSources)
	if err != nil {
		return DeleteInboundWithDependenciesResponse{}, err
	}
	if err := ensureInboundDeletionBillingMutationsAllowedTx(ctx, tx, ledgerRows); err != nil {
		return DeleteInboundWithDependenciesResponse{}, err
	}

	rollbackAt := time.Now().UTC()
	containerIDs := make(map[int64]struct{})
	for _, row := range ledgerRows {
		if row.ContainerID.Valid && row.ContainerID.Int64 > 0 {
			containerIDs[row.ContainerID.Int64] = struct{}{}
		}
		if err := s.reverseInboundDeletionLedgerRowTx(ctx, tx, document.ID, row, rollbackAt); err != nil {
			return DeleteInboundWithDependenciesResponse{}, fmt.Errorf("rollback %s %d: %w", strings.ToLower(row.SourceDocumentType), row.SourceDocumentID.Int64, err)
		}
	}

	for _, dependency := range impact.Dependencies {
		if err := s.hardDeleteInboundDependencyTx(ctx, tx, dependency.SourceType, dependency.DocumentID); err != nil {
			return DeleteInboundWithDependenciesResponse{}, fmt.Errorf("delete %s %s: %w", strings.ToLower(dependency.SourceType), dependency.Reference, err)
		}
	}
	implicitDependencies := make([]InboundDeletionDependency, 0)
	for source := range coveredSources {
		if source.SourceType == StockLedgerSourceTransfer && !containsInboundDeletionDependency(impact.Dependencies, source) {
			group, err := s.expandInboundDeletionDependencyGroupTx(ctx, tx, inboundDeletionDependencyGroup{
				SourceType: source.SourceType,
				DocumentID: source.DocumentID,
			})
			if err != nil {
				return DeleteInboundWithDependenciesResponse{}, err
			}
			dependency, err := s.describeInboundDeletionDependencyTx(ctx, tx, group)
			if err != nil {
				return DeleteInboundWithDependenciesResponse{}, err
			}
			implicitDependencies = append(implicitDependencies, dependency)
			if err := s.hardDeleteInboundDependencyTx(ctx, tx, source.SourceType, source.DocumentID); err != nil {
				return DeleteInboundWithDependenciesResponse{}, fmt.Errorf("delete automatic transfer %d: %w", source.DocumentID, err)
			}
		}
	}
	if err := s.hardDeleteInboundDocumentArtifactsTx(ctx, tx, document); err != nil {
		return DeleteInboundWithDependenciesResponse{}, err
	}
	if err := deleteStockLedgerForDocumentTx(ctx, tx, inboundDeletionRollbackSource, document.ID); err != nil {
		return DeleteInboundWithDependenciesResponse{}, err
	}
	for _, row := range ledgerRows {
		if strings.TrimSpace(row.ContainerNo) == "" {
			continue
		}
		var containerID int64
		err := tx.QueryRowContext(ctx, `
			SELECT id
			FROM containers
			WHERE customer_id = ?
			  AND UPPER(TRIM(container_no)) = ?
		`, row.CustomerID, normalizeContainerNo(row.ContainerNo)).Scan(&containerID)
		if err == nil && containerID > 0 {
			containerIDs[containerID] = struct{}{}
		} else if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return DeleteInboundWithDependenciesResponse{}, mapDBError(fmt.Errorf("resolve rolled-back container projection: %w", err))
		}
	}
	for containerID := range containerIDs {
		if err := s.recomputeContainerProjectionTx(ctx, tx, containerID); err != nil {
			return DeleteInboundWithDependenciesResponse{}, err
		}
	}
	if err := purgeEmptyInboundContainerProjectionTx(ctx, tx, document); err != nil {
		return DeleteInboundWithDependenciesResponse{}, err
	}

	if err := tx.Commit(); err != nil {
		return DeleteInboundWithDependenciesResponse{}, fmt.Errorf("commit inbound dependency deletion: %w", err)
	}
	return DeleteInboundWithDependenciesResponse{
		DocumentID:                  document.ID,
		ContainerNo:                 document.ContainerNo,
		DeletedAt:                   rollbackAt,
		DeletedDependencies:         impact.Dependencies,
		DeletedImplicitDependencies: implicitDependencies,
	}, nil
}

type inboundDeletionSourceKey struct {
	SourceType string
	DocumentID int64
}

func (s *Store) buildInboundDeletionImpactTx(
	ctx context.Context,
	tx *sql.Tx,
	document inboundDocumentRow,
) (InboundDeletionImpact, error) {
	impact := InboundDeletionImpact{
		DocumentID:   document.ID,
		ContainerNo:  document.ContainerNo,
		CanExecute:   true,
		Dependencies: []InboundDeletionDependency{},
	}
	if normalizeDocumentStatus(document.Status) != DocumentStatusConfirmed {
		return impact, nil
	}
	containerNo := normalizeContainerNo(document.ContainerNo)
	if containerNo == "" {
		return impact, nil
	}

	var boundary sql.NullInt64
	if err := tx.QueryRowContext(ctx, `
		SELECT MAX(id)
		FROM stock_ledger
		WHERE UPPER(TRIM(COALESCE(source_document_type, ''))) = ?
		  AND source_document_id = ?
		  AND event_type = ?
	`, StockLedgerSourceInbound, document.ID, StockLedgerEventReceive).Scan(&boundary); err != nil {
		return InboundDeletionImpact{}, mapDBError(fmt.Errorf("load inbound deletion boundary: %w", err))
	}
	if !boundary.Valid || boundary.Int64 <= 0 {
		return impact, nil
	}

	rows, err := tx.QueryContext(ctx, `
		SELECT
			id,
			COALESCE(occurred_at, created_at),
			UPPER(TRIM(COALESCE(source_document_type, ''))),
			COALESCE(source_document_id, 0),
			quantity_change,
			pallet_change
		FROM stock_ledger
		WHERE id > ?
		  AND customer_id = ?
		  AND UPPER(TRIM(COALESCE(container_no_snapshot, ''))) = ?
		  AND UPPER(TRIM(COALESCE(source_document_type, ''))) <> ?
		  AND NOT (
			UPPER(TRIM(COALESCE(source_document_type, ''))) = ?
			AND COALESCE(source_document_id, 0) = ?
		  )
		ORDER BY id DESC
	`, boundary.Int64, document.CustomerID, containerNo, inboundDeletionRollbackSource, StockLedgerSourceInbound, document.ID)
	if err != nil {
		return InboundDeletionImpact{}, mapDBError(fmt.Errorf("load inbound deletion dependencies: %w", err))
	}
	defer rows.Close()

	groups := make(map[inboundDeletionSourceKey]*inboundDeletionDependencyGroup)
	for rows.Next() {
		var ledgerID int64
		var activityAt time.Time
		var sourceType string
		var sourceDocumentID int64
		var quantityChange int
		var palletChange float64
		if err := rows.Scan(&ledgerID, &activityAt, &sourceType, &sourceDocumentID, &quantityChange, &palletChange); err != nil {
			return InboundDeletionImpact{}, mapDBError(fmt.Errorf("scan inbound deletion dependency: %w", err))
		}
		key := inboundDeletionSourceKey{SourceType: sourceType, DocumentID: sourceDocumentID}
		group := groups[key]
		if group == nil {
			group = &inboundDeletionDependencyGroup{SourceType: sourceType, DocumentID: sourceDocumentID, CoveredTransfers: make(map[int64]struct{}), Containers: make(map[string]struct{})}
			groups[key] = group
		}
		if ledgerID > group.LastLedgerID {
			group.LastLedgerID = ledgerID
		}
		if activityAt.After(group.ActivityAt) {
			group.ActivityAt = activityAt
		}
		if quantityChange >= 0 {
			group.PositiveQty += quantityChange
		} else {
			group.NegativeQty += -quantityChange
		}
		if palletChange >= 0 {
			group.PositivePallets += palletChange
		} else {
			group.NegativePallets += -palletChange
		}
	}
	if err := rows.Err(); err != nil {
		return InboundDeletionImpact{}, mapDBError(fmt.Errorf("iterate inbound deletion dependencies: %w", err))
	}

	coveredTransferIDs := make(map[int64]struct{})
	for key, group := range groups {
		if key.SourceType != StockLedgerSourceOutbound || key.DocumentID <= 0 {
			continue
		}
		lineRows, err := s.loadOutboundDocumentLinesTx(ctx, tx, key.DocumentID)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				continue
			}
			return InboundDeletionImpact{}, err
		}
		for _, line := range lineRows {
			for _, allocation := range line.PickAllocations {
				if allocation.SourceTransferID > 0 {
					coveredTransferIDs[allocation.SourceTransferID] = struct{}{}
					group.CoveredTransfers[allocation.SourceTransferID] = struct{}{}
				}
			}
		}
	}

	for key, group := range groups {
		if key.SourceType == StockLedgerSourceTransfer {
			if _, covered := coveredTransferIDs[key.DocumentID]; covered {
				continue
			}
		}
		expandedGroup, err := s.expandInboundDeletionDependencyGroupTx(ctx, tx, *group)
		if err != nil {
			return InboundDeletionImpact{}, err
		}
		dependency, err := s.describeInboundDeletionDependencyTx(ctx, tx, expandedGroup)
		if err != nil {
			return InboundDeletionImpact{}, err
		}
		impact.Dependencies = append(impact.Dependencies, dependency)
		if !dependency.Reversible {
			impact.CanExecute = false
		}
	}
	sort.Slice(impact.Dependencies, func(left, right int) bool {
		return impact.Dependencies[left].LastLedgerID > impact.Dependencies[right].LastLedgerID
	})
	impact.HasDependencies = len(impact.Dependencies) > 0
	return impact, nil
}

// A dependency is approved and deleted as a complete source document. Expand
// the preview to that same document scope so the operator sees every container
// and the same version marker that execution will lock and reverse.
func (s *Store) expandInboundDeletionDependencyGroupTx(
	ctx context.Context,
	tx *sql.Tx,
	group inboundDeletionDependencyGroup,
) (inboundDeletionDependencyGroup, error) {
	expanded := inboundDeletionDependencyGroup{
		SourceType:       group.SourceType,
		DocumentID:       group.DocumentID,
		CoveredTransfers: group.CoveredTransfers,
		Containers:       make(map[string]struct{}),
	}
	if expanded.CoveredTransfers == nil {
		expanded.CoveredTransfers = make(map[int64]struct{})
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT
			id,
			COALESCE(occurred_at, created_at),
			quantity_change,
			pallet_change,
			COALESCE(container_no_snapshot, '')
		FROM stock_ledger
		WHERE UPPER(TRIM(COALESCE(source_document_type, ''))) = ?
		  AND source_document_id = ?
		ORDER BY id DESC
	`, expanded.SourceType, expanded.DocumentID)
	if err != nil {
		return inboundDeletionDependencyGroup{}, mapDBError(fmt.Errorf("expand inbound deletion dependency: %w", err))
	}
	defer rows.Close()
	for rows.Next() {
		var ledgerID int64
		var activityAt time.Time
		var quantityChange int
		var palletChange float64
		var containerNo string
		if err := rows.Scan(&ledgerID, &activityAt, &quantityChange, &palletChange, &containerNo); err != nil {
			return inboundDeletionDependencyGroup{}, mapDBError(fmt.Errorf("scan expanded inbound deletion dependency: %w", err))
		}
		if ledgerID > expanded.LastLedgerID {
			expanded.LastLedgerID = ledgerID
		}
		if activityAt.After(expanded.ActivityAt) {
			expanded.ActivityAt = activityAt
		}
		if quantityChange >= 0 {
			expanded.PositiveQty += quantityChange
		} else {
			expanded.NegativeQty += -quantityChange
		}
		if palletChange >= 0 {
			expanded.PositivePallets += palletChange
		} else {
			expanded.NegativePallets += -palletChange
		}
		if containerNo = normalizeContainerNo(containerNo); containerNo != "" {
			expanded.Containers[containerNo] = struct{}{}
		}
	}
	if err := rows.Err(); err != nil {
		return inboundDeletionDependencyGroup{}, mapDBError(fmt.Errorf("iterate expanded inbound deletion dependency: %w", err))
	}
	return expanded, nil
}

func (s *Store) describeInboundDeletionDependencyTx(
	ctx context.Context,
	tx *sql.Tx,
	group inboundDeletionDependencyGroup,
) (InboundDeletionDependency, error) {
	dependency := InboundDeletionDependency{
		SourceType:       group.SourceType,
		DocumentID:       group.DocumentID,
		LastLedgerID:     group.LastLedgerID,
		AffectedQty:      maxInt(group.PositiveQty, group.NegativeQty),
		AffectedPallets:  math.Max(group.PositivePallets, group.NegativePallets),
		Reversible:       group.DocumentID > 0,
		IncludesTransfer: len(group.CoveredTransfers) > 0,
	}
	for containerNo := range group.Containers {
		dependency.AffectedContainers = append(dependency.AffectedContainers, containerNo)
	}
	sort.Strings(dependency.AffectedContainers)
	if !group.ActivityAt.IsZero() {
		activityAt := group.ActivityAt
		dependency.ActivityAt = &activityAt
	}

	var status string
	switch group.SourceType {
	case StockLedgerSourceOutbound:
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(picking_order_no, ''), status FROM outbound_documents WHERE id = ?`, group.DocumentID).Scan(&dependency.Reference, &status); err != nil {
			return missingInboundDeletionDependency(group, "outbound shipment no longer exists", err)
		}
	case StockLedgerSourceTransfer:
		if err := tx.QueryRowContext(ctx, `SELECT transfer_no, status FROM inventory_transfers WHERE id = ?`, group.DocumentID).Scan(&dependency.Reference, &status); err != nil {
			return missingInboundDeletionDependency(group, "transfer no longer exists", err)
		}
	case StockLedgerSourceAdjustment:
		if err := tx.QueryRowContext(ctx, `SELECT adjustment_no, status FROM inventory_adjustments WHERE id = ?`, group.DocumentID).Scan(&dependency.Reference, &status); err != nil {
			return missingInboundDeletionDependency(group, "inventory adjustment no longer exists", err)
		}
	case StockLedgerSourceCycleCount:
		if err := tx.QueryRowContext(ctx, `SELECT count_no, status FROM cycle_counts WHERE id = ?`, group.DocumentID).Scan(&dependency.Reference, &status); err != nil {
			return missingInboundDeletionDependency(group, "cycle count no longer exists", err)
		}
	case StockLedgerSourceInbound:
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(container_no, ''), status FROM inbound_documents WHERE id = ?`, group.DocumentID).Scan(&dependency.Reference, &status); err != nil {
			return missingInboundDeletionDependency(group, "later receipt no longer exists", err)
		}
	default:
		dependency.Reference = fmt.Sprintf("%s %d", firstNonEmpty(group.SourceType, "ACTIVITY"), group.DocumentID)
		dependency.Reversible = false
		dependency.BlockingReason = "This activity type must be corrected manually."
		return dependency, nil
	}
	if strings.TrimSpace(dependency.Reference) == "" {
		dependency.Reference = fmt.Sprintf("#%d", group.DocumentID)
	}
	if strings.EqualFold(strings.TrimSpace(status), DocumentStatusDeleted) || strings.EqualFold(strings.TrimSpace(status), "REVERSED") {
		dependency.Reversible = false
		dependency.BlockingReason = "The source document is no longer active."
	}
	return dependency, nil
}

func missingInboundDeletionDependency(
	group inboundDeletionDependencyGroup,
	reason string,
	err error,
) (InboundDeletionDependency, error) {
	if !errors.Is(err, sql.ErrNoRows) {
		return InboundDeletionDependency{}, mapDBError(err)
	}
	activityAt := group.ActivityAt
	return InboundDeletionDependency{
		SourceType:         group.SourceType,
		DocumentID:         group.DocumentID,
		Reference:          fmt.Sprintf("%s %d", firstNonEmpty(group.SourceType, "ACTIVITY"), group.DocumentID),
		ActivityAt:         &activityAt,
		LastLedgerID:       group.LastLedgerID,
		AffectedQty:        maxInt(group.PositiveQty, group.NegativeQty),
		AffectedPallets:    math.Max(group.PositivePallets, group.NegativePallets),
		AffectedContainers: sortedInboundDeletionContainers(group.Containers),
		Reversible:         false,
		BlockingReason:     reason,
	}, nil
}

func sortedInboundDeletionContainers(containers map[string]struct{}) []string {
	values := make([]string, 0, len(containers))
	for containerNo := range containers {
		values = append(values, containerNo)
	}
	sort.Strings(values)
	return values
}

func validateInboundDeletionSelections(expected []InboundDeletionDependency, selected []InboundDeletionSelection) error {
	if len(expected) != len(selected) {
		return fmt.Errorf("%w: the activity list changed or not every activity was selected; refresh the preview", ErrInvalidInput)
	}
	selectedByKey := make(map[inboundDeletionSourceKey]InboundDeletionSelection, len(selected))
	for _, entry := range selected {
		key := inboundDeletionSourceKey{SourceType: strings.ToUpper(strings.TrimSpace(entry.SourceType)), DocumentID: entry.DocumentID}
		if key.SourceType == "" || key.DocumentID <= 0 || entry.LastLedgerID <= 0 {
			return fmt.Errorf("%w: every selected activity requires a valid type, document, and version", ErrInvalidInput)
		}
		if _, duplicate := selectedByKey[key]; duplicate {
			return fmt.Errorf("%w: duplicate selected activity %s %d", ErrInvalidInput, key.SourceType, key.DocumentID)
		}
		selectedByKey[key] = entry
	}
	for _, dependency := range expected {
		key := inboundDeletionSourceKey{SourceType: dependency.SourceType, DocumentID: dependency.DocumentID}
		entry, exists := selectedByKey[key]
		if !exists || entry.LastLedgerID != dependency.LastLedgerID {
			return fmt.Errorf("%w: the activity list changed; refresh the preview before deleting", ErrInvalidInput)
		}
	}
	return nil
}

func (s *Store) inboundDeletionCoveredSourcesTx(
	ctx context.Context,
	tx *sql.Tx,
	document inboundDocumentRow,
	dependencies []InboundDeletionDependency,
) (map[inboundDeletionSourceKey]struct{}, error) {
	sources := map[inboundDeletionSourceKey]struct{}{
		{SourceType: StockLedgerSourceInbound, DocumentID: document.ID}: {},
	}
	for _, dependency := range dependencies {
		key := inboundDeletionSourceKey{SourceType: dependency.SourceType, DocumentID: dependency.DocumentID}
		sources[key] = struct{}{}
		if dependency.SourceType != StockLedgerSourceOutbound {
			continue
		}
		lineRows, err := s.loadOutboundDocumentLinesTx(ctx, tx, dependency.DocumentID)
		if err != nil {
			return nil, err
		}
		for _, line := range lineRows {
			for _, allocation := range line.PickAllocations {
				if allocation.SourceTransferID > 0 {
					sources[inboundDeletionSourceKey{SourceType: StockLedgerSourceTransfer, DocumentID: allocation.SourceTransferID}] = struct{}{}
				}
			}
		}
	}
	return sources, nil
}

func containsInboundDeletionDependency(dependencies []InboundDeletionDependency, source inboundDeletionSourceKey) bool {
	for _, dependency := range dependencies {
		if dependency.SourceType == source.SourceType && dependency.DocumentID == source.DocumentID {
			return true
		}
	}
	return false
}

func (s *Store) loadInboundDeletionLedgerRowsTx(
	ctx context.Context,
	tx *sql.Tx,
	sources map[inboundDeletionSourceKey]struct{},
) ([]inboundDeletionLedgerRow, error) {
	rows := make([]inboundDeletionLedgerRow, 0)
	for source := range sources {
		documentRows, err := tx.QueryContext(ctx, `
			SELECT
				id,
				event_type,
				occurred_at,
				created_at,
				sku_master_id,
				customer_id,
				container_id,
				location_id,
				storage_section,
				quantity_change,
				pallet_change,
				UPPER(TRIM(COALESCE(source_document_type, ''))),
				source_document_id,
				source_line_id,
				COALESCE(container_no_snapshot, ''),
				COALESCE(item_number_snapshot, ''),
				COALESCE(description_snapshot, '')
			FROM stock_ledger
			WHERE UPPER(TRIM(COALESCE(source_document_type, ''))) = ?
			  AND source_document_id = ?
			ORDER BY id DESC
			FOR UPDATE
		`, source.SourceType, source.DocumentID)
		if err != nil {
			return nil, mapDBError(fmt.Errorf("lock %s ledger %d: %w", source.SourceType, source.DocumentID, err))
		}
		for documentRows.Next() {
			var row inboundDeletionLedgerRow
			if err := documentRows.Scan(
				&row.ID,
				&row.EventType,
				&row.OccurredAt,
				&row.CreatedAt,
				&row.SKUMasterID,
				&row.CustomerID,
				&row.ContainerID,
				&row.LocationID,
				&row.StorageSection,
				&row.QuantityChange,
				&row.PalletChange,
				&row.SourceDocumentType,
				&row.SourceDocumentID,
				&row.SourceLineID,
				&row.ContainerNo,
				&row.ItemNumber,
				&row.DescriptionSnapshot,
			); err != nil {
				documentRows.Close()
				return nil, mapDBError(fmt.Errorf("scan inbound deletion ledger: %w", err))
			}
			rows = append(rows, row)
		}
		if err := documentRows.Err(); err != nil {
			documentRows.Close()
			return nil, mapDBError(fmt.Errorf("iterate inbound deletion ledger: %w", err))
		}
		documentRows.Close()
	}
	sort.Slice(rows, func(left, right int) bool { return rows[left].ID > rows[right].ID })
	return rows, nil
}

func ensureInboundDeletionBillingMutationsAllowedTx(ctx context.Context, tx *sql.Tx, rows []inboundDeletionLedgerRow) error {
	scopes := make([]billingSourceMutationScope, 0, len(rows))
	for _, row := range rows {
		occurredAt := row.CreatedAt
		if row.OccurredAt.Valid {
			occurredAt = row.OccurredAt.Time
		}
		scopes = append(scopes, billingSourceMutationScope{
			CustomerID:  row.CustomerID,
			OccurredAt:  occurredAt,
			LocationIDs: []int64{row.LocationID},
			ContainerNo: row.ContainerNo,
		})
	}
	return ensureBillingSourceMutationsAllowedTx(ctx, tx, scopes...)
}

func (s *Store) reverseInboundDeletionLedgerRowTx(
	ctx context.Context,
	tx *sql.Tx,
	rootDocumentID int64,
	row inboundDeletionLedgerRow,
	rollbackAt time.Time,
) error {
	if !row.SKUMasterID.Valid || row.SKUMasterID.Int64 <= 0 {
		if row.QuantityChange == 0 && math.Abs(row.PalletChange) < 0.000001 {
			return nil
		}
		return fmt.Errorf("%w: ledger row %d has no UPC reference", ErrInvalidInput, row.ID)
	}
	quantityChange := -row.QuantityChange
	palletChange := -row.PalletChange
	if err := validateInboundDeletionRollbackBalanceTx(ctx, tx, row, quantityChange, palletChange); err != nil {
		return err
	}
	return s.createStockLedgerTx(ctx, tx, createStockLedgerInput{
		EventType:           StockLedgerEventAdjust,
		OccurredAt:          &rollbackAt,
		SKUMasterID:         row.SKUMasterID.Int64,
		CustomerID:          row.CustomerID,
		ContainerID:         row.ContainerID.Int64,
		LocationID:          row.LocationID,
		StorageSection:      row.StorageSection,
		QuantityChange:      quantityChange,
		PalletChange:        palletChange,
		SourceDocumentType:  inboundDeletionRollbackSource,
		SourceDocumentID:    rootDocumentID,
		SourceLineID:        row.ID,
		ContainerNo:         row.ContainerNo,
		ItemNumber:          row.ItemNumber,
		DescriptionSnapshot: row.DescriptionSnapshot,
		Reason:              fmt.Sprintf("Explicit rollback before deleting inbound receipt %d", rootDocumentID),
	})
}

func validateInboundDeletionRollbackBalanceTx(
	ctx context.Context,
	tx *sql.Tx,
	row inboundDeletionLedgerRow,
	quantityChange int,
	palletChange float64,
) error {
	if quantityChange >= 0 && palletChange >= -0.000001 {
		return nil
	}
	var quantity int
	var allocatedQty int
	var damagedQty int
	var holdQty int
	var pallets int
	var allocatedPallets int
	err := tx.QueryRowContext(ctx, `
		SELECT quantity, allocated_qty, damaged_qty, hold_qty, pallets, allocated_pallets
		FROM inventory_items
		WHERE sku_master_id = ?
		  AND customer_id = ?
		  AND location_id = ?
		  AND storage_section = ?
		  AND container_no = ?
		FOR UPDATE
	`, row.SKUMasterID.Int64, row.CustomerID, row.LocationID, fallbackSection(row.StorageSection), normalizeContainerNo(row.ContainerNo)).Scan(
		&quantity,
		&allocatedQty,
		&damagedQty,
		&holdQty,
		&pallets,
		&allocatedPallets,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: inventory required to roll back this activity no longer exists", ErrInsufficientStock)
	}
	if err != nil {
		return mapDBError(fmt.Errorf("lock rollback inventory balance: %w", err))
	}
	finalQty := quantity + quantityChange
	finalPallets := pallets + int(math.Round(palletChange))
	if finalQty < allocatedQty+damagedQty+holdQty || finalQty < 0 || finalPallets < allocatedPallets || finalPallets < 0 {
		return fmt.Errorf(
			"%w: container %s / UPC %s at location %d, section %s has inventory reserved or consumed by an activity outside this deletion plan",
			ErrInsufficientStock,
			row.ContainerNo,
			row.ItemNumber,
			row.LocationID,
			fallbackSection(row.StorageSection),
		)
	}
	return nil
}

func (s *Store) hardDeleteInboundDependencyTx(ctx context.Context, tx *sql.Tx, sourceType string, documentID int64) error {
	sourceType = strings.ToUpper(strings.TrimSpace(sourceType))
	switch sourceType {
	case StockLedgerSourceOutbound:
		if err := markDocumentAttachmentsDeletedForDocument(ctx, tx, DocumentAttachmentOutbound, documentID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM delivery_events WHERE outbound_document_id = ?`, documentID); err != nil {
			return mapDBError(fmt.Errorf("delete outbound delivery events: %w", err))
		}
		if _, err := tx.ExecContext(ctx, `
			DELETE allocation
			FROM outbound_container_allocations allocation
			JOIN outbound_document_lines line ON line.id = allocation.outbound_line_id
			WHERE line.document_id = ?
		`, documentID); err != nil {
			return mapDBError(fmt.Errorf("delete outbound allocations: %w", err))
		}
		if err := deleteStockLedgerForDocumentTx(ctx, tx, sourceType, documentID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM outbound_document_lines WHERE document_id = ?`, documentID); err != nil {
			return mapDBError(fmt.Errorf("delete outbound lines: %w", err))
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM outbound_documents WHERE id = ?`, documentID); err != nil {
			return mapDBError(fmt.Errorf("delete outbound document: %w", err))
		}
	case StockLedgerSourceTransfer:
		if err := deleteStockLedgerForDocumentTx(ctx, tx, sourceType, documentID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM inventory_transfer_lines WHERE transfer_id = ?`, documentID); err != nil {
			return mapDBError(fmt.Errorf("delete transfer lines: %w", err))
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM inventory_transfers WHERE id = ?`, documentID); err != nil {
			return mapDBError(fmt.Errorf("delete transfer: %w", err))
		}
	case StockLedgerSourceAdjustment:
		if err := deleteStockLedgerForDocumentTx(ctx, tx, sourceType, documentID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM inventory_adjustment_lines WHERE adjustment_id = ?`, documentID); err != nil {
			return mapDBError(fmt.Errorf("delete adjustment lines: %w", err))
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM inventory_adjustments WHERE id = ?`, documentID); err != nil {
			return mapDBError(fmt.Errorf("delete adjustment: %w", err))
		}
	case StockLedgerSourceCycleCount:
		if err := deleteStockLedgerForDocumentTx(ctx, tx, sourceType, documentID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM cycle_count_lines WHERE cycle_count_id = ?`, documentID); err != nil {
			return mapDBError(fmt.Errorf("delete cycle count lines: %w", err))
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM cycle_counts WHERE id = ?`, documentID); err != nil {
			return mapDBError(fmt.Errorf("delete cycle count: %w", err))
		}
	case StockLedgerSourceInbound:
		document, err := s.loadInboundDocumentForUpdateTx(ctx, tx, documentID)
		if err != nil {
			return err
		}
		return s.hardDeleteInboundDocumentArtifactsTx(ctx, tx, document)
	default:
		return fmt.Errorf("%w: unsupported activity type %s", ErrInvalidInput, sourceType)
	}
	return nil
}

func (s *Store) hardDeleteInboundDocumentArtifactsTx(ctx context.Context, tx *sql.Tx, document inboundDocumentRow) error {
	if err := markDocumentAttachmentsDeletedForDocument(ctx, tx, DocumentAttachmentInbound, document.ID); err != nil {
		return err
	}
	if err := deleteStockLedgerForDocumentTx(ctx, tx, StockLedgerSourceInbound, document.ID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM inbound_document_lines WHERE document_id = ?`, document.ID); err != nil {
		return mapDBError(fmt.Errorf("delete inbound document lines: %w", err))
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM inbound_documents WHERE id = ?`, document.ID); err != nil {
		return mapDBError(fmt.Errorf("delete inbound document: %w", err))
	}
	return nil
}
