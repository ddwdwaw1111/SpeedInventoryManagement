import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocumentAttachmentsPanel } from "./DocumentAttachmentsPanel";
import { renderWithProviders } from "../test/renderWithProviders";

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

afterEach(() => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: originalCreateObjectURL
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: originalRevokeObjectURL
  });
});

describe("DocumentAttachmentsPanel", () => {
  it("can collect pending files without showing the upload action", async () => {
    const user = userEvent.setup();
    const onPendingAttachmentsChange = vi.fn();

    renderWithProviders(
      <DocumentAttachmentsPanel
        attachments={[]}
        pendingAttachments={[]}
        showUploadButton={false}
        onPendingAttachmentsChange={onPendingAttachmentsChange}
        onGetDownloadUrl={async () => ""}
      />
    );

    const file = new File(["packing list"], "packing-list.pdf", { type: "application/pdf" });
    const fileInput = document.querySelector<HTMLInputElement>("input[type='file']");

    expect(screen.getByRole("button", { name: /add files/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /upload files/i })).not.toBeInTheDocument();
    expect(fileInput).not.toBeNull();

    await user.upload(fileInput as HTMLInputElement, file);

    expect(onPendingAttachmentsChange).toHaveBeenCalledWith([
      expect.objectContaining({
        file,
        displayName: "packing-list.pdf"
      })
    ]);
  });

  it("previews a pending file before upload and revokes the local object URL", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => "blob:pending-packing-list");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL
    });
    const file = new File(["%PDF-packing-list"], "packing-list.pdf", { type: "application/pdf" });

    renderWithProviders(
      <DocumentAttachmentsPanel
        attachments={[]}
        pendingAttachments={[{ id: "pending-1", file, displayName: "Draft Packing List" }]}
        showUploadButton={false}
        onPendingAttachmentsChange={vi.fn()}
        onGetDownloadUrl={async () => ""}
      />
    );

    await user.click(screen.getByRole("button", { name: /preview file/i }));

    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(screen.getByRole("dialog", { name: /attachment preview/i })).toBeInTheDocument();
    expect(screen.getByTitle("Draft Packing List")).toHaveAttribute("src", "blob:pending-packing-list");

    await user.click(screen.getByRole("button", { name: /close/i }));

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:pending-packing-list");
  });
});
