import type { CustomTableLayout, TDocumentDefinitions, TFontDictionary } from "pdfmake/interfaces";

type PdfMakeRuntime = typeof import("pdfmake/build/pdfmake");
type PdfMakeRuntimeNamespace = Partial<PdfMakeRuntime> & { default?: PdfMakeRuntime };

async function loadPdfMakeRuntime(): Promise<PdfMakeRuntime> {
  const pdfMake = await import("pdfmake/build/pdfmake") as unknown as PdfMakeRuntimeNamespace;
  if (typeof pdfMake.createPdf === "function") {
    return pdfMake as PdfMakeRuntime;
  }
  if (pdfMake.default) {
    return pdfMake.default;
  }
  throw new Error("Could not load PDF runtime.");
}

export async function downloadPdfDefinition(
  definition: TDocumentDefinitions,
  tableLayouts: Record<string, CustomTableLayout>,
  fonts: TFontDictionary,
  fileName: string
) {
  const pdfMake = await loadPdfMakeRuntime();
  pdfMake.createPdf(definition, tableLayouts, fonts).download(fileName);
}
