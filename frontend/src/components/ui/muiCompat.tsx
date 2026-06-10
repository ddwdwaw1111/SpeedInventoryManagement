import { Children, cloneElement, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, isValidElement, type ReactElement, type ReactNode, useEffect, useMemo, useState } from "react";

import { cn } from "../../lib/utils";

type SxValue = Record<string, unknown>;
type CompatColor = "default" | "error" | "info" | "primary" | "secondary" | "success" | "warning" | string;

type BoxProps = HTMLAttributes<HTMLDivElement> & {
  component?: keyof JSX.IntrinsicElements;
  sx?: SxValue;
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  color?: CompatColor;
  endIcon?: ReactNode;
  fullWidth?: boolean;
  size?: "small" | "medium" | "large";
  startIcon?: ReactNode;
  sx?: SxValue;
  variant?: "contained" | "outlined" | "text" | string;
};

type ChipProps = HTMLAttributes<HTMLSpanElement> & {
  color?: CompatColor;
  icon?: ReactNode;
  label?: ReactNode;
  size?: "small" | "medium";
  sx?: SxValue;
  variant?: "filled" | "outlined" | string;
};

type DialogProps = {
  children: ReactNode;
  fullWidth?: boolean;
  maxWidth?: "xs" | "sm" | "md" | "lg" | "xl" | false | string;
  onClose?: (event?: unknown, reason?: "backdropClick" | "escapeKeyDown") => void;
  open: boolean;
  PaperProps?: { className?: string; style?: CSSProperties; sx?: SxValue };
};

type DrawerProps = {
  anchor?: "bottom" | "left" | "right" | "top";
  children: ReactNode;
  ModalProps?: unknown;
  onClose?: () => void;
  open: boolean;
  PaperProps?: { className?: string; style?: CSSProperties; sx?: SxValue };
};

type MenuProps = {
  anchorOrigin?: unknown;
  anchorEl?: HTMLElement | null;
  children: ReactNode;
  onClose?: () => void;
  open: boolean;
  transformOrigin?: unknown;
};

type TextFieldProps = {
  autoFocus?: boolean;
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  error?: boolean;
  fullWidth?: boolean;
  helperText?: ReactNode;
  InputLabelProps?: Record<string, unknown>;
  InputProps?: {
    endAdornment?: ReactNode;
    startAdornment?: ReactNode;
  };
  inputProps?: Record<string, unknown>;
  label?: ReactNode;
  onChange?: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;
  placeholder?: string;
  select?: boolean;
  SelectProps?: Record<string, unknown>;
  size?: "small" | "medium";
  style?: CSSProperties;
  sx?: SxValue;
  type?: string;
  value?: string | number | readonly string[];
} & Record<string, unknown>;

type AutocompleteProps<Option> = {
  disableClearable?: boolean;
  getOptionLabel?: (option: Option) => string;
  isOptionEqualToValue?: (option: Option, value: Option) => boolean;
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>, value: Option | null) => void;
  options: Option[];
  renderInput?: (params: Record<string, unknown>) => ReactNode;
  size?: "small" | "medium";
  value?: Option | null;
};

const colorClassMap: Record<string, string> = {
  default: "mui-color-default",
  error: "mui-color-error",
  info: "mui-color-info",
  primary: "mui-color-primary",
  secondary: "mui-color-secondary",
  success: "mui-color-success",
  warning: "mui-color-warning"
};

export function Box({ children, className, component, style, sx, ...props }: BoxProps) {
  const Component = (component ?? "div") as "div";
  return (
    <Component className={className} style={{ ...sxToStyle(sx), ...style }} {...props}>
      {children}
    </Component>
  );
}

export function Button({
  children,
  className,
  color = "primary",
  endIcon,
  fullWidth,
  size = "medium",
  startIcon,
  style,
  sx,
  type = "button",
  variant = "text",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "mui-button",
        `mui-button--${variant}`,
        `mui-button--${size}`,
        fullWidth ? "mui-button--full" : "",
        colorClassMap[color] ?? "",
        className
      )}
      style={{ ...sxToStyle(sx), ...style }}
      type={type}
      {...props}
    >
      {startIcon ? <span className="mui-button__icon">{startIcon}</span> : null}
      <span className="mui-button__label">{children}</span>
      {endIcon ? <span className="mui-button__icon">{endIcon}</span> : null}
    </button>
  );
}

