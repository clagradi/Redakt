import { CDN, STAMP_LABELS, RENDER_SCALE } from "./redakt-constants";
import { loadExternalScript, wordToBox } from "./redakt-utils";
import type { AccountState, ExportOptions, PageData, RedactionBox, RedactionReceipt } from "./redakt-types";

export async function loadPdfDocument(
  file: File,
  onProgress: (current: number, total: number) => void,
): Promise<PageData[]> {
  await loadExternalScript(CDN.pdfJs);
  const pdfjs = (window as any).pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;

  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out: PageData[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress(i, pdf.numPages);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: RENDER_SCALE });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

    const tc = await page.getTextContent();
    const textItems = (tc.items as any[])
      .filter((it) => it.str?.trim().length > 0)
      .flatMap((it) => {
        const rawText: string = String(it.str);
        const [cx, cy]: [number, number] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
        const fontSize = Math.abs(it.transform[3]) * RENDER_SCALE;

        const segments: string[] = rawText.match(/\S+|\s+/g) ?? [rawText];
        if (segments.length === 1 && segments[0] === rawText) {
          return [{
            text: rawText,
            x: cx,
            y: cy - fontSize,
            w: it.width * RENDER_SCALE,
            h: fontSize * 1.05,
          }];
        }

        const baseLen = rawText.length;
        let cursor = 0;
        return segments.flatMap((segment: string) => {
          if (!segment.trim()) {
            cursor += (segment.length / baseLen) * it.width * RENDER_SCALE;
            return [];
          }

          const w = ((segment.length / baseLen) * it.width) * RENDER_SCALE;
          const item = {
            text: segment,
            x: cx + cursor,
            y: cy - fontSize,
            w,
            h: fontSize * 1.05,
          };
          cursor += (segment.length / baseLen) * it.width * RENDER_SCALE;
          return [item];
        });
      });

    out.push({
      dataUrl: canvas.toDataURL("image/jpeg", 0.94),
      width: viewport.width,
      height: viewport.height,
      textItems,
    });
  }

  return out;
}

