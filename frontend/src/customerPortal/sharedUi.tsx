import { type ReactNode, useCallback, useState } from "react";

import { InlineLoadingIndicator } from "../components/InlineLoadingIndicator";
import { cn } from "../lib/utils";
import { PortalAttachmentsPanel as DocumentAttachmentsPanel } from "./PortalAttachmentsPanel";
import type { PendingDocumentAttachment } from "./PortalAttachmentsPanel";

export { DocumentAttachmentsPanel, InlineLoadingIndicator };
export type { PendingDocumentAttachment };

type InlineAlertProps = {
  severity?: "error" | "warning" | "info" | "success";
  children: ReactNode;
  className?: string;
};

type ToastNotice = {
  id: number;
  message: ReactNode;
  severity: InlineAlertProps["severity"];
};

const alertClasses = {
  error: "border-red-200 bg-red-50 text-red-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-blue-200 bg-blue-50 text-blue-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700"
};

export function InlineAlert({ severity = "error", children, className }: InlineAlertProps) {
  return (
    <div
      className={cn("rounded-md border px-3 py-2 text-sm font-medium", alertClasses[severity], className)}
      role={severity === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

export function useFeedbackToast() {
  const [notice, setNotice] = useState<ToastNotice | null>(null);

  const showToast = useCallback((message: ReactNode, severity: InlineAlertProps["severity"] = "success") => {
    const nextNotice = { id: Date.now(), message, severity };
    setNotice(nextNotice);
    window.setTimeout(() => {
      setNotice((current) => current?.id === nextNotice.id ? null : current);
    }, severity === "error" ? 4200 : 3200);
  }, []);

  const showSuccess = useCallback((message: ReactNode) => showToast(message, "success"), [showToast]);
  const showError = useCallback((message: ReactNode) => showToast(message, "error"), [showToast]);

  const feedbackToast = notice ? (
    <div className="fixed left-1/2 top-4 z-50 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2">
      <InlineAlert severity={notice.severity} className="shadow-lg">
        {notice.message}
      </InlineAlert>
    </div>
  ) : null;

  return { showToast, showSuccess, showError, feedbackToast };
}