export function IconButton({ children, className, size = "medium", style, sx, type = "button", ...props }: ButtonProps) {
  return (
    <button
      className={cn("mui-icon-button", size === "small" ? "mui-icon-button--small" : "", className)}
      style={{ ...sxToStyle(sx), ...style }}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}

export function Chip({ className, color = "default", icon, label, size = "medium", style, sx, variant = "filled", ...props }: ChipProps) {
  const isClickable = typeof props.onClick === "function";
  const Component = isClickable ? "button" : "span";
  return (
    <Component
      className={cn(
        "mui-chip",
        isClickable ? "mui-chip--clickable" : "",
        `mui-chip--${variant}`,
        size === "small" ? "mui-chip--small" : "",
        colorClassMap[color] ?? "",
        className
      )}
      style={{ ...sxToStyle(sx), ...style }}
      type={isClickable ? "button" : undefined}
      {...props as HTMLAttributes<HTMLSpanElement> & ButtonHTMLAttributes<HTMLButtonElement>}
    >
      {icon ? <span className="mui-chip__icon">{icon}</span> : null}
      {label}
    </Component>
  );
}

export function Dialog({ children, fullWidth, maxWidth = "sm", onClose, open, PaperProps }: DialogProps) {
  useEffect(() => {
    if (!open || !onClose) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose?.(event, "escapeKeyDown");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="mui-dialog__backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        onClose?.(event, "backdropClick");
      }
    }}>
      <section
        className={cn("mui-dialog", fullWidth ? "mui-dialog--full" : "", PaperProps?.className)}
        role="dialog"
        aria-modal="true"
        style={{ ...dialogWidthStyle(maxWidth), ...sxToStyle(PaperProps?.sx), ...PaperProps?.style }}
      >
        {children}
      </section>
    </div>
  );
}

export function DialogTitle({ children, className, style, sx, ...props }: HTMLAttributes<HTMLDivElement> & { sx?: SxValue }) {
  return (
    <div className={cn("mui-dialog__title", className)} style={{ ...sxToStyle(sx), ...style }} {...props}>
      <h2>{children}</h2>
    </div>
  );
}

export function DialogContent({ children, className, dividers, style, sx, ...props }: HTMLAttributes<HTMLDivElement> & { dividers?: boolean; sx?: SxValue }) {
  return (
    <div
      className={cn("mui-dialog__content", dividers ? "mui-dialog__content--dividers" : "", className)}
      style={{ ...sxToStyle(sx), ...style }}
      {...props}
    >
      {children}
    </div>
  );
}

export function DialogActions({ children, className, style, sx, ...props }: HTMLAttributes<HTMLDivElement> & { sx?: SxValue }) {
  return (
    <div className={cn("mui-dialog__actions", className)} style={{ ...sxToStyle(sx), ...style }} {...props}>
      {children}
    </div>
  );
}

export function Drawer({ anchor = "right", children, onClose, open, PaperProps }: DrawerProps) {
  useEffect(() => {
    if (!open || !onClose) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose?.();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="mui-drawer__backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose?.();
    }}>
      <aside
        className={cn("mui-drawer", `mui-drawer--${anchor}`, PaperProps?.className)}
        style={{ ...sxToStyle(PaperProps?.sx), ...PaperProps?.style }}
      >
        {children}
      </aside>
    </div>
  );
}

export function Divider({ className, flexItem, orientation = "horizontal", style, sx }: {
  className?: string;
  flexItem?: boolean;
  orientation?: "horizontal" | "vertical";
  style?: CSSProperties;
  sx?: SxValue;
}) {
  return <span className={cn("mui-divider", `mui-divider--${orientation}`, flexItem ? "mui-divider--flex" : "", className)} style={{ ...sxToStyle(sx), ...style }} />;
}