export async function generateSampleDocument(): Promise<File> {
  await loadExternalScript(CDN.jsPdf);
  const { jsPDF } = (window as any).jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const M = 18;

  doc.setFillColor(245, 240, 225);
  doc.rect(0, 0, 210, 297, "F");
  doc.setFont("courier", "bold");
  doc.setFontSize(8);
  doc.setTextColor(140, 0, 0);
  doc.text("— TOP SECRET / SCI / NOFORN / ORCON —", 105, 14, { align: "center" });
  doc.setDrawColor(140, 0, 0);
  doc.setLineWidth(0.4);
  doc.line(M, 17, 210 - M, 17);
  doc.line(M, 17.8, 210 - M, 17.8);

  doc.setFont("courier", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20, 10, 0);
  doc.text("INTELLIGENCE REPORT — OPERATION SILENT NIGHT", 105, 28, { align: "center" });
  doc.setFont("courier", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(60, 40, 20);
  doc.text("File: 7741-B/OMEGA   Date: March 14, 1987   Classification: TOP SECRET", 105, 34, {
    align: "center",
  });

  doc.setFont("courier", "normal");
  doc.setFontSize(10);
  doc.setTextColor(20, 10, 0);
  const body = `Special Agent Marcus D. Holloway, badge 3847-F, has confirmed
contact with the source codenamed FALCON at 23:14 hours on March 12.
The meeting took place at the abandoned warehouse on 47 Hope Street,
Manhattan.

The source revealed that the head of the organization, known as
THE GHOST, is currently residing at the residence of Senator
Anthony Carlucci, Hampton, NY. Encrypted contact: +1 631-447-2291.

Wire transfers to offshore accounts in the Cayman Islands, bank
KY-447821, are scheduled for March 19. Estimated amount:
USD 4,700,000.

Identified courier: Elena Vasquez, passport RU-449821,
Delta flight DL-447 at 06:30 from JFK International.

Agent Holloway recommends immediate surveillance of the Hampton
residence. Coordinate with the New York field office and local
handler, codename OMEGA-7. Maximum operational discretion required.

SECONDARY CONTACTS:
  - Maria Bellini, Plaza Hotel, NY (room 412)
  - Giuseppe Moretti, First National Bank, Chicago
  - Sofia Ricci, Ricci & Associates Law Firm, Boston`;
  let y = 44;
  doc.splitTextToSize(body, 210 - M * 2).forEach((ln: string) => {
    doc.text(ln, M, y);
    y += 6;
  });

  doc.setFont("courier", "bold");
  doc.setFontSize(8);
  doc.setTextColor(80, 60, 30);
  doc.text("SIGNATURE: Director R. Malone   |   Special Operations Unit — DC", 105, 280, { align: "center" });
  doc.setFontSize(7);
  doc.setTextColor(150, 130, 100);
  doc.text("DISTRIBUTION: strictly confidential — authorized recipients only", 105, 287, { align: "center" });

  doc.addPage();
  doc.setFillColor(245, 240, 225);
  doc.rect(0, 0, 210, 297, "F");
  doc.setFont("courier", "bold");
  doc.setFontSize(8);
  doc.setTextColor(140, 0, 0);
  doc.text("— TOP SECRET / SCI / NOFORN —", 105, 14, { align: "center" });
  doc.setDrawColor(140, 0, 0);
  doc.line(M, 17, 210 - M, 17);
  doc.line(M, 17.8, 210 - M, 17.8);
  doc.setFont("courier", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20, 10, 0);
  doc.text("ANNEX A — OPERATIONAL DETAILS", 105, 28, { align: "center" });

  doc.setFont("courier", "normal");
  doc.setFontSize(10);
  doc.setTextColor(20, 10, 0);
  const body2 = `RESOURCES DEPLOYED:

Team A (Manhattan):
  Lead:      Cpt. Lawrence Bishop    badge 2891-D
  Operators: Sgt. Pamela Reid        badge 4477-G
             Sgt. David Cohen        badge 5512-H
  Vehicles:  Ford Crown Victoria — plate AB 447 PQ
             Chevy Suburban         — plate CD 991 RS

Team B (Long Island):
  Lead:      Maj. Steven Greco       badge 1102-K
  Operators: Sgt. Linda Marino       badge 3344-J
             Sgt. Robert Esposito    badge 6678-L

MONITORED ACCOUNTS:
  US-CHASE-1010-0000-0123-456   (Carlucci, A.)
  KY-447821 / Cayman National Bank (Vasquez, E.)
  CH93-0076-2011-6238-5295-7    (Moretti, G.)

ACTIVE WIRETAPS:
  - +1 631-447-2291  (Carlucci residence, Hampton)
  - +1 212-885-7441  (Bellini's suite, Plaza)
  - +41 22-778-9920  (Geneva, contact X)

NEXT OPERATIONAL MEETING: March 16, 1987, 09:00,
temporary location: 12 Park Avenue, NY. Access code: 4477-OMEGA.`;
  y = 40;
  doc.splitTextToSize(body2, 210 - M * 2).forEach((ln: string) => {
    doc.text(ln, M, y);
    y += 6;
  });

  doc.setFontSize(7);
  doc.setTextColor(150, 130, 100);
  doc.text("PAGE 2 / 2 — REDAKT SAMPLE DOCUMENT", 105, 287, { align: "center" });

  const blob = doc.output("blob");
  return new File([blob], "sample_classified.pdf", { type: "application/pdf" });
}

const sha256Hex = async (buf: ArrayBuffer): Promise<string> => {
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export interface ExportResult {
  filename: string;
  receipt: RedactionReceipt;
}

export async function exportRedactedPdf(
  pages: PageData[],
  boxes: RedactionBox[],
  opts: ExportOptions,
  account: AccountState | null = null,
): Promise<ExportResult> {
  await loadExternalScript(CDN.jsPdf);
  const { jsPDF } = (window as any).jspdf;
  const first = pages[0];
  const doc = new jsPDF({ unit: "px", format: [first.width, first.height], compress: true });

  const totalRedactions = boxes.length;
  const exportedAt = new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC";

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    if (pi > 0) doc.addPage([page.width, page.height]);

    // Flatten page image + black redaction rects into a single raster.
    // This prevents the original page bytes from being recoverable from the
    // exported PDF (drawing rects as vector overlays leaves the source image intact).
    const flat = document.createElement("canvas");
    flat.width = page.width;
    flat.height = page.height;
    const fctx = flat.getContext("2d")!;
    const img = new Image();
    img.src = page.dataUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("page image failed to load"));
    });
    fctx.drawImage(img, 0, 0, page.width, page.height);
    fctx.fillStyle = "#000";
    boxes.filter((b) => b.pageIdx === pi).forEach((b) => fctx.fillRect(b.x, b.y, b.w, b.h));

    doc.addImage(flat.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, page.width, page.height);

    if (opts.stamp !== "none") {
      const label = STAMP_LABELS[opts.stamp];
      doc.setFont("helvetica", "bold");
      const fs = Math.max(40, page.width * 0.06);
      doc.setFontSize(fs);
      doc.setTextColor(180, 0, 0);
      doc.text(label, page.width - fs * 4.5, fs * 1.5, { angle: 18 });
      doc.setDrawColor(180, 0, 0);
      doc.setLineWidth(fs / 12);
      const tw = doc.getTextWidth(label);
      doc.rect(page.width - fs * 4.7, fs * 0.55, tw + fs * 0.3, fs * 1.15);
    }

    const wm = opts.watermark.trim();
    if (wm) {
      doc.setFont("courier", "normal");
      doc.setFontSize(36);
      doc.setTextColor(180, 180, 180);
      (doc as any).setGState?.(new (doc as any).GState({ opacity: 0.1 }));
      doc.text(wm, page.width / 2, page.height / 2, { align: "center", angle: -30 });
      (doc as any).setGState?.(new (doc as any).GState({ opacity: 1 }));
    }

    // Audit footer
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `Redacted with Epsteiner — ${totalRedactions} region${totalRedactions === 1 ? "" : "s"} · page ${pi + 1}/${pages.length} · ${exportedAt}`,
      page.width / 2,
      page.height - 10,
      { align: "center" },
    );
  }

  const safeName = (opts.filename || "redacted_document")
    .normalize("NFKD")
    .replace(/[^\w\s.-]+/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "redacted_document";

  // Optional password protection (jsPDF supports user + owner passwords).
  const password = opts.password?.trim();
  if (password) {
    (doc as any).setEncryption?.("user", password, password, [
      "print", "modify", "copy", "annot-forms",
    ]);
  }

  const pdfBlob: Blob = doc.output("blob");
  const pdfBuffer = await pdfBlob.arrayBuffer();
  const outputSha256 = await sha256Hex(pdfBuffer);

  downloadBlob(pdfBlob, `${safeName}.pdf`);

  const redactionsPerPage: Record<number, number> = {};
  boxes.forEach((b) => {
    redactionsPerPage[b.pageIdx] = (redactionsPerPage[b.pageIdx] ?? 0) + 1;
  });

  const receipt: RedactionReceipt = {
    schema: "epsteiner.receipt.v1",
    generatedAt: new Date().toISOString(),
    documentName: safeName,
    pageCount: pages.length,
    redactionCount: totalRedactions,
    redactionsPerPage,
    exporter: account ? { email: account.email, plan: account.plan } : null,
    stamp: opts.stamp,
    watermarked: !!opts.watermark.trim(),
    passwordProtected: !!password,
    outputSha256,
    regions: boxes.map((b) => ({
      pageIdx: b.pageIdx,
      x: Math.round(b.x),
      y: Math.round(b.y),
      w: Math.round(b.w),
      h: Math.round(b.h),
    })),
  };

  if (opts.generateReceipt) {
    const json = JSON.stringify(receipt, null, 2);
    downloadBlob(new Blob([json], { type: "application/json" }), `${safeName}.receipt.json`);
  }

  return { filename: `${safeName}.pdf`, receipt };
}

