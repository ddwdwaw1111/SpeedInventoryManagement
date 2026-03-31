import { type ReactNode, type SyntheticEvent, useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Snackbar } from "@mui/material";
import type { AlertColor, ButtonProps } from "@mui/material";

type InlineAlertProps = {
  severity?: AlertColor;
  children: ReactNode;
  className?: string;
};

type ConfirmDialogOptions = {
  title: ReactNode;
  message: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel: ReactNode;
  confirmColor?: ButtonProps["color"];
  severity?: AlertColor;
};

type ToastNotice = {
  id: number;
  message: ReactNode;
  severity: AlertColor;
  autoHideDuration: number;
};

export function InlineAlert({ severity = "error", children, className }: InlineAlertProps) {
  return (
    <Alert
      severity={severity}
      variant="outlined"
      className={className}
      sx={{
        mb: 2,
        borderRadius: 2,
        alignItems: "center",
        "& .MuiAlert-message": {
          width: "100%"
        }
      }}
    >
      {children}
    </Alert>
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

  const confirmationDialog = (
    <Dialog
      open={Boolean(options)}
      onClose={() => closeDialog(false)}
      fullWidth
      maxWidth="xs"
    >
      {options ? (
        <>
          <DialogTitle>{options.title}</DialogTitle>
          <DialogContent dividers>
            <Alert
              severity={options.severity ?? "warning"}
              variant="outlined"
              sx={{ borderRadius: 2 }}
            >
              {options.message}
            </Alert>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => closeDialog(false)}>
              {options.cancelLabel}
            </Button>
            <Button
              variant="contained"
              color={options.confirmColor ?? "primary"}
              onClick={() => closeDialog(true)}
            >
              {options.confirmLabel}
            </Button>
          </DialogActions>
        </>
      ) : null}
    </Dialog>
  );

  return { confirm, confirmationDialog };
}

export function useFeedbackToast() {
  const [notice, setNotice] = useState<ToastNotice | null>(null);

  const closeToast = useCallback((_event?: Event | SyntheticEvent, reason?: string) => {
    if (reason === "clickaway") {
      return;
    }
    setNotice(null);
  }, []);

  const showToast = useCallback((message: ReactNode, severity: AlertColor = "success", autoHideDuration = 3200) => {
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

  const feedbackToast = (
    <Snackbar
      key={notice?.id ?? "feedback-toast"}
      open={Boolean(notice)}
      autoHideDuration={notice?.autoHideDuration ?? 3200}
      onClose={closeToast}
      anchorOrigin={{ vertical: "top", horizontal: "center" }}
    >
      <Alert
        severity={notice?.severity ?? "success"}
        variant="filled"
        onClose={closeToast}
        sx={{
          width: "100%",
          minWidth: 320,
          alignItems: "center",
          boxShadow: "0 14px 34px rgba(12, 33, 74, 0.2)"
        }}
      >
        {notice?.message}
      </Alert>
    </Snackbar>
  );

  return { showToast, showSuccess, showError, feedbackToast };
}
