import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { InlineAlert, useConfirmDialog, useFeedbackToast } from "./Feedback";
import { renderWithProviders } from "../test/renderWithProviders";

function ConfirmDialogHarness() {
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [result, setResult] = useState("idle");

  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const accepted = await confirm({
            title: "Archive receipt",
            message: "This action will archive the selected receipt.",
            confirmLabel: "Archive",
            cancelLabel: "Cancel"
          });
          setResult(accepted ? "accepted" : "cancelled");
        }}
      >
        Open Dialog
      </button>
      <div>{result}</div>
      {confirmationDialog}
    </>
  );
}

function FeedbackToastHarness() {
  const { showSuccess, feedbackToast } = useFeedbackToast();

  return (
    <>
      <button type="button" onClick={() => showSuccess("Saved successfully.")}>
        Show Toast
      </button>
      {feedbackToast}
    </>
  );
}

describe("Feedback", () => {
  it("renders inline alerts with the provided message", () => {
    renderWithProviders(<InlineAlert severity="warning">Container number already exists.</InlineAlert>);

    expect(screen.getByText("Container number already exists.")).toBeInTheDocument();
  });

  it("resolves the confirmation hook when the confirm button is pressed", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ConfirmDialogHarness />);

    await user.click(screen.getByRole("button", { name: "Open Dialog" }));
    expect(screen.getByText("Archive receipt")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(screen.getByText("accepted")).toBeInTheDocument();
  });

  it("renders success toast feedback when requested", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FeedbackToastHarness />);

    await user.click(screen.getByRole("button", { name: "Show Toast" }));
    expect(screen.getByText("Saved successfully.")).toBeInTheDocument();
  });
});
