import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
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
