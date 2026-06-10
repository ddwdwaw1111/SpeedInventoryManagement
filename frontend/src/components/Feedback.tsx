import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

export type AlertSeverity = "error" | "warning" | "info" | "success";
type ConfirmColor = "primary" | "secondary" | "success" | "error" | "warning" | "info" | "inherit";

type InlineAlertProps = {
  severity?: AlertSeverity;
  children: ReactNode;
  className?: string;
};

type ConfirmDialogOptions = {
  title: ReactNode;
  message: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel: ReactNode;
  confirmColor?: ConfirmColor;
  severity?: AlertSeverity;
};

type ToastNotice = {
  id: number;
  message: ReactNode;
  severity: AlertSeverity;
  autoHideDuration: number;
};

function getButtonToneClassName(color: ConfirmColor | undefined) {
  if (color === "error") {
    return "button--danger";
  }
  if (color === "warning") {
    return "button--warning";
  }
  return "button--primary";
}

export function InlineAlert({ severity = "error", children, className }: InlineAlertProps) {
  return (
    <div className={`inline-alert inline-alert--${severity} ${className ?? ""}`.trim()} role="alert">
      {children}
    </div>
  );
}

export function useConfirmDialog() {
  const [options, setOptions] = useState<ConfirmDialogOptions | null>(null);
  const resolverRef = useRef<((result: boolean) => void) | null>(null);

  const closeDialog = useCallback((result: boolean) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setOptions(null);
    resolver?.(result);
  }, []);

  const confirm = useCallback((nextOptions: ConfirmDialogOptions) => {
    if (resolverRef.current) {
      resolverRef.current(false);
    }
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOptions(nextOptions);
    });
  }, []);

  useEffect(() => () => {
    resolverRef.current?.(false);
    resolverRef.current = null;
  }, []);

  useEffect(() => {
    if (!options) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeDialog(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeDialog, options]);

  const confirmationDialog = options ? (
    <div
      className="confirm-dialog__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeDialog(false);
        }
      }}
    >
      <section
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <header className="confirm-dialog__header">
          <h2 id="confirm-dialog-title">{options.title}</h2>
        </header>
        <div className="confirm-dialog__body">
          <InlineAlert severity={options.severity ?? "warning"}>{options.message}</InlineAlert>
        </div>
        <footer className="confirm-dialog__actions">
          <button className="button button--ghost" type="button" onClick={() => closeDialog(false)}>
            {options.cancelLabel}
          </button>
          <button
            className={`button ${getButtonToneClassName(options.confirmColor)}`}
            type="button"
            onClick={() => closeDialog(true)}
          >
            {options.confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  ) : null;

  return { confirm, confirmationDialog };
}

export function useFeedbackToast() {
  const [notice, setNotice] = useState<ToastNotice | null>(null);

  const closeToast = useCallback(() => {
    setNotice(null);
  }, []);

  const showToast = useCallback((message: ReactNode, severity: AlertSeverity = "success", autoHideDuration = 3200) => {
    setNotice({
      id: Date.now(),
      message,
      severity,
      autoHideDuration
    });
  }, []);

  const showSuccess = useCallback((message: ReactNode, autoHideDuration?: number) => {
    showToast(message, "success", autoHideDuration ?? 3200);
  }, [showToast]);

  const showError = useCallback((message: ReactNode, autoHideDuration?: number) => {
    showToast(message, "error", autoHideDuration ?? 4200);
  }, [showToast]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timeoutId = window.setTimeout(() => setNotice(null), notice.autoHideDuration);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const feedbackToast = notice ? (
    <div className="feedback-toast-region" role="status" aria-live="polite">
      <div className={`feedback-toast feedback-toast--${notice.severity}`}>
        <span>{notice.message}</span>
        <button type="button" aria-label="Dismiss notification" onClick={closeToast}>
          x
        </button>
      </div>
    </div>
  ) : null;

  return { showToast, showSuccess, showError, feedbackToast };
}
