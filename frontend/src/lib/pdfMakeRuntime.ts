import type { CustomTableLayout, TDocumentDefinitions, TFontDictionary } from "pdfmake/interfaces";

type PdfMakeRuntime = typeof import("pdfmake/build/pdfmake");
type PdfMakeRuntimeNamespace = Partial<PdfMakeRuntime> & { default?: PdfMakeRuntime };
type PdfVirtualFileSystem = Record<string, string>;

const PDF_RESOURCE_TIMEOUT_MS = 60_000;
const PDF_RENDER_TIMEOUT_MS = 180_000;
const remoteResourceCache = new Map<string, Promise<string>>();

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
  const bytes = await getPdfDefinitionBuffer(definition, tableLayouts, fonts);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const url = window.URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
}

export async function getPdfDefinitionBuffer(
  definition: TDocumentDefinitions,
  tableLayouts: Record<string, CustomTableLayout>,
  fonts: TFontDictionary
) {
  const [pdfMake, vfs] = await Promise.all([
    loadPdfMakeRuntime(),
    buildPdfVirtualFileSystem(fonts)
  ]);
  const stream = pdfMake.createPdf(definition, tableLayouts, fonts, vfs).getStream();
  return collectPdfStream(stream);
}

function collectPdfStream(stream: PDFKit.PDFDocument) {
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let settled = false;
    const timeoutId = globalThis.setTimeout(() => {
      fail(new Error("PDF rendering timed out."));
      (stream as unknown as { destroy?: () => void }).destroy?.();
    }, PDF_RENDER_TIMEOUT_MS);

    function fail(error: unknown) {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeoutId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }

    stream.on("readable", () => {
      let chunk: string | Uint8Array | null;
      while ((chunk = stream.read()) !== null) {
        chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk));
      }
    });
    stream.on("error", fail);
    stream.on("end", () => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeoutId);
      resolve(concatenateBytes(chunks));
    });

    try {
      stream.end();
    } catch (error) {
      fail(error);
    }
  });
}

function concatenateBytes(parts: readonly Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

async function buildPdfVirtualFileSystem(fonts: TFontDictionary): Promise<PdfVirtualFileSystem> {
  const urls = new Set<string>();
  for (const family of Object.values(fonts)) {
    for (const source of [family.normal, family.bold, family.italics, family.bolditalics]) {
      if (typeof source === "string" && isRemoteResource(source)) {
        urls.add(source);
      }
    }
  }

  const entries = await Promise.all([...urls].map(async (url) => [url, await loadRemoteResource(url)] as const));
  return Object.fromEntries(entries);
}

function loadRemoteResource(url: string) {
  const cached = remoteResourceCache.get(url);
  if (cached) {
    return cached;
  }

  const request = fetchRemoteResource(url).catch((error) => {
    remoteResourceCache.delete(url);
    throw error;
  });
  remoteResourceCache.set(url, request);
  return request;
}

async function fetchRemoteResource(url: string) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), PDF_RESOURCE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return arrayBufferToBase64(await response.arrayBuffer());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not load PDF resource ${url}: ${reason}`);
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

function isRemoteResource(value: string) {
  return /^https?:\/\//i.test(value);
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(chunks.join(""));
}
