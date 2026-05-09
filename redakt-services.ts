import { AI_MODEL, CDN, STAMP_LABELS, RENDER_SCALE } from "./redakt-constants";
import { loadExternalScript } from "./redakt-utils";
import type { ExportOptions, PageData } from "./redakt-types";

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
      .map((it) => {
        const [cx, cy]: [number, number] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
        const fontSize = Math.abs(it.transform[3]) * RENDER_SCALE;
        return {
          text: it.str,
          x: cx,
          y: cy - fontSize,
          w: it.width * RENDER_SCALE,
          h: fontSize * 1.3,
        };
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

export async function exportRedactedPdf(
  pages: PageData[],
  boxes: Array<{ pageIdx: number; x: number; y: number; w: number; h: number }>,
  opts: ExportOptions,
): Promise<void> {
  await loadExternalScript(CDN.jsPdf);
  const { jsPDF } = (window as any).jspdf;
  const first = pages[0];
  const doc = new jsPDF({ unit: "px", format: [first.width, first.height], compress: true });

  pages.forEach((page, pi) => {
    if (pi > 0) doc.addPage([page.width, page.height]);
    doc.addImage(page.dataUrl, "JPEG", 0, 0, page.width, page.height);

    doc.setFillColor(0, 0, 0);
    boxes.filter((b) => b.pageIdx === pi).forEach((b) => doc.rect(b.x, b.y, b.w, b.h, "F"));

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
  });

  doc.save(`${opts.filename || "redacted_document"}.pdf`);
}

export async function requestAiRedactionTerms(pages: PageData[]): Promise<string[]> {
  const corpus = pages
    .map((p, pi) => `[PAGE ${pi + 1}] ` + p.textItems.map((t) => t.text).join(" "))
    .join("\n");

  const prompt = `You are a CIA analyst. Return ONLY a JSON array of exact strings to redact from this document. Include: proper names, locations, phone numbers, codes, operational dates, monetary amounts, identification numbers (passport, badge, account, flight).\n\n${corpus}\n\nReturn only the JSON array, nothing else.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  const raw = (data?.content?.[0]?.text ?? "[]").replace(/```json|```/g, "").trim();
  return JSON.parse(raw);
}
