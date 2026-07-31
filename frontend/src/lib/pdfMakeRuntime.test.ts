// @vitest-environment node

import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPdfDefinitionBuffer } from "./pdfMakeRuntime";

const { createPdf } = vi.hoisted(() => ({
  createPdf: vi.fn()
}));

vi.mock("pdfmake/build/pdfmake", () => ({ createPdf }));

class PdfStreamStub extends EventEmitter {
  private chunks: Uint8Array[];
  private failure?: Error;

  constructor(chunks: Uint8Array[] = [], failure?: Error) {
    super();
    this.chunks = [...chunks];
    this.failure = failure;
  }

  read() {
    return this.chunks.shift() ?? null;
  }

  end() {
    if (this.failure) {
      this.emit("error", this.failure);
      return;
    }
    this.emit("readable");
    this.emit("end");
  }

  destroy() {}
}

describe("getPdfDefinitionBuffer", () => {
  beforeEach(() => {
    createPdf.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects before rendering when a remote font cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(getPdfDefinitionBuffer(
      { content: ["invoice"] },
      {},
      { BillingFont: { normal: "https://fonts.example.test/unavailable.otf" } }
    )).rejects.toThrow("Could not load PDF resource");
    expect(createPdf).not.toHaveBeenCalled();
  });

  it("passes preloaded font bytes through the virtual file system", async () => {
    const fontUrl = "https://fonts.example.test/available.otf";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => Uint8Array.from([7, 8, 9]).buffer
    }));
    createPdf.mockReturnValue({
      getStream: () => new PdfStreamStub([Uint8Array.from([1, 2]), Uint8Array.from([3])])
    });

    const result = await getPdfDefinitionBuffer(
      { content: ["invoice"] },
      {},
      { BillingFont: { normal: fontUrl } }
    );

    expect([...result]).toEqual([1, 2, 3]);
    expect(createPdf).toHaveBeenCalledWith(
      expect.any(Object),
      {},
      { BillingFont: { normal: fontUrl } },
      { [fontUrl]: "BwgJ" }
    );
  });

  it("rejects immediately when the PDF stream emits an error", async () => {
    createPdf.mockReturnValue({
      getStream: () => new PdfStreamStub([], new Error("layout failed"))
    });

    await expect(getPdfDefinitionBuffer(
      { content: ["invoice"] },
      {},
      { BillingFont: { normal: "embedded-font.ttf" } }
    )).rejects.toThrow("layout failed");
  });
});
