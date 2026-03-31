import { type ReactNode } from "react";
import { Alert } from "@mui/material";

import { InlineAlert } from "./Feedback";

type WorkspacePanelHeaderProps = {
  title?: string;
  description?: string;
  actions?: ReactNode;
  notices?: Array<ReactNode | null | undefined>;
  errorMessage?: string;
};

type WorkspaceTableStateProps = {
  title: string;
  description?: string;
};

export function WorkspacePanelHeader({
  title,
  description,
  actions,
  notices = [],
  errorMessage
}: WorkspacePanelHeaderProps) {
  const visibleNotices = notices.filter(Boolean);
  const hasCopy = Boolean(title || description);
  const hasRow = hasCopy || Boolean(actions);

  if (!hasRow && !errorMessage && visibleNotices.length === 0) {
    return null;
  }

  return (
    <div className={`workspace-panel-header ${!hasCopy ? "workspace-panel-header--compact" : ""}`}>
      {hasRow ? (
        <div className="workspace-panel-header__row">
          {hasCopy ? (
            <div className="workspace-panel-header__copy">
              {title ? <h2>{title}</h2> : null}
              {description ? <p>{description}</p> : null}
            </div>
          ) : null}
          {actions ? <div className="workspace-panel-header__actions">{actions}</div> : null}
        </div>
      ) : null}
      {errorMessage ? <InlineAlert className="workspace-panel-header__alert">{errorMessage}</InlineAlert> : null}
      {visibleNotices.length > 0 ? (
        <div className="workspace-panel-header__notices">
          {visibleNotices.map((notice, index) => (
            <Alert
              severity="info"
              variant="outlined"
              key={index}
              sx={{
                borderRadius: 2,
                mb: 0,
                "& .MuiAlert-message": {
                  width: "100%"
                }
              }}
            >
              {notice}
            </Alert>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function WorkspaceTableEmptyState({ title, description }: WorkspaceTableStateProps) {
  return (
    <div className="workspace-table-state workspace-table-state--empty">
      <div className="workspace-table-state__copy">
        <strong>{title || "No records available"}</strong>
        <span>{description || "No data matches the current view yet."}</span>
      </div>
    </div>
  );
}

export function WorkspaceTableLoadingState({ title, description }: WorkspaceTableStateProps) {
  return (
    <div className="workspace-table-state workspace-table-state--loading">
      <div className="workspace-table-state__copy">
        <strong>{title}</strong>
        {description ? <span>{description}</span> : null}
      </div>
      <div className="workspace-table-state__rows" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="workspace-table-state__row" key={index}>
            <span className="workspace-table-state__skeleton workspace-table-state__skeleton--short" />
            <span className="workspace-table-state__skeleton workspace-table-state__skeleton--long" />
            <span className="workspace-table-state__skeleton workspace-table-state__skeleton--metric" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function WorkspaceDrawerLoadingState() {
  return (
    <div className="document-drawer__content document-drawer__content--loading" aria-hidden="true">
      <div className="document-drawer__loading-block document-drawer__loading-block--header">
        <span className="document-drawer__loading-line document-drawer__loading-line--eyebrow" />
        <span className="document-drawer__loading-line document-drawer__loading-line--title" />
        <span className="document-drawer__loading-line document-drawer__loading-line--meta" />
      </div>
      <div className="document-drawer__loading-grid">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="document-drawer__loading-card" key={index}>
            <span className="document-drawer__loading-line document-drawer__loading-line--meta" />
            <span className="document-drawer__loading-line document-drawer__loading-line--value" />
          </div>
        ))}
      </div>
      <div className="document-drawer__loading-block">
        <span className="document-drawer__loading-line document-drawer__loading-line--title" />
        <span className="document-drawer__loading-line document-drawer__loading-line--meta" />
        <span className="document-drawer__loading-line document-drawer__loading-line--meta" />
      </div>
      <div className="document-drawer__loading-table">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="document-drawer__loading-row" key={index}>
            <span className="document-drawer__loading-line document-drawer__loading-line--short" />
            <span className="document-drawer__loading-line document-drawer__loading-line--long" />
            <span className="document-drawer__loading-line document-drawer__loading-line--metric" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function buildWorkspaceGridSlots({
  emptyTitle,
  emptyDescription,
  loadingTitle,
  loadingDescription
}: {
  emptyTitle: string;
  emptyDescription?: string;
  loadingTitle: string;
  loadingDescription?: string;
}) {
  return {
    noRowsOverlay: () => <WorkspaceTableEmptyState title={emptyTitle} description={emptyDescription} />,
    noResultsOverlay: () => <WorkspaceTableEmptyState title={emptyTitle} description={emptyDescription} />,
    loadingOverlay: () => <WorkspaceTableLoadingState title={loadingTitle} description={loadingDescription} />
  };
}
