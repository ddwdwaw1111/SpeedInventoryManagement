type InlineLoadingIndicatorProps = {
  className?: string;
  sizeClassName?: string;
};

export function InlineLoadingIndicator({
  className = "",
  sizeClassName = "h-4 w-4"
}: InlineLoadingIndicatorProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent ${sizeClassName} ${className}`.trim()}
    />
  );
}
