export type ContainerStatusBadgeVariant = "success" | "warning" | "secondary" | "outline";

export function formatContainerStatus(status: string, t: (key: string) => string) {
  switch (status) {
    case "IN_STOCK":
      return t("customerPortalContainerActive");
    case "PARTIAL":
      return t("customerPortalContainerPartial");
    case "SHIPPED":
      return t("customerPortalContainerShipped");
    case "DEPLETED":
      return t("customerPortalContainerDepleted");
    case "PENDING":
      return t("customerPortalContainerPending");
    default:
      return status || "-";
  }
}

export function getContainerStatusBadgeVariant(status: string): ContainerStatusBadgeVariant {
  switch (status) {
    case "IN_STOCK":
      return "success";
    case "PARTIAL":
      return "warning";
    case "SHIPPED":
      return "outline";
    case "DEPLETED":
    case "PENDING":
      return "secondary";
    default:
      return "secondary";
  }
}
