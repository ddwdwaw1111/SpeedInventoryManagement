import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Drawer } from "./muiCompat";

describe("MUI compatibility layer", () => {
  it("preserves mobile-safe responsive width values", () => {
    render(
      <Drawer open PaperProps={{ sx: { width: { xs: "100%", sm: 420 } } }}>
        <div>Rate drawer</div>
      </Drawer>
    );

    const drawer = screen.getByText("Rate drawer").closest(".mui-drawer") as HTMLElement;

    expect(drawer.style.width).toBe("min(420px, 100%)");
  });
});
