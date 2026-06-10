import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BarChart } from "./chartCompat";

describe("BarChart compatibility layer", () => {
  it("uses the chart classes already styled by global CSS", () => {
    const { container } = render(
      <BarChart
        dataset={[{ day: "Mon", pallets: 8 }]}
        series={[{ dataKey: "pallets", label: "Pallets" }]}
        xAxis={[{ dataKey: "day" }]}
      />
    );

    expect(screen.getByRole("img", { name: "Pallets" })).toBeInTheDocument();
    expect(container.querySelector(".local-chart__grid-line")).not.toBeNull();
    expect(container.querySelector(".local-chart__axis-text")).not.toBeNull();
    expect(container.querySelector(".local-chart__grid")).toBeNull();
    expect(container.querySelector(".local-chart__axis")).toBeNull();
    expect(container.querySelector(".local-chart__label")).toBeNull();
  });
});