export function Menu({ anchorEl, children, onClose, open }: MenuProps) {
  const position = useMemo(() => {
    const rect = anchorEl?.getBoundingClientRect();
    if (!rect) return { top: "4rem", left: "auto", right: "1rem" };
    return { top: rect.bottom + 8, left: Math.max(8, rect.right - 260) };
  }, [anchorEl, open]);

  useEffect(() => {
    if (!open || !onClose) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose?.();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <>
      <button className="mui-menu__scrim" type="button" aria-label="Close menu" onClick={onClose} />
      <div className="mui-menu" role="menu" style={position}>
        {children}
      </div>
    </>
  );
}

export function MenuItem({ children, className, disabled, onClick, style, sx, value, ...props }: HTMLAttributes<HTMLElement> & {
  disabled?: boolean;
  sx?: SxValue;
  value?: string | number;
}) {
  if (value !== undefined) {
    return <option value={value}>{children}</option>;
  }

  return (
    <button
      className={cn("mui-menu-item", className)}
      disabled={disabled}
      onClick={onClick as React.MouseEventHandler<HTMLButtonElement>}
      role="menuitem"
      style={{ ...sxToStyle(sx), ...style }}
      type="button"
      {...props as HTMLAttributes<HTMLButtonElement>}
    >
      {children}
    </button>
  );
}

export function ListItemIcon({ children, className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("mui-list-item-icon", className)} {...props}>{children}</span>;
}

export function ListItemText({ primary, secondary }: { primary?: ReactNode; secondary?: ReactNode }) {
  return (
    <span className="mui-list-item-text">
      <span>{primary}</span>
      {secondary ? <small>{secondary}</small> : null}
    </span>
  );
}

export function InputAdornment({ children, className, position }: HTMLAttributes<HTMLSpanElement> & { position?: "end" | "start" }) {
  return <span className={cn("mui-input-adornment", position === "end" ? "mui-input-adornment--end" : "", className)}>{children}</span>;
}

export function TextField({
  children,
  className,
  disabled,
  error,
  fullWidth,
  helperText,
  InputLabelProps: _InputLabelProps,
  InputProps,
  inputProps,
  label,
  autoFocus,
  onChange,
  onKeyDown,
  placeholder,
  select,
  SelectProps: _SelectProps,
  size = "medium",
  style,
  sx,
  type = "text",
  value,
  ...props
}: TextFieldProps) {
  const [isSelectOpen, setIsSelectOpen] = useState(false);
  const selectOptions = Children.toArray(children)
    .filter(isValidElement)
    .map((child) => {
      const props = (child as ReactElement<{ children?: ReactNode; value?: string | number }>).props;
      return { label: props.children, value: props.value };
    })
    .filter((option): option is { label: ReactNode; value: string | number } => option.value !== undefined);
  const control = select ? (
    <span className="mui-autocomplete">
      <button
        aria-expanded={isSelectOpen}
        aria-label={typeof label === "string" ? label : undefined}
        autoFocus={autoFocus}
        className="mui-autocomplete__button"
        disabled={disabled}
        onBlur={() => window.setTimeout(() => setIsSelectOpen(false), 120)}
        onFocus={() => setIsSelectOpen(true)}
        onKeyDown={onKeyDown as React.KeyboardEventHandler<HTMLButtonElement>}
        onMouseDown={(event) => {
          event.preventDefault();
          setIsSelectOpen(true);
        }}
        role="combobox"
        type="button"
      >
        <span>{selectOptions.find((option) => String(option.value) === String(value))?.label ?? ""}</span>
      </button>
      {isSelectOpen ? (
        <div className="mui-autocomplete__listbox" role="listbox">
          {selectOptions.map((option) => (
            <button
              aria-selected={String(option.value) === String(value)}
              className="mui-autocomplete__option"
              key={String(option.value)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                setIsSelectOpen(false);
                onChange?.({ ...event, target: { value: option.value } } as unknown as React.ChangeEvent<HTMLSelectElement>);
              }}
              role="option"
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  ) : (
    <input
      autoFocus={autoFocus}
      disabled={disabled}
      onChange={onChange as React.ChangeEventHandler<HTMLInputElement>}
      onKeyDown={onKeyDown as React.KeyboardEventHandler<HTMLInputElement>}
      placeholder={placeholder}
      type={type}
      value={value as string | number | readonly string[] | undefined}
      {...inputProps}
    />
  );

  return (
    <label
      className={cn(
        "mui-text-field",
        fullWidth ? "mui-text-field--full" : "",
        size === "small" ? "mui-text-field--small" : "",
        error ? "mui-text-field--error" : "",
        className
      )}
      style={{ ...sxToStyle(sx), ...style }}
      {...props}
    >
      {label ? <span className="mui-text-field__label">{label}</span> : null}
      <span className="mui-text-field__control">
        {InputProps?.startAdornment}
        {control}
        {InputProps?.endAdornment}
      </span>
      {helperText ? <small className="mui-text-field__helper">{helperText}</small> : null}
    </label>
  );
}

export function Autocomplete<Option>({
  getOptionLabel = (option) => String(option),
  isOptionEqualToValue = (option, value) => option === value,
  onChange,
  options,
  renderInput,
  size = "medium",
  value
}: AutocompleteProps<Option>) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedIndex = value == null ? "" : Math.max(0, options.findIndex((option) => isOptionEqualToValue(option, value)));
  const renderedInput = renderInput?.({}) ?? null;
  const label = isValidElement(renderedInput) ? (renderedInput.props as { label?: ReactNode }).label : undefined;
  const selectedOption = typeof selectedIndex === "number" ? options[selectedIndex] : null;
  const selectedLabel = selectedOption ? getOptionLabel(selectedOption) : "";

  return (
    <label className={cn("mui-text-field mui-text-field--full", size === "small" ? "mui-text-field--small" : "")}>
      {label ? <span className="mui-text-field__label">{label}</span> : null}
      <span className="mui-autocomplete">
        <button
          aria-expanded={isOpen}
          aria-label={typeof label === "string" ? label : undefined}
          className="mui-autocomplete__button"
          onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
          onFocus={() => setIsOpen(true)}
          onMouseDown={(event) => {
            event.preventDefault();
            setIsOpen(true);
          }}
          role="combobox"
          type="button"
        >
          <span>{selectedLabel}</span>
        </button>
        {isOpen ? (
          <div className="mui-autocomplete__listbox" role="listbox">
            {options.map((option, index) => (
              <button
                aria-selected={index === selectedIndex}
                className="mui-autocomplete__option"
                key={index}
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  setIsOpen(false);
                  onChange?.(event as unknown as React.ChangeEvent<HTMLSelectElement>, option);
                }}
                role="option"
                type="button"
              >
                {getOptionLabel(option)}
              </button>
            ))}
          </div>
        ) : null}
      </span>
    </label>
  );
}

export function Stack({ children, className, direction = "column", flexWrap, spacing = 1, style, sx, ...props }: HTMLAttributes<HTMLDivElement> & {
  direction?: "column" | "row";
  flexWrap?: CSSProperties["flexWrap"];
  spacing?: number;
  sx?: SxValue;
}) {
  return (
    <div
      className={cn("mui-stack", className)}
      style={{ display: "flex", flexDirection: direction, flexWrap, gap: spacingToCss(spacing), ...sxToStyle(sx), ...style }}
      {...props}
    >
      {children}
    </div>
  );
}

export function Tabs({ children, className, onChange, style, sx, value }: Omit<HTMLAttributes<HTMLDivElement>, "onChange"> & {
  onChange?: (event: React.MouseEvent<HTMLButtonElement>, value: unknown) => void;
  sx?: SxValue;
  value?: unknown;
}) {
  return (
    <div className={cn("mui-tabs", className)} role="tablist" style={{ ...sxToStyle(sx), ...style }}>
      {Array.isArray(children)
        ? children.map((child, index) => isValidElement(child)
          ? cloneElement(child as ReactElement<any>, { isSelected: (child.props as { value?: unknown }).value === value, key: child.key ?? index, onSelect: onChange })
          : child)
        : children}
    </div>
  );
}

export function Tab({ className, isSelected, label, onSelect, value }: {
  className?: string;
  isSelected?: boolean;
  label?: ReactNode;
  onSelect?: (event: React.MouseEvent<HTMLButtonElement>, value: unknown) => void;
  value?: unknown;
}) {
  return (
    <button className={cn("mui-tab", isSelected ? "mui-tab--active" : "", className)} onClick={(event) => onSelect?.(event, value)} role="tab" type="button">
      {label}
    </button>
  );
}

export function Typography({ children, className, color, component, style, sx, variant = "body1", ...props }: HTMLAttributes<HTMLElement> & {
  color?: string;
  component?: keyof JSX.IntrinsicElements;
  sx?: SxValue;
  variant?: "body1" | "body2" | "caption" | "h6" | string;
}) {
  const Component = (component ?? (variant === "h6" ? "h3" : "span")) as "span";
  return (
    <Component
      className={cn("mui-typography", `mui-typography--${variant}`, className)}
      style={{ color: mapColor(color), ...sxToStyle(sx), ...style }}
      {...props}
    >
      {children}
    </Component>
  );
}

function dialogWidthStyle(maxWidth: DialogProps["maxWidth"]): CSSProperties {
  const map: Record<string, string> = {
    lg: "min(1080px, 96vw)",
    md: "min(860px, 96vw)",
    sm: "min(560px, 94vw)",
    xl: "min(1280px, 96vw)",
    xs: "min(420px, 94vw)"
  };
  return { width: maxWidth === false ? "min(960px, 96vw)" : map[String(maxWidth)] ?? String(maxWidth) };
}

function sxToStyle(sx?: SxValue): CSSProperties {
  if (!sx) return {};

  const style: CSSProperties = {};
  Object.entries(sx).forEach(([key, rawValue]) => {
    if (key.startsWith("&")) return;
    const value = isSizeStyleKey(key) ? resolveResponsiveSizeValue(rawValue) : resolveResponsiveValue(rawValue);
    if (value == null) return;

    switch (key) {
      case "bgcolor":
        style.backgroundColor = mapColor(value);
        break;
      case "color":
        style.color = mapColor(value);
        break;
      case "m":
        style.margin = spacingToCss(value);
        break;
      case "mb":
        style.marginBottom = spacingToCss(value);
        break;
      case "ml":
        style.marginLeft = spacingToCss(value);
        break;
      case "mr":
        style.marginRight = spacingToCss(value);
        break;
      case "mt":
        style.marginTop = spacingToCss(value);
        break;
      case "mx":
        style.marginLeft = spacingToCss(value);
        style.marginRight = spacingToCss(value);
        break;
      case "my":
        style.marginBottom = spacingToCss(value);
        style.marginTop = spacingToCss(value);
        break;
      case "p":
        style.padding = spacingToCss(value);
        break;
      case "pb":
        style.paddingBottom = spacingToCss(value);
        break;
      case "pl":
        style.paddingLeft = spacingToCss(value);
        break;
      case "pr":
        style.paddingRight = spacingToCss(value);
        break;
      case "pt":
        style.paddingTop = spacingToCss(value);
        break;
      case "px":
        style.paddingLeft = spacingToCss(value);
        style.paddingRight = spacingToCss(value);
        break;
      case "py":
        style.paddingBottom = spacingToCss(value);
        style.paddingTop = spacingToCss(value);
        break;
      case "gridTemplateColumns":
        style.gridTemplateColumns = typeof rawValue === "object" ? "repeat(auto-fit, minmax(180px, 1fr))" : String(value);
        break;
      default:
        (style as Record<string, unknown>)[key] = value;
    }
  });
  return style;
}

function resolveResponsiveValue(value: unknown): string | number | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const responsive = value as Record<string, string | number | undefined>;
    return responsive.lg ?? responsive.md ?? responsive.sm ?? responsive.xs ?? Object.values(responsive)[0];
  }
  return value as string | number | undefined;
}

