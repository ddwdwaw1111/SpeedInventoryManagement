import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    copyInboundDocument: vi.fn(),
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

describe("InboundDetailPage inventory adjustment", () => {
  beforeEach(() => {
    mockedApi.copyInboundDocument.mockReset();
    mockedApi.createInventoryAdjustment.mockReset();
    mockedApi.updateInboundDocumentContainerType.mockReset();
    mockedApi.getInboundDocumentAttachmentDownloadUrl.mockReset();
  });

  it("opens the container balance adjustment with the generic correction reason", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Adjust Received Balance" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Reason Code")).toHaveValue("CORRECTION");
    expect(screen.getByLabelText("Container No.")).toHaveValue("1:1:GCXU5817233");
  });

  it("does not expose inventory adjustment actions to viewers", () => {
    renderPage({}, "viewer");

    expect(screen.queryByRole("button", { name: "Adjust Received Balance" })).not.toBeInTheDocument();
  });
});
