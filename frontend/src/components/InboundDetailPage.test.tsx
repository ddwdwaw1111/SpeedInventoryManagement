import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    copyInboundDocument: vi.fn(),
    createInboundCorrectionDraft: vi.fn(),
    createInventoryAdjustment: vi.fn(),
    updateInboundDocumentContainerType: vi.fn(),
    getInboundDocumentAttachmentDownloadUrl: vi.fn()
  }
}));

import { api } from "../lib/api";
import { renderWithProviders } from "../test/renderWithProviders";
import { createInboundDocument, createItem } from "../test/fixtures";
import { InboundDetailPage } from "./InboundDetailPage";

const mockedApi = api as unknown as {
  copyInboundDocument: ReturnType<typeof vi.fn>;
  createInboundCorrectionDraft: ReturnType<typeof vi.fn>;
  createInventoryAdjustment: ReturnType<typeof vi.fn>;
  updateInboundDocumentContainerType: ReturnType<typeof vi.fn>;
  getInboundDocumentAttachmentDownloadUrl: ReturnType<typeof vi.fn>;
};

function renderPage(overrides: Parameters<typeof createInboundDocument>[0] = {}, role: "admin" | "operator" | "viewer" = "admin") {
  const document = createInboundDocument({
    status: "CONFIRMED",
    trackingStatus: "RECEIVED",
    confirmedAt: "2026-03-24T11:00:00Z",
    ...overrides
  });
  const onRefresh = vi.fn().mockResolvedValue(undefined);
  const onOpenReceiptEditor = vi.fn();

  renderWithProviders(
    <InboundDetailPage
      document={document}
      items={[createItem({ containerNo: document.containerNo, customerId: document.customerId })]}
      currentUserRole={role}
      isLoading={false}
      onRefresh={onRefresh}
      onNavigate={vi.fn()}
      onOpenInboundDetail={vi.fn()}
      onOpenReceiptEditor={onOpenReceiptEditor}
    />
  );

  return { document, onRefresh, onOpenReceiptEditor };
}

describe("InboundDetailPage correction workflow", () => {
  beforeEach(() => {
    mockedApi.copyInboundDocument.mockReset();
    mockedApi.createInboundCorrectionDraft.mockReset();
    mockedApi.createInventoryAdjustment.mockReset();
    mockedApi.updateInboundDocumentContainerType.mockReset();
    mockedApi.getInboundDocumentAttachmentDownloadUrl.mockReset();
  });

  it("creates a linked correction draft after explicit confirmation", async () => {
    const correctionDraft = createInboundDocument({
      id: 22,
      status: "DRAFT",
      correctsDocumentId: 1
    });
    mockedApi.createInboundCorrectionDraft.mockResolvedValue(correctionDraft);
    const { onRefresh, onOpenReceiptEditor } = renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Correct Receipt" }));

    expect(screen.getByRole("heading", { name: "Reverse and recreate this receipt?" })).toBeInTheDocument();
    expect(screen.getByText(/Inventory remains unchanged while you edit the draft/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create Correction Draft" }));

    await waitFor(() => expect(mockedApi.createInboundCorrectionDraft).toHaveBeenCalledWith(1));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onOpenReceiptEditor).toHaveBeenCalledWith(22);
  });

  it("opens the container balance adjustment with the inbound correction reason", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Adjust Received Balance" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Reason Code")).toHaveValue("INBOUND_CORRECTION");
    expect(screen.getByLabelText("Container No.")).toHaveValue("1:1:GCXU5817233");
  });

  it("keeps a corrected original visible but removes mutation actions", () => {
    renderPage({
      correctedAt: "2026-03-25T10:00:00Z",
      correctedByDocumentId: 22
    });

    expect(screen.getByText("Original receipt reversed")).toBeInTheDocument();
    expect(screen.getByText("This receipt remains as an audit record and was replaced by receipt #22.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Correct Receipt" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adjust Received Balance" })).not.toBeInTheDocument();
  });

  it("does not expose correction actions to viewers", () => {
    renderPage({}, "viewer");

    expect(screen.queryByRole("button", { name: "Correct Receipt" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adjust Received Balance" })).not.toBeInTheDocument();
  });
});