function resolveResponsiveSizeValue(value: unknown): string | number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value as string | number | undefined;
  }

  const responsive = value as Record<string, string | number | undefined>;
  const xsValue = responsive.xs;
  const upperValue = responsive.sm ?? responsive.md ?? responsive.lg;
  if (xsValue != null && upperValue != null && isFullSize(xsValue)) {
    return `min(${toCssLength(upperValue)}, ${toCssLength(xsValue)})`;
  }

  return resolveResponsiveValue(value);
}

function isSizeStyleKey(key: string) {
  return ["height", "maxHeight", "maxWidth", "minHeight", "minWidth", "width"].includes(key);
}

function isFullSize(value: string | number) {
  return value === "100%" || value === "100vw" || value === "100vh";
}

function toCssLength(value: string | number) {
  return typeof value === "number" ? `${value}px` : value;
}

function spacingToCss(value: unknown): string | number {
  if (typeof value !== "number") return String(value);
  return value <= 8 ? `${value * 0.5}rem` : value;
}

function mapColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const colorMap: Record<string, string> = {
    "text.disabled": "#9aa8b7",
    "text.primary": "#172033",
    "text.secondary": "#61708a",
    primary: "#274c77",
    secondary: "#475569",
    success: "#147d52",
    error: "#b42318",
    warning: "#a05a00",
    info: "#1f6feb"
  };
  return colorMap[value] ?? value;
}
