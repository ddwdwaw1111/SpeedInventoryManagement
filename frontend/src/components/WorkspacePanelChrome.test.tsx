import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkspacePanelHeader, buildWorkspaceGridSlots } from "./WorkspacePanelChrome";
import { renderWithProviders } from "../test/renderWithProviders";

describe("WorkspacePanelChrome", () => {
  it("renders the title, description, actions, and notices together", () => {
    renderWithProviders(
      <WorkspacePanelHeader
        title="Inventory Summary"
        description="Review on-hand inventory by SKU and customer."
        actions={<button type="button">Export Excel</button>}
        notices={["This order will affect shared inventory."]}
        errorMessage="Unable to load the latest records."
      />
    );

    expect(screen.getByRole("heading", { name: "Inventory Summary" })).toBeInTheDocument();
    expect(screen.getByText("Review on-hand inventory by SKU and customer.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export Excel" })).toBeInTheDocument();
    expect(screen.getByText("This order will affect shared inventory.")).toBeInTheDocument();
    expect(screen.getByText("Unable to load the latest records.")).toBeInTheDocument();
  });

  it("builds reusable grid overlays for empty and loading states", () => {
    const slots = buildWorkspaceGridSlots({
      emptyTitle: "No rows",
      emptyDescription: "Try changing filters.",
      loadingTitle: "Loading rows",
      loadingDescription: "Refreshing the grid."
    });

    const EmptyOverlay = slots.noRowsOverlay;
    const LoadingOverlay = slots.loadingOverlay;

    renderWithProviders(
      <div>
        <EmptyOverlay />
        <LoadingOverlay />
      </div>
    );

    expect(screen.getByText("No rows")).toBeInTheDocument();
    expect(screen.getByText("Try changing filters.")).toBeInTheDocument();
    expect(screen.getByText("Loading rows")).toBeInTheDocument();
    expect(screen.getByText("Refreshing the grid.")).toBeInTheDocument();
  });
});
