import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { PROPOSAL_SANS_BOLD_BASE64, PROPOSAL_SANS_REGULAR_BASE64 } from "./proposal-fonts";

export async function meetingPdfFonts(pdf: PDFDocument) {
  pdf.registerFontkit(fontkit);
  const bytes = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  return {
    regular: await pdf.embedFont(bytes(PROPOSAL_SANS_REGULAR_BASE64), { subset: true }),
    bold: await pdf.embedFont(bytes(PROPOSAL_SANS_BOLD_BASE64), { subset: true }),
  };
}

/** Wrap by rendered width, including unbroken record IDs and URLs. */
export function wrapMeetingPdfText(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    for (const word of paragraph.trim().split(/\s+/)) {
      if (line && font.widthOfTextAtSize(`${line} ${word}`, size) > width) { lines.push(line); line = ""; }
      if (line) line += " ";
      for (const character of word) {
        if (line && font.widthOfTextAtSize(line + character, size) > width) { lines.push(line); line = ""; }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}

export async function createMeetingMinutesPdf(context: Record<string, string | number | null>, finalizedBy: string) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${context.meeting_number} · Final Meeting Minutes`);
  pdf.setAuthor("Mefford Contracting Command Center");
  const { regular, bold } = await meetingPdfFonts(pdf);
  const margin = 48, width = 516, ink = rgb(.12, .14, .16), red = rgb(.65, .1, .12);
  let page = pdf.addPage([612, 792]), y = 716;
  const header = () => {
    page.drawRectangle({ x: 0, y: 752, width: 612, height: 40, color: rgb(.08, .1, .12) });
    page.drawText("MEFFORD CONTRACTING · FINAL MEETING MINUTES", { x: margin, y: 768, size: 10, font: bold, color: rgb(1, 1, 1) });
  };
  const write = (value: string, size = 10, heavy = false, gap = 6) => {
    const font = heavy ? bold : regular;
    const lines = wrapMeetingPdfText(value, font, size, width);
    for (const [index, line] of lines.entries()) {
      const paragraphStart = line && (index === 0 || !lines[index - 1]);
      const end = paragraphStart ? lines.findIndex((part, n) => n > index && !part) : -1;
      const paragraphLength = paragraphStart ? (end < 0 ? lines.length : end) - index : 0;
      const keepTogether = paragraphLength > 0 && paragraphLength <= 6 && y - (paragraphLength - 1) * (size + 5) < 66;
      if (y < 66 || keepTogether) { page = pdf.addPage([612, 792]); y = 716; header(); }
      page.drawText(line, { x: margin, y, size, font, color: heavy ? red : ink });
      y -= size + 5;
    }
    y -= gap;
  };
  header();
  write(String(context.meeting_number), 18, true);
  write(String(context.series_title), 14, true);
  write(`Finalized by ${finalizedBy} · ${new Date().toISOString()} · Revision R${Math.max(1, Number(context.minutes_revision || 1))}`, 8, false, 16);
  write(String(context.minutes_summary || "No minutes summary was recorded."));
  for (const [index, sheet] of pdf.getPages().entries()) {
    sheet.drawText("Source records, attendance, decisions and attachments remain in Command Center.", { x: margin, y: 39, size: 7, font: regular, color: rgb(.4, .43, .42) });
    sheet.drawText(`${index + 1} / ${pdf.getPageCount()}`, { x: 532, y: 39, size: 8, font: regular, color: ink });
  }
  return pdf.save();
}
