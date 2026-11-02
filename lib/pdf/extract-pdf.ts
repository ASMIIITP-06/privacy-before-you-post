export const SCANNED_PDF_MESSAGE = 'This PDF appears to be scanned or image-based. Text extraction could not read its contents.';

const PDF_WORKER_PATH = '/pdf.worker.min.mjs';

export interface PdfPageText {
  page: number;
  text: string;
}

export interface PdfExtraction {
  pageCount: number;
  pages: PdfPageText[];
  characterCount: number;
  pagesWithoutText: number[];
  scanned: boolean;
}

interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
  width?: number;
  transform?: number[];
}

function joinTextItems(items: readonly unknown[]): string {
  let text = '';
  let lastEnd: number | null = null;
  let lastY: number | null = null;
  for (const raw of items) {
    const item = raw as PdfTextItem;
    if (typeof item.str !== 'string') continue;
    const x = item.transform?.[4] ?? null;
    const y = item.transform?.[5] ?? null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) text += '\n';
    else if (lastEnd !== null && x !== null && x - lastEnd > 2) text += ' ';
    text += item.str;
    if (x !== null) lastEnd = x + (item.width ?? 0);
    lastY = y;
    if (item.hasEOL) {
      text += '\n';
      lastEnd = null;
      lastY = null;
    }
  }
  return text.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function describeReadFailure(error: unknown): string {
  if (error instanceof Error && error.name === 'PasswordException') {
    return 'This PDF is password-protected, so its text cannot be read.';
  }
  return 'This file could not be opened as a PDF. It may be damaged or not a valid PDF.';
}

export async function extractPdfText(file: File): Promise<PdfExtraction> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_PATH;
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
  });

  try {
    const doc = await loadingTask.promise;
    const pages: PdfPageText[] = [];
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      try {
        const content = await page.getTextContent();
        pages.push({ page: number, text: joinTextItems(content.items) });
      } finally {
        page.cleanup();
      }
    }
    const characterCount = pages.reduce((total, page) => total + page.text.replace(/\s/g, '').length, 0);
    return {
      pageCount: doc.numPages,
      pages,
      characterCount,
      pagesWithoutText: pages.filter((page) => !/\S/.test(page.text)).map((page) => page.page),
      scanned: characterCount === 0,
    };
  } catch (error) {
    throw new Error(describeReadFailure(error));
  } finally {
    await loadingTask.destroy();
  }
}
