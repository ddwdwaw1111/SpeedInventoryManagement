import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    previewInboundDeletion: vi.fn(),
    deleteInboundWithDependencies: vi.fn()
  }
}));

import { api } from "../lib/api";
import { createInboundDocument } from "../test/fixtures";
import { renderWithProviders } from "../test/renderWithProviders";
import { InboundDeletionRollbackDialog } from "./InboundDeletionRollbackDialog";

const mockedApi = api as unknown as {
  previewInboundDeletion: ReturnType<typeof vi.fn>;
  deleteInboundWithDependencies: ReturnType<typeof vi.fn>;
};

describe("InboundDeletionRollbackDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.previewInboundDeletion.mockResolvedValue({
      documentId: 41,
      containerNo: "CONT-41",
      hasDependencies: true,
      canExecute: true,
      dependencies: [
        {
          sourceType: "OUTBOUND",
          documentId: 71,
          reference: "PO-71",
          activityAt: "2026-08-01T12:00:00Z",
          lastLedgerId: 901,
          affectedQty: 20,
          affectedPallets: 1,
          affectedContainers: ["CONT-41", "CONT-99"],
          reversible: true,
          includesTransfer: true
        },
        {
          sourceType: "ADJUSTMENT",
          documentId: 72,
          reference: "ADJ-72",
          activityAt: "2026-08-02T12:00:00Z",
          lastLedgerId: 902,
          affectedQty: 3,
          affectedPallets: 0,
          reversible: true
        }
      ]
    });
    mockedApi.deleteInboundWithDependencies.mockResolvedValue({
      documentId: 41,
      containerNo: "CONT-41",
      deletedAt: "2026-08-10T12:00:00Z",
      deletedDependencies: []
    });
  });

  it("requires explicit selection of every dependency and submits their versions", async () => {
    const onDeleted = vi.fn();
    renderWithProviders(
      <InboundDeletionRollbackDialog
        open
        document={createInboundDocument({ id: 41, containerNo: "CONT-41", status: "CONFIRMED" })}
        onClose={vi.fn()}
        onDeleted={onDeleted}
      />
    );

    expect(await screen.findByText("PO-71")).toBeInTheDocument();
    expect(screen.getByText("Affected Containers: CONT-41, CONT-99")).toBeInTheDocument();
    const confirmButton = screen.getByRole("button", { name: "Rollback selected and delete receipt" });
    expect(confirmButton).toBeDisabled();

    fireEvent.click(screen.getByText("PO-71"));
    fireEvent.click(screen.getByText("ADJ-72"));
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);

    await waitFor(() => expect(mockedApi.deleteInboundWithDependencies).toHaveBeenCalledWith(41, [
      { sourceType: "OUTBOUND", documentId: 71, lastLedgerId: 901 },
      { sourceType: "ADJUSTMENT", documentId: 72, lastLedgerId: 902 }
    ]));
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });
});
