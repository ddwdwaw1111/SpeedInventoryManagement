import { type ReactNode } from "react";

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
      {errorMessage ? <div className="alert-banner workspace-panel-header__alert">{errorMessage}</div> : null}
      {visibleNotices.length > 0 ? (
        <div className="workspace-panel-header__notices">
          {visibleNotices.map((notice, index) => (
            <div className="sheet-note sheet-note--readonly" key={index}>
              {notice}
            </div>
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
