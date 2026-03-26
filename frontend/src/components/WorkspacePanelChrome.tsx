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
    <div className="workspace-table-state">
      <strong>{title}</strong>
      {description ? <span>{description}</span> : null}
    </div>
  );
}

export function WorkspaceTableLoadingState({ title, description }: WorkspaceTableStateProps) {
  return (
    <div className="workspace-table-state workspace-table-state--loading">
      <strong>{title}</strong>
      {description ? <span>{description}</span> : null}
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