const SENSITIVE_LABELS = new Set([
  "account",
  "badge",
  "code",
  "contact",
  "date",
  "flight",
  "passport",
  "plate",
]);

const MONTHS = new Set([
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]);

const TITLES = new Set([
  "agent",
  "captain",
  "cpt",
  "director",
  "dr",
  "maj",
  "major",
  "senator",
  "sgt",
]);

const cleanToken = (text: string): string =>
  text.replace(/^[^\w+@]+|[^\w@.+-]+$/g, "");

const isCapitalized = (token: string): boolean =>
  /^[A-Z][a-z]{2,}$/.test(token) || /^[A-Z]\.$/.test(token);

const luhnValid = (digits: string): boolean => {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
};

const isSensitiveToken = (token: string): boolean => {
  const lower = token.toLowerCase();
  const digits = token.replace(/[\s-]/g, "");
  return (
    // email
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(token) ||
    // url
    /^https?:\/\/\S+$/i.test(token) ||
    // phone
    /^\+?\d[\d().-]{5,}\d$/.test(token) ||
    // currency / large amounts
    /^(?:usd|eur|gbp|chf|\$|€|£)?\s?\d{1,3}(?:[,.]\d{3})+(?:[.,]\d{2})?$/i.test(token) ||
    // time HH:MM
    /^\d{1,2}:\d{2}$/.test(token) ||
    // dates
    /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(token) ||
    /^\d{4}-\d{2}-\d{2}$/.test(token) ||
    // IBAN (rough; 15-34 alphanumerics starting with 2 letters)
    /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/i.test(token.replace(/\s/g, "")) ||
    // Italian Codice Fiscale
    /^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/i.test(token) ||
    // US SSN
    /^\d{3}-\d{2}-\d{4}$/.test(token) ||
    // IPv4
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(token) ||
    // MAC
    /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(token) ||
    // credit card (Luhn-validated)
    (/^\d{13,19}$/.test(digits) && luhnValid(digits)) ||
    // generic alpha-numeric code (badge / passport / plate / account)
    /^[A-Z]{1,4}-?\d{2,}(?:-[A-Z0-9]+)*$/i.test(token) ||
    MONTHS.has(lower)
  );
};

export function detectSensitiveRedactionBoxes(pages: PageData[]): RedactionBox[] {
  return pages.flatMap((page, pageIdx) => {
    const selected = new Set<number>();
    const tokens = page.textItems.map((item) => cleanToken(item.text));

    tokens.forEach((token, index) => {
      const lower = token.toLowerCase();
      const prevLower = tokens[index - 1]?.toLowerCase();

      if (isSensitiveToken(token) || SENSITIVE_LABELS.has(prevLower)) {
        selected.add(index);
      }

      if (MONTHS.has(lower)) {
        selected.add(index + 1);
        selected.add(index + 2);
      }

      if (TITLES.has(prevLower) && isCapitalized(token)) {
        selected.add(index);
        if (isCapitalized(tokens[index + 1] ?? "")) selected.add(index + 1);
        if (isCapitalized(tokens[index + 2] ?? "")) selected.add(index + 2);
      }

      if (isCapitalized(token) && isCapitalized(tokens[index + 1] ?? "")) {
        selected.add(index);
        selected.add(index + 1);
      }
    });

    return Array.from(selected)
      .filter((index) => page.textItems[index])
      .map((index) => wordToBox(pageIdx, page.textItems[index]));
  });
}
