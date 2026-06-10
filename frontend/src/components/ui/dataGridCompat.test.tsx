import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DataGrid, type GridColDef } from "./dataGridCompat";

describe("DataGrid compatibility layer", () => {
  it("keeps editable columns editable when they also define renderCell", async () => {
    const processRowUpdate = vi.fn((nextRow) => nextRow);
    const columns: GridColDef<{ id: number; sku: string }>[] = [
      {
        field: "sku",
        headerName: "SKU",
        editable: true,
        renderCell: () => <span>Formatted SKU</span>
      }
    ];

    render(
      <DataGrid
        rows={[{ id: 1, sku: "ABC-123" }]}
        columns={columns}
        processRowUpdate={processRowUpdate}
      />
    );

    const input = screen.getByDisplayValue("ABC-123");
    expect(screen.queryByText("Formatted SKU")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "XYZ-789" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(processRowUpdate).toHaveBeenCalledWith(
        { id: 1, sku: "XYZ-789" },
        { id: 1, sku: "ABC-123" }
      );
    });
  });

  it("does not commit editable cells when the value did not change", () => {
    const processRowUpdate = vi.fn((nextRow) => nextRow);
    const columns: GridColDef<{ id: number; quantity: number }>[] = [
      {
        field: "quantity",
        headerName: "Quantity",
        editable: true,
        type: "number"
      }
    ];

    render(
      <DataGrid
        rows={[{ id: 1, quantity: 12 }]}
        columns={columns}
        processRowUpdate={processRowUpdate}
      />
    );

    fireEvent.blur(screen.getByDisplayValue("12"));

    expect(processRowUpdate).not.toHaveBeenCalled();
  });

  it("does not commit numeric edits when the parsed row value is unchanged", () => {
    const processRowUpdate = vi.fn((nextRow) => nextRow);
    const columns: GridColDef<{ id: number; quantity: number }>[] = [
      {
        field: "quantity",
        headerName: "Quantity",
        editable: true,
        type: "number"
      }
    ];

    render(
      <DataGrid
        rows={[{ id: 1, quantity: 12 }]}
        columns={columns}
        processRowUpdate={processRowUpdate}
      />
    );

    const input = screen.getByDisplayValue("12");
    fireEvent.change(input, { target: { value: "12.0" } });
    fireEvent.blur(input);

    expect(processRowUpdate).not.toHaveBeenCalled();
  });
});
