import {
  PDFDocument,
  rgb,
  type PDFEmbeddedPage,
  type PDFImage,
  type PDFPage,
  type PDFFont,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { PROPOSAL_SANS_BOLD_BASE64, PROPOSAL_SANS_REGULAR_BASE64 } from "./proposal-fonts";
import { MEFFORD_CORE_VALUES, MEFFORD_OWNER_COMMITMENTS, isDesignBuildProposal, normalizeProposalData, proposalTimelineEndDate, type ProposalData, type ProposalDesignStartupService, type ProposalScheduleMilestone, type ProposalTeamMember, type ProposalVisualPlacement } from "./proposals";
import type { ProposalTeamAsset } from "./proposal-assets-server";
import { proposalPageIndexes, type ProposalVisualAsset } from "./proposal-visuals";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const INK = rgb(0.105, 0.125, 0.12);
const MUTED = rgb(0.39, 0.43, 0.41);
const RED = rgb(0.58, 0.19, 0.16);
const WHITE = rgb(1, 1, 1);
const PAPER = WHITE;
const SOFT = WHITE;
const LINE = rgb(0.80, 0.82, 0.80);

type Fonts = {
  regular: PDFFont;
  bold: PDFFont;
};

export async function createProposalPdf(input: {
  data: ProposalData | unknown;
  recordId: string;
  status: string;
  logoBytes?: Uint8Array;
  customerLogoBytes?: Uint8Array;
  visualAssets?: ProposalVisualAsset[];
  teamAssets?: ProposalTeamAsset[];
}) {
  const data = normalizeProposalData(input.data);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${data.projectName} - ${data.packetType}`);
  pdf.setAuthor("Mefford Contracting, LLC");
  pdf.setCreator("Mefford Contracting Project Command Center");
  pdf.setSubject(`${data.packetType} for ${data.ownerName}`);
  pdf.setKeywords([data.projectName, data.ownerName, data.packetType, input.recordId, `Revision ${data.revision}`]);
  pdf.registerFontkit(fontkit);

  const fonts: Fonts = {
    regular: await pdf.embedFont(base64Bytes(PROPOSAL_SANS_REGULAR_BASE64), { subset: true }),
    bold: await pdf.embedFont(base64Bytes(PROPOSAL_SANS_BOLD_BASE64), { subset: true }),
  };

  let logo: PDFImage | null = null;
  if (input.logoBytes?.length) {
    try {
      logo = await pdf.embedPng(input.logoBytes);
    } catch {
      logo = null;
    }
  }
  const customerLogo = await embedImage(pdf, input.customerLogoBytes);
  if (data.customerLogoFileId > 0 && !customerLogo) {
    throw new Error("The selected customer logo could not be placed in the PDF. Re-upload it so Main can create a PDF-ready image copy.");
  }
  const teamImages = new Map<number, PDFImage>();
  for (const asset of input.teamAssets || []) {
    const embedded = await embedImage(pdf, asset.bytes, asset.contentType);
    if (embedded) teamImages.set(asset.fileId, embedded);
  }

  const visualAssets = input.visualAssets || [];
  const leadProjectPhotoAsset = data.packetType === "Construction Proposal"
    ? visualAssets.find((asset) => asset.included && asset.kind === "Photo" && asset.placement === "Project Photo")
    : undefined;
  const leadProjectPhoto = await embedImage(pdf, leadProjectPhotoAsset?.bytes, leadProjectPhotoAsset?.contentType);
  if (leadProjectPhotoAsset && !leadProjectPhoto) {
    throw new Error(`${leadProjectPhotoAsset.name} could not be placed as the project photo. Re-add it so Main can create a PDF-ready image copy.`);
  }

  const rendered = data.packetType === "Preconstruction Letter of Engagement"
    ? renderEngagementLetter(pdf, fonts, logo, data, input.recordId, input.status)
    : renderConstructionProposal(pdf, fonts, logo, customerLogo, teamImages, leadProjectPhoto, leadProjectPhotoAsset?.caption || "", data, input.recordId, input.status);
  await insertProposalVisuals(pdf, fonts, logo, input.recordId, data.revision, visualAssets.filter((asset) => asset.fileId !== leadProjectPhotoAsset?.fileId), rendered.anchors);
  rendered.writer.finish();

  return new Uint8Array(await pdf.save());
}

type ProposalVisualAnchors = Record<ProposalVisualPlacement, number>;

function renderConstructionProposal(
  pdf: PDFDocument,
  fonts: Fonts,
  logo: PDFImage | null,
  customerLogo: PDFImage | null,
  teamImages: Map<number, PDFImage>,
  leadProjectPhoto: PDFImage | null,
  leadProjectPhotoCaption: string,
  data: ProposalData,
  recordId: string,
  status: string,
) {
  const cover = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  cover.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: WHITE });
  cover.drawRectangle({ x: 0, y: 0, width: 10, height: PAGE_HEIGHT, color: RED });
  cover.drawRectangle({ x: 10, y: 512, width: PAGE_WIDTH - 10, height: 280, color: PAPER });
  drawBrand(cover, fonts, logo, MARGIN, 704, false, 88);
  cover.drawText("PROJECT PROPOSAL", { x: 422, y: 751, size: 7.5, font: fonts.bold, color: INK });
  cover.drawText(`REVISION ${data.revision}  /  ${dateLabel(data.proposalDate)}`, { x: 422, y: 733, size: 6.5, font: fonts.regular, color: MUTED });
  cover.drawLine({ start: { x: MARGIN, y: 686 }, end: { x: PAGE_WIDTH - MARGIN, y: 686 }, thickness: 1.2, color: RED });

  cover.drawText("A PROPOSAL FOR", { x: MARGIN, y: 631, size: 8, font: fonts.bold, color: RED });
  let y = drawWrapped(cover, clean(data.projectName), fonts.bold, 34, MARGIN, 588, CONTENT_WIDTH, 39, INK);
  y -= 8;
  y = drawWrapped(cover, clean(data.projectLocation || "Project location to be confirmed"), fonts.regular, 12, MARGIN, y, CONTENT_WIDTH, 16, MUTED);
  y -= 28;
  drawWrapped(cover, displayTitle(data.subtitle), fonts.regular, 14, MARGIN, y, 440, 19, MUTED);

  cover.drawRectangle({ x: MARGIN, y: 151, width: CONTENT_WIDTH, height: 252, color: SOFT, borderColor: LINE, borderWidth: 0.7 });
  cover.drawRectangle({ x: MARGIN, y: 151, width: 6, height: 252, color: RED });
  cover.drawText("PREPARED FOR", { x: MARGIN + 27, y: 369, size: 6.5, font: fonts.bold, color: RED });
  drawWrapped(cover, clean(data.ownerContactName || "Owner contact to be confirmed"), fonts.bold, 19, MARGIN + 27, 337, 250, 22, INK);
  drawWrapped(cover, clean(data.ownerName || "Customer company to be confirmed"), fonts.bold, 10, MARGIN + 27, 305, 250, 13, MUTED);
  if (data.ownerContactTitle) drawWrapped(cover, clean(data.ownerContactTitle), fonts.regular, 8, MARGIN + 27, 286, 250, 11, MUTED);
  if (data.ownerContactEmail) drawWrapped(cover, clean(data.ownerContactEmail), fonts.regular, 7.5, MARGIN + 27, 267, 250, 10, MUTED);
  if (data.ownerContactPhone) drawWrapped(cover, clean(data.ownerContactPhone), fonts.regular, 7.5, MARGIN + 27, 251, 250, 10, MUTED);
  if (customerLogo) {
    const scaled = customerLogo.scaleToFit(112, 46);
    cover.drawImage(customerLogo, { x: MARGIN + 27, y: 172 + (46 - scaled.height) / 2, width: scaled.width, height: scaled.height });
  }
  cover.drawLine({ start: { x: 344, y: 177 }, end: { x: 344, y: 373 }, thickness: 0.6, color: LINE });
  cover.drawText("PREPARED BY", { x: 372, y: 369, size: 6.5, font: fonts.bold, color: RED });
  drawWrapped(cover, clean(data.preparedBy || "Mefford Contracting"), fonts.bold, 14, 372, 337, 160, 18, INK);
  drawWrapped(cover, clean(data.preparedByEmail || "833-MEFFCON / MEFFCON.COM"), fonts.regular, 8, 372, 291, 160, 12, MUTED);
  cover.drawText("DOCUMENT DATE", { x: 372, y: 241, size: 6.5, font: fonts.bold, color: RED });
  cover.drawText(dateLabel(data.proposalDate), { x: 372, y: 220, size: 10, font: fonts.bold, color: INK });
  cover.drawText("Price and commercial terms appear in the Investment section.", { x: 372, y: 180, size: 7, font: fonts.regular, color: MUTED });

  cover.drawText(`${recordId}  /  ${status.toUpperCase()}  /  CONTROLLED OWNER COPY`, { x: MARGIN, y: 54, size: 6.5, font: fonts.bold, color: rgb(0.50, 0.54, 0.52) });
  cover.drawText("MEFFORD CONTRACTING, LLC", { x: 418, y: 54, size: 6.5, font: fonts.bold, color: RED });

  const writer = new OwnerDocumentWriter(pdf, fonts, logo, recordId, data.revision, "PROJECT PROPOSAL");
  const anchors: ProposalVisualAnchors = {
    "Project Photo": pdf.getPageCount(),
    "Design Drawing": pdf.getPageCount(),
    "After Cover": pdf.getPageCount(),
    "After Project Read": pdf.getPageCount(),
    "After Delivery Plan": pdf.getPageCount(),
    "After Scope": pdf.getPageCount(),
    Appendix: pdf.getPageCount(),
  };

  writer.openPage("01 / PROJECT READ + CORE VALUES", "");
  writer.projectReadAndValues({
    executiveSummary: data.executiveSummary,
    projectUnderstanding: data.projectUnderstanding,
    approachIntroduction: data.approachIntroduction,
    approachPhases: data.approachPhases.slice(0, 4),
    facts: [
      ["Location", data.projectLocation || "To Be Confirmed"],
      ["Delivery", data.deliveryMethod || "To Be Confirmed"],
      ["Target Start", dateLabel(data.targetStartDate) || "To Be Confirmed"],
      ["Duration", data.durationMonths ? `${data.durationMonths} Months` : "To Be Confirmed"],
    ],
    openQuestions: data.proposalIntelligence.openQuestions.slice(0, 2),
    leadProjectPhoto,
    leadProjectPhotoCaption,
  });
  anchors["After Project Read"] = pdf.getPageCount();

  const team = data.teamMembers.filter((member) => member.includeInProposal);
  if (team.length) {
    writer.openPage("02 / PROJECT TEAM", "The People Prepared To Lead Your Work");
    writer.paragraph("The people below are approved for this proposal and selected for the work in front of us.", 10.5);
    for (const member of team) {
      const experiencePhotos = member.experience.flatMap((item) => item.photoFileIds).map((fileId) => teamImages.get(fileId)).filter((item): item is PDFImage => Boolean(item)).slice(0, 3);
      writer.teamMember(member, teamImages.get(member.headshotFileId) || null, experiencePhotos);
    }
  }

  const schedulePage = team.length ? 3 : 2;
  writer.openPage(`${pad2(schedulePage)} / PROPOSED SCHEDULE`, "The Path From Decision To Turnover");
  writer.paragraph(data.scheduleNarrative, 10);
  writer.scheduleGraphic(data.scheduleMilestones.filter((item) => item.included), data.targetStartDate, data.durationMonths);
  writer.smallPrint("Proposed planning basis only. The executed owner agreement and baseline schedule will control.");
  anchors["Design Drawing"] = pdf.getPageCount();
  anchors["After Delivery Plan"] = pdf.getPageCount();

  writer.openPage(`${pad2(schedulePage + 1)} / SCOPE`, "What Is Included");
  writer.paragraph("This scope reflects the current drawings, estimate, clarifications, and reviewed trade coverage.");
  for (const scope of data.scopeSections.filter((item) => item.included)) writer.scopeItem(scope.title, scope.description, data.showSectionPricing ? money(scope.amount) : "");
  anchors["After Scope"] = pdf.getPageCount();

  writer.openPage(`${pad2(schedulePage + 2)} / PROPOSAL BASIS`, "What The Price Is Based On");
  writer.paragraph("These assumptions and exclusions define the current pricing basis.", 10.5);
  writer.heading("Basis Of Proposal");
  writer.bullets(data.assumptions);
  writer.heading("Not Included");
  writer.bullets(data.exclusions);
  writer.statement("If The Basis Changes", "Mefford will explain the cost or schedule effect and document the agreed direction before the related work proceeds.");

  writer.openPage(`${pad2(schedulePage + 3)} / PROJECT BUDGET + NEXT STEPS`, "The Proposed Project Budget");
  writer.commercialClose({
    contractPrice: data.contractPrice,
    facts: [["Target Start", dateLabel(data.targetStartDate) || "To Be Confirmed"], ["Duration", data.durationMonths ? `${data.durationMonths} Months` : "To Be Confirmed"], ["Valid Through", dateLabel(data.validThrough) || "To Be Confirmed"], ["Deposit", data.depositPercent ? `${data.depositPercent}% When Approved` : "No Proposal Deposit"]],
    paymentTerms: data.paymentTerms,
    recommendedContractType: data.recommendedContractType || "Prepare The Owner Contract Draft That Matches The Approved Delivery Method And Commercial Basis.",
    recommendationSteps: data.recommendationSteps.slice(0, 3),
    designStartup: isDesignBuildProposal(data) ? {
      amount: data.designStartupGmp,
      services: data.designStartupServices.filter((service) => service.included).slice(0, 6),
    } : undefined,
  });
  anchors.Appendix = pdf.getPageCount();
  return { writer, anchors };
}

function renderEngagementLetter(
  pdf: PDFDocument,
  fonts: Fonts,
  logo: PDFImage | null,
  data: ProposalData,
  recordId: string,
  status: string,
) {
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: WHITE });
  page.drawRectangle({ x: 0, y: 0, width: 10, height: PAGE_HEIGHT, color: RED });
  drawBrand(page, fonts, logo, MARGIN, 700, false);
  page.drawText("MEFFORD CONTRACTING, LLC", { x: 406, y: 750, size: 7, font: fonts.bold, color: INK });
  page.drawText("833-MEFFCON  /  MEFFCON.COM", { x: 406, y: 733, size: 6.5, font: fonts.regular, color: MUTED });
  page.drawLine({ start: { x: MARGIN, y: 691 }, end: { x: PAGE_WIDTH - MARGIN, y: 691 }, thickness: 1.2, color: RED });

  let y = 651;
  page.drawText(dateLabel(data.proposalDate), { x: MARGIN, y, size: 9.5, font: fonts.regular, color: INK });
  y -= 30;
  page.drawText(clean(data.ownerContactName || data.ownerName), { x: MARGIN, y, size: 10, font: fonts.bold, color: INK });
  y -= 15;
  if (data.ownerContactTitle) {
    page.drawText(clean(data.ownerContactTitle), { x: MARGIN, y, size: 9, font: fonts.regular, color: MUTED });
    y -= 14;
  }
  page.drawText(clean(data.ownerName), { x: MARGIN, y, size: 9, font: fonts.regular, color: MUTED });
  y -= 14;
  page.drawText(clean(data.projectLocation || "Project location to be confirmed"), { x: MARGIN, y, size: 9, font: fonts.regular, color: MUTED });
  y -= 34;
  page.drawText("RE:", { x: MARGIN, y, size: 8, font: fonts.bold, color: RED });
  page.drawText(clean(data.projectName), { x: MARGIN + 30, y, size: 9.5, font: fonts.bold, color: INK });
  y -= 42;
  page.drawText(greeting(data.ownerContactName, data.ownerName), { x: MARGIN, y, size: 10.5, font: fonts.regular, color: INK });
  y -= 29;
  y = drawParagraph(page, data.executiveSummary, fonts.regular, 10.5, MARGIN, y, CONTENT_WIDTH, 15.5, INK);
  y -= 15;
  y = drawParagraph(page, "We see this engagement as the start of a working relationship, not a short exercise on the way to a price. You will hear what we know, what we do not know yet, and what we recommend next. We will stay with the hard questions and keep improving the plan as the team learns. The following pages define the services, fee, timing, and authorization.", fonts.regular, 10.5, MARGIN, y, CONTENT_WIDTH, 15.5, INK);
  y -= 25;
  page.drawText("Sincerely,", { x: MARGIN, y, size: 10, font: fonts.regular, color: INK });
  y -= 30;
  page.drawText(clean(data.preparedBy || "Mefford Contracting"), { x: MARGIN, y, size: 10.5, font: fonts.bold, color: INK });
  y -= 15;
  page.drawText("Mefford Contracting, LLC", { x: MARGIN, y, size: 9, font: fonts.regular, color: MUTED });

  page.drawRectangle({ x: MARGIN, y: 46, width: CONTENT_WIDTH, height: 54, color: PAPER });
  page.drawText("OUR CORE VALUES", { x: MARGIN + 18, y: 76, size: 6, font: fonts.bold, color: MUTED });
  const valueX = [145, 248, 357, 480];
  MEFFORD_CORE_VALUES.forEach((value, index) => {
    page.drawText(value, { x: valueX[index], y: 76, size: 6.5, font: fonts.bold, color: INK });
  });
  page.drawText(`${recordId}  /  ${status.toUpperCase()}  /  REVISION ${data.revision}`, { x: MARGIN, y: 23, size: 6, font: fonts.bold, color: MUTED });

  const writer = new OwnerDocumentWriter(pdf, fonts, logo, recordId, data.revision, "LETTER OF ENGAGEMENT");
  const anchors: ProposalVisualAnchors = {
    "Project Photo": pdf.getPageCount(),
    "Design Drawing": pdf.getPageCount(),
    "After Cover": pdf.getPageCount(),
    "After Project Read": pdf.getPageCount(),
    "After Delivery Plan": pdf.getPageCount(),
    "After Scope": pdf.getPageCount(),
    Appendix: pdf.getPageCount(),
  };

  writer.openPage("01 / THE ENGAGEMENT", "A clear start for the project");
  writer.pricePanel("Engagement fee", data.contractPrice);
  writer.factGrid([
    ["Client", data.ownerName],
    ["Project", data.projectName],
    ["Location", data.projectLocation || "To be confirmed"],
    ["Delivery", data.deliveryMethod || "Design / Build"],
    ["Target start", dateLabel(data.targetStartDate) || "To be confirmed"],
    ["Planned duration", data.durationMonths ? `${data.durationMonths} months` : "To be confirmed"],
  ]);
  writer.heading("Purpose");
  writer.paragraph(data.approachIntroduction, 10.5);
  writer.heading("Our read on the project");
  writer.paragraph(data.projectUnderstanding, 10.5);
  writer.statement("How we will show up", MEFFORD_OWNER_COMMITMENTS.map((item) => item.promise).join(" "));
  writer.statement("The outcome", "At the end of this engagement, you should have a coordinated basis for deciding how to move into construction: a clearer scope, a current budget, an informed schedule, and a record of the decisions still in front of the team.");
  anchors["After Project Read"] = pdf.getPageCount();

  writer.openPage("02 / SERVICES", "How we will work through the engagement");
  data.approachPhases.filter((item) => item.included).forEach((phase, index) => {
    writer.timelineItem(index + 1, phase.title, phase.description);
  });
  anchors["Design Drawing"] = pdf.getPageCount();
  anchors["After Delivery Plan"] = pdf.getPageCount();

  writer.openPage("03 / DELIVERABLES", "What Mefford Contracting will provide");
  writer.paragraph("The services below define the working scope of this engagement. They can be adjusted together before authorization so the effort matches the decisions the project needs.");
  for (const scope of data.scopeSections.filter((item) => item.included)) {
    writer.scopeItem(scope.title, scope.description, data.showSectionPricing ? money(scope.amount) : "");
  }
  anchors["After Scope"] = pdf.getPageCount();

  writer.openPage("04 / FEE AND TERMS", "The terms of the engagement");
  writer.pricePanel("Engagement fee", data.contractPrice);
  writer.heading("Timing");
  writer.paragraph(data.scheduleNarrative);
  writer.heading("Payment");
  writer.paragraph(data.paymentTerms);
  writer.heading("Engagement basis");
  writer.bullets(data.assumptions);
  writer.heading("Outside this engagement");
  writer.bullets(data.exclusions);
  writer.openPage("05 / AUTHORIZATION", "Ready to begin the engagement");
  writer.lead(data.nextSteps, 15);
  writer.statement("What approval means", "Approval authorizes Mefford Contracting to begin the engagement services described in this letter. It does not authorize construction or any service outside the written engagement scope.");
  writer.heading("Authorization");
  writer.signatureLines(data.ownerName, "Mefford Contracting, LLC");
  writer.smallPrint("Approval authorizes only the engagement services written in this letter. Construction and additional services require separate written authorization. Final legal terms remain subject to the applicable Mefford Contracting agreement and current approved templates.");
  anchors.Appendix = pdf.getPageCount();
  return { writer, anchors };
}

async function insertProposalVisuals(
  pdf: PDFDocument,
  fonts: Fonts,
  logo: PDFImage | null,
  recordId: string,
  revision: number,
  assets: ProposalVisualAsset[],
  anchors: ProposalVisualAnchors,
) {
  let drawingPageCount = 0;
  const placements: ProposalVisualPlacement[] = ["Appendix", "After Scope", "After Delivery Plan", "Design Drawing", "After Project Read", "Project Photo", "After Cover"];
  for (const placement of placements) {
    let insertionIndex = anchors[placement];
    for (const asset of assets.filter((item) => item.included && item.placement === placement)) {
      if (asset.kind === "Photo") {
        if (placement === "Design Drawing") {
          drawingPageCount += 1;
          if (drawingPageCount > 30) throw new Error("Select no more than 30 drawing pages for one proposal packet.");
          const page = pdf.insertPage(insertionIndex, [PAGE_WIDTH, PAGE_HEIGHT]);
          insertionIndex += 1;
          await drawProposalDrawingImagePage(pdf, page, fonts, logo, asset);
          continue;
        }
        const page = pdf.insertPage(insertionIndex, [PAGE_WIDTH, PAGE_HEIGHT]);
        insertionIndex += 1;
        await drawProposalPhotoPage(pdf, page, fonts, logo, asset, placement);
        continue;
      }

      let source: PDFDocument;
      try {
        source = await PDFDocument.load(asset.bytes);
      } catch {
        throw new Error(`${asset.name} is not a readable drawing PDF.`);
      }
      const indexes = proposalPageIndexes(asset.pageSelection, source.getPageCount(), 30);
      drawingPageCount += indexes.length;
      if (drawingPageCount > 30) throw new Error("Select no more than 30 drawing pages for one proposal packet.");
      for (const [pageIndex, sourcePageIndex] of indexes.entries()) {
        let embeddedPage: PDFEmbeddedPage;
        try {
          embeddedPage = await pdf.embedPage(source.getPage(sourcePageIndex));
        } catch {
          throw new Error(`${asset.name} page ${sourcePageIndex + 1} could not be placed in the proposal PDF.`);
        }
        const page = pdf.insertPage(insertionIndex, [PAGE_WIDTH, PAGE_HEIGHT]);
        insertionIndex += 1;
        drawProposalDrawingPdfPage(page, fonts, logo, embeddedPage, asset, pageIndex + 1, indexes.length);
      }
    }
  }
}

async function drawProposalPhotoPage(
  pdf: PDFDocument,
  page: PDFPage,
  fonts: Fonts,
  logo: PDFImage | null,
  asset: ProposalVisualAsset,
  placement: ProposalVisualPlacement,
) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: WHITE });
  page.drawRectangle({ x: 0, y: 0, width: 7, height: PAGE_HEIGHT, color: RED });
  drawBrand(page, fonts, logo, MARGIN, 727, false, 48);
  page.drawText("PROJECT VISUAL", { x: 430, y: 757, size: 6.5, font: fonts.bold, color: MUTED });
  page.drawText(clean(placement).toUpperCase(), { x: 430, y: 741, size: 6, font: fonts.regular, color: RED });
  page.drawLine({ start: { x: MARGIN, y: 712 }, end: { x: PAGE_WIDTH - MARGIN, y: 712 }, thickness: 0.6, color: LINE });

  let image: PDFImage;
  try {
    image = asset.contentType.toLowerCase() === "image/png" ? await pdf.embedPng(asset.bytes) : await pdf.embedJpg(asset.bytes);
  } catch {
    throw new Error(`${asset.name} could not be placed in the proposal PDF. Re-add it so Main can create a document-ready image copy.`);
  }
  const frame = { x: MARGIN, y: 132, width: CONTENT_WIDTH, height: 548 };
  page.drawRectangle({ ...frame, color: PAPER, borderColor: LINE, borderWidth: 0.6 });
  const scaled = image.scaleToFit(frame.width, frame.height);
  page.drawImage(image, {
    x: frame.x + (frame.width - scaled.width) / 2,
    y: frame.y + (frame.height - scaled.height) / 2,
    width: scaled.width,
    height: scaled.height,
  });
  page.drawText(clean(asset.name), { x: MARGIN, y: 106, size: 9.5, font: fonts.bold, color: INK });
  if (asset.caption) drawWrapped(page, clean(asset.caption), fonts.regular, 8.5, MARGIN, 88, CONTENT_WIDTH, 11, MUTED);
}

async function drawProposalDrawingImagePage(
  pdf: PDFDocument,
  page: PDFPage,
  fonts: Fonts,
  logo: PDFImage | null,
  asset: ProposalVisualAsset,
) {
  const image = await embedImage(pdf, asset.bytes, asset.contentType);
  if (!image) throw new Error(`${asset.name} could not be placed as a design drawing. Re-add it so Main can create a PDF-ready image copy.`);
  const frame = drawProposalDrawingFrame(page, fonts, logo, asset, "IMAGE DRAWING");
  drawContainedImage(page, image, frame);
}

function drawProposalDrawingPdfPage(
  page: PDFPage,
  fonts: Fonts,
  logo: PDFImage | null,
  drawing: PDFEmbeddedPage,
  asset: ProposalVisualAsset,
  pageNumber: number,
  pageCount: number,
) {
  const frame = drawProposalDrawingFrame(page, fonts, logo, asset, `PAGE ${pageNumber} OF ${pageCount}`);
  const scaled = drawing.scale(Math.min(frame.width / drawing.width, frame.height / drawing.height));
  page.drawPage(drawing, {
    x: frame.x + (frame.width - scaled.width) / 2,
    y: frame.y + (frame.height - scaled.height) / 2,
    width: scaled.width,
    height: scaled.height,
  });
}

function drawProposalDrawingFrame(
  page: PDFPage,
  fonts: Fonts,
  logo: PDFImage | null,
  asset: ProposalVisualAsset,
  pageLabel: string,
) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: WHITE });
  page.drawRectangle({ x: 0, y: 0, width: 7, height: PAGE_HEIGHT, color: RED });
  drawBrand(page, fonts, logo, MARGIN, 727, false, 48);
  page.drawText("DESIGN DRAWING", { x: 430, y: 757, size: 6.5, font: fonts.bold, color: MUTED });
  page.drawText(pageLabel, { x: 430, y: 741, size: 6, font: fonts.regular, color: RED });
  page.drawLine({ start: { x: MARGIN, y: 712 }, end: { x: PAGE_WIDTH - MARGIN, y: 712 }, thickness: 0.6, color: LINE });
  page.drawText(fit(displayTitle(clean(asset.name).replace(/\.[^.]+$/, "")), 72), { x: MARGIN, y: 689, size: 10.5, font: fonts.bold, color: INK });
  if (asset.caption) drawBoundedLines(page, asset.caption, fonts.regular, 7.8, MARGIN, 672, CONTENT_WIDTH, 10, MUTED, 2);
  const frame = { x: MARGIN, y: 102, width: CONTENT_WIDTH, height: asset.caption ? 540 : 558 };
  page.drawRectangle({ ...frame, color: PAPER, borderColor: LINE, borderWidth: 0.7 });
  return { x: frame.x + 7, y: frame.y + 7, width: frame.width - 14, height: frame.height - 14 };
}

class OwnerDocumentWriter {
  private page!: PDFPage;
  private y = 0;
  private currentTitle = "";
  private pdf: PDFDocument;
  private fonts: Fonts;
  private logo: PDFImage | null;
  private recordId: string;
  private revision: number;
  private documentLabel: string;

  constructor(
    pdf: PDFDocument,
    fonts: Fonts,
    logo: PDFImage | null,
    recordId: string,
    revision: number,
    documentLabel: string,
  ) {
    this.pdf = pdf;
    this.fonts = fonts;
    this.logo = logo;
    this.recordId = recordId;
    this.revision = revision;
    this.documentLabel = documentLabel;
  }

  openPage(kicker: string, title: string) {
    this.page = this.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: WHITE });
    this.page.drawRectangle({ x: 0, y: 0, width: 7, height: PAGE_HEIGHT, color: RED });
    drawBrand(this.page, this.fonts, this.logo, MARGIN, 735, false, 48);
    this.page.drawText(this.documentLabel, { x: 422, y: 758, size: 6.5, font: this.fonts.bold, color: MUTED });
    this.page.drawLine({ start: { x: MARGIN, y: 725 }, end: { x: PAGE_WIDTH - MARGIN, y: 725 }, thickness: 0.6, color: LINE });
    this.page.drawText(clean(kicker), { x: MARGIN, y: 691, size: 7, font: this.fonts.bold, color: RED });
    const pageTitle = displayTitle(title);
    this.y = pageTitle
      ? drawWrapped(this.page, pageTitle, this.fonts.bold, 27, MARGIN, 656, CONTENT_WIDTH, 31, INK) - 17
      : 656;
    this.currentTitle = pageTitle;
  }

  section(kicker: string, title: string, minimumContentHeight = 180) {
    if (this.y - minimumContentHeight < 58) { this.openPage(kicker, title); return; }
    this.y -= 6;
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_WIDTH - MARGIN, y: this.y }, thickness: 1.2, color: RED });
    this.y -= 25;
    this.page.drawText(clean(kicker), { x: MARGIN, y: this.y, size: 7, font: this.fonts.bold, color: RED });
    this.y -= 26;
    const sectionTitle = displayTitle(title);
    this.y = drawWrapped(this.page, sectionTitle, this.fonts.bold, 22, MARGIN, this.y, CONTENT_WIDTH, 26, INK) - 13;
    this.currentTitle = sectionTitle;
  }

  lead(value: string, size = 16) {
    const lines = wrap(clean(value), this.fonts.bold, size, CONTENT_WIDTH);
    this.ensure(lines.length * (size + 5) + 12);
    for (const line of lines) {
      this.page.drawText(line, { x: MARGIN, y: this.y, size, font: this.fonts.bold, color: INK });
      this.y -= size + 5;
    }
    this.y -= 8;
  }

  heading(value: string) {
    this.ensure(38);
    this.y -= 4;
    this.page.drawText(displayTitle(value), { x: MARGIN, y: this.y, size: 12, font: this.fonts.bold, color: INK });
    this.page.drawLine({ start: { x: MARGIN, y: this.y - 8 }, end: { x: PAGE_WIDTH - MARGIN, y: this.y - 8 }, thickness: 0.5, color: LINE });
    this.y -= 27;
  }

  paragraph(value: string, size = 10) {
    for (const paragraph of clean(value).split(/\n+/).filter(Boolean)) {
      const lines = wrap(paragraph, this.fonts.regular, size, CONTENT_WIDTH);
      this.ensure(lines.length * (size + 4.5) + 10);
      for (const line of lines) {
        this.page.drawText(line, { x: MARGIN, y: this.y, size, font: this.fonts.regular, color: MUTED });
        this.y -= size + 4.5;
      }
      this.y -= 8;
    }
  }

  rule() {
    this.ensure(20);
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_WIDTH - MARGIN, y: this.y }, thickness: 2.2, color: RED });
    this.y -= 22;
  }

  projectReadAndValues(input: {
    executiveSummary: string;
    projectUnderstanding: string;
    approachIntroduction: string;
    approachPhases: Array<{ description: string }>;
    facts: string[][];
    openQuestions: string[];
    leadProjectPhoto: PDFImage | null;
    leadProjectPhotoCaption: string;
  }) {
    const top = this.y;
    const pictureWidth = 180;
    const pictureX = PAGE_WIDTH - MARGIN - pictureWidth;
    const textWidth = pictureX - MARGIN - 20;

    drawFittedText(this.page, input.executiveSummary, this.fonts.bold, 12.2, MARGIN, top, textWidth, 110, INK);
    const pictureFrame = { x: pictureX, y: top - 110, width: pictureWidth, height: 110 };
    this.page.drawRectangle({ ...pictureFrame, color: PAPER, borderColor: LINE, borderWidth: 0.8 });
    if (input.leadProjectPhoto) {
      drawContainedImage(this.page, input.leadProjectPhoto, { x: pictureX + 1, y: top - 91, width: pictureWidth - 2, height: 90 });
      this.page.drawLine({ start: { x: pictureX, y: top - 91 }, end: { x: pictureX + pictureWidth, y: top - 91 }, thickness: 0.45, color: LINE });
      this.page.drawText("PROJECT PHOTO", { x: pictureX + 9, y: top - 103, size: 5.8, font: this.fonts.bold, color: RED });
      if (input.leadProjectPhotoCaption) this.page.drawText(fit(clean(input.leadProjectPhotoCaption), 31), { x: pictureX + 62, y: top - 103, size: 5.5, font: this.fonts.regular, color: MUTED });
    } else {
      this.page.drawRectangle({ x: pictureX + 12, y: top - 98, width: pictureWidth - 24, height: 76, borderColor: LINE, borderWidth: 0.7, borderDashArray: [4, 3] });
      const pictureLabel = "PICTURE HERE IF UPLOADED";
      const labelWidth = this.fonts.bold.widthOfTextAtSize(pictureLabel, 7);
      this.page.drawText(pictureLabel, { x: pictureX + (pictureWidth - labelWidth) / 2, y: top - 64, size: 7, font: this.fonts.bold, color: RED });
      const pictureNote = "OPTIONAL PROJECT VISUAL";
      const noteWidth = this.fonts.regular.widthOfTextAtSize(pictureNote, 6);
      this.page.drawText(pictureNote, { x: pictureX + (pictureWidth - noteWidth) / 2, y: top - 79, size: 6, font: this.fonts.regular, color: MUTED });
    }

    this.page.drawText("WHAT WE UNDERSTAND TODAY", { x: MARGIN, y: top - 137, size: 7, font: this.fonts.bold, color: RED });
    drawBoundedLines(this.page, input.projectUnderstanding, this.fonts.regular, 9.1, MARGIN, top - 157, CONTENT_WIDTH, 12, MUTED, 5);

    const factTop = top - 227;
    const factGap = 7;
    const factWidth = (CONTENT_WIDTH - factGap * 3) / 4;
    input.facts.slice(0, 4).forEach(([label, value], index) => {
      const x = MARGIN + index * (factWidth + factGap);
      this.page.drawRectangle({ x, y: factTop - 50, width: factWidth, height: 50, color: SOFT, borderColor: LINE, borderWidth: 0.4 });
      this.page.drawText(clean(label).toUpperCase(), { x: x + 9, y: factTop - 13, size: 5.6, font: this.fonts.bold, color: RED });
      const valueLines = clean(label).toLowerCase() === "location"
        ? mailingAddressLines(value || "To Be Confirmed")
        : [clean(value || "To Be Confirmed")];
      const valueSize = fittedLineSize(valueLines, this.fonts.bold, 7.3, factWidth - 18);
      valueLines.forEach((line, lineIndex) => {
        this.page.drawText(line, { x: x + 9, y: factTop - 29 - lineIndex * 10, size: valueSize, font: this.fonts.bold, color: INK });
      });
    });

    this.page.drawText("FOUR CORE VALUES IN THE WORK", { x: MARGIN, y: top - 294, size: 8, font: this.fonts.bold, color: RED });
    drawBoundedLines(this.page, input.approachIntroduction, this.fonts.regular, 8.4, MARGIN, top - 312, CONTENT_WIDTH, 10.5, MUTED, 2);
    const cardTop = top - 342;
    const cardGap = 12;
    const cardWidth = (CONTENT_WIDTH - cardGap) / 2;
    input.approachPhases.slice(0, 4).forEach((phase, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = MARGIN + col * (cardWidth + cardGap);
      const y = cardTop - row * 82;
      this.page.drawRectangle({ x, y: y - 72, width: cardWidth, height: 72, color: index % 2 ? SOFT : PAPER, borderColor: LINE, borderWidth: 0.45 });
      this.page.drawRectangle({ x, y: y - 72, width: 5, height: 72, color: RED });
      this.page.drawText(MEFFORD_CORE_VALUES[index], { x: x + 17, y: y - 20, size: 7.2, font: this.fonts.bold, color: INK });
      drawBoundedLines(this.page, phase.description || MEFFORD_OWNER_COMMITMENTS[index].promise, this.fonts.regular, 7.7, x + 17, y - 37, cardWidth - 29, 10.2, MUTED, 3);
    });

    if (input.openQuestions.length) {
      this.page.drawText("OPEN ITEMS", { x: MARGIN, y: 78, size: 5.8, font: this.fonts.bold, color: RED });
      drawBoundedLines(this.page, input.openQuestions.join(" · "), this.fonts.regular, 6.2, MARGIN + 60, 78, CONTENT_WIDTH - 60, 8, MUTED, 2);
    }
    this.y = 58;
  }

  commercialClose(input: {
    contractPrice: number;
    facts: string[][];
    paymentTerms: string;
    recommendedContractType: string;
    recommendationSteps: string[];
    designStartup?: {
      amount: number;
      services: ProposalDesignStartupService[];
    };
  }) {
    const top = this.y;
    this.page.drawRectangle({ x: MARGIN, y: top - 88, width: CONTENT_WIDTH, height: 88, color: PAPER, borderColor: LINE, borderWidth: 0.7 });
    this.page.drawRectangle({ x: MARGIN, y: top - 88, width: 7, height: 88, color: RED });
    this.page.drawText("TOTAL PROPOSED PROJECT BUDGET", { x: MARGIN + 25, y: top - 27, size: 7, font: this.fonts.bold, color: RED });
    this.page.drawText(money(input.contractPrice), { x: MARGIN + 25, y: top - 65, size: 27, font: this.fonts.bold, color: INK });
    if (input.designStartup) {
      const splitX = MARGIN + 310;
      this.page.drawLine({ start: { x: splitX, y: top - 76 }, end: { x: splitX, y: top - 14 }, thickness: 0.6, color: LINE });
      this.page.drawText("INCLUDED UPFRONT DESIGN STARTUP GMP", { x: splitX + 16, y: top - 27, size: 5.6, font: this.fonts.bold, color: RED });
      this.page.drawText(money(input.designStartup.amount), { x: splitX + 16, y: top - 52, size: 15.5, font: this.fonts.bold, color: INK });
      this.page.drawText("WITHIN TOTAL - NOT ADDED", { x: splitX + 16, y: top - 69, size: 5.4, font: this.fonts.bold, color: MUTED });
    }

    const factTop = top - 105;
    const gap = 7;
    const factWidth = (CONTENT_WIDTH - gap * 3) / 4;
    input.facts.slice(0, 4).forEach(([label, value], index) => {
      const x = MARGIN + index * (factWidth + gap);
      this.page.drawRectangle({ x, y: factTop - 42, width: factWidth, height: 42, color: SOFT, borderColor: LINE, borderWidth: 0.4 });
      this.page.drawText(clean(label).toUpperCase(), { x: x + 9, y: factTop - 13, size: 5.5, font: this.fonts.bold, color: RED });
      this.page.drawText(fit(clean(value || "To Be Confirmed"), 22), { x: x + 9, y: factTop - 29, size: 7.1, font: this.fonts.bold, color: INK });
    });

    if (input.designStartup) {
      const startupTop = top - 160;
      const startupHeight = 150;
      this.page.drawRectangle({ x: MARGIN, y: startupTop - startupHeight, width: CONTENT_WIDTH, height: startupHeight, color: PAPER, borderColor: LINE, borderWidth: 0.55 });
      this.page.drawRectangle({ x: MARGIN, y: startupTop - startupHeight, width: 6, height: startupHeight, color: RED });
      this.page.drawText("UPFRONT DESIGN AND PERMITTING STARTUP GMP", { x: MARGIN + 19, y: startupTop - 17, size: 7, font: this.fonts.bold, color: RED });
      drawBoundedLines(
        this.page,
        "Included within the total project price - not added. This is the maximum Mefford may commit without written owner approval. Services are used and billed only as needed for the permit-ready path; not every listed service will be required, and any unused portion remains unspent.",
        this.fonts.regular,
        6.4,
        MARGIN + 19,
        startupTop - 34,
        CONTENT_WIDTH - 38,
        7.8,
        MUTED,
        2,
      );

      const services = input.designStartup.services.slice(0, 6);
      const serviceGap = 18;
      const serviceWidth = (CONTENT_WIDTH - 38 - serviceGap) / 2;
      const serviceStartX = MARGIN + 19;
      const serviceTop = startupTop - 62;
      services.forEach((service, index) => {
        const column = index % 2;
        const row = Math.floor(index / 2);
        const x = serviceStartX + column * (serviceWidth + serviceGap);
        const y = serviceTop - row * 29;
        this.page.drawText(fit(displayTitle(service.title), 47), { x, y, size: 5.8, font: this.fonts.bold, color: INK });
        drawBoundedLines(this.page, service.description, this.fonts.regular, 5.3, x, y - 10, serviceWidth, 6.7, MUTED, 2);
      });

      const paymentY = startupTop - startupHeight - 15;
      this.page.drawText("PAYMENT", { x: MARGIN, y: paymentY, size: 6.2, font: this.fonts.bold, color: RED });
      drawBoundedLines(this.page, input.paymentTerms, this.fonts.regular, 7.2, MARGIN + 58, paymentY, CONTENT_WIDTH - 58, 8.5, MUTED, 3);
      this.page.drawLine({ start: { x: MARGIN, y: top - 357 }, end: { x: PAGE_WIDTH - MARGIN, y: top - 357 }, thickness: 1.2, color: RED });
      this.page.drawText("What Comes Next...", { x: MARGIN, y: top - 384, size: 18.5, font: this.fonts.bold, color: INK });

      const steps = input.recommendationSteps.length ? input.recommendationSteps.slice(0, 3) : ["Confirm The Remaining Questions", "Prepare The Owner Agreement", "Confirm The Team And Start Requirements"];
      const stepGap = 10;
      const stepWidth = (CONTENT_WIDTH - stepGap * (steps.length - 1)) / steps.length;
      const stepTop = top - 406;
      steps.forEach((step, index) => {
        const x = MARGIN + index * (stepWidth + stepGap);
        this.page.drawRectangle({ x, y: stepTop - 52, width: stepWidth, height: 52, color: PAPER, borderColor: LINE, borderWidth: 0.45 });
        this.page.drawText(String(index + 1).padStart(2, "0"), { x: x + 10, y: stepTop - 16, size: 5.8, font: this.fonts.bold, color: RED });
        drawBoundedLines(this.page, displayTitle(step), this.fonts.bold, 6.8, x + 10, stepTop - 31, stepWidth - 20, 8.1, INK, 3);
      });

      const pathTop = stepTop - 63;
      this.page.drawRectangle({ x: MARGIN, y: pathTop - 43, width: CONTENT_WIDTH, height: 43, color: PAPER, borderColor: LINE, borderWidth: 0.5 });
      this.page.drawRectangle({ x: MARGIN, y: pathTop - 43, width: 6, height: 43, color: RED });
      this.page.drawText("RECOMMENDED CONTRACT PATH", { x: MARGIN + 19, y: pathTop - 15, size: 5.8, font: this.fonts.bold, color: RED });
      drawBoundedLines(this.page, displayTitle(input.recommendedContractType), this.fonts.bold, 8, MARGIN + 19, pathTop - 31, CONTENT_WIDTH - 36, 9.5, INK, 1);

      drawBoundedLines(this.page, "This proposal is nonbinding and is not a notice to proceed. The executed owner agreement controls scope, schedule, price, risk allocation, and authorization to begin work.", this.fonts.regular, 6.1, MARGIN, 72, CONTENT_WIDTH, 7.8, MUTED, 2);
      this.y = 58;
      return;
    }

    this.page.drawText("PAYMENT", { x: MARGIN, y: top - 172, size: 7, font: this.fonts.bold, color: RED });
    drawBoundedLines(this.page, input.paymentTerms, this.fonts.regular, 8.7, MARGIN, top - 192, CONTENT_WIDTH, 11.5, MUTED, 3);
    this.page.drawLine({ start: { x: MARGIN, y: top - 244 }, end: { x: PAGE_WIDTH - MARGIN, y: top - 244 }, thickness: 1.4, color: RED });
    this.page.drawText("What Comes Next...", { x: MARGIN, y: top - 278, size: 19.5, font: this.fonts.bold, color: INK });

    const steps = input.recommendationSteps.length ? input.recommendationSteps.slice(0, 3) : ["Confirm The Remaining Questions", "Prepare The Owner Agreement", "Confirm The Team And Start Requirements"];
    const stepGap = 10;
    const stepWidth = (CONTENT_WIDTH - stepGap * (steps.length - 1)) / steps.length;
    const stepTop = top - 302;
    steps.forEach((step, index) => {
      const x = MARGIN + index * (stepWidth + stepGap);
      this.page.drawRectangle({ x, y: stepTop - 66, width: stepWidth, height: 66, color: index % 2 ? SOFT : PAPER, borderColor: LINE, borderWidth: 0.45 });
      this.page.drawText(String(index + 1).padStart(2, "0"), { x: x + 12, y: stepTop - 19, size: 6.5, font: this.fonts.bold, color: RED });
      drawBoundedLines(this.page, displayTitle(step), this.fonts.bold, 7.7, x + 12, stepTop - 38, stepWidth - 24, 10.2, INK, 3);
    });

    const pathTop = stepTop - 82;
    this.page.drawRectangle({ x: MARGIN, y: pathTop - 54, width: CONTENT_WIDTH, height: 54, color: PAPER, borderColor: LINE, borderWidth: 0.5 });
    this.page.drawRectangle({ x: MARGIN, y: pathTop - 54, width: 6, height: 54, color: RED });
    this.page.drawText("RECOMMENDED CONTRACT PATH", { x: MARGIN + 21, y: pathTop - 18, size: 6.2, font: this.fonts.bold, color: RED });
    drawBoundedLines(this.page, displayTitle(input.recommendedContractType), this.fonts.bold, 8.8, MARGIN + 21, pathTop - 35, CONTENT_WIDTH - 38, 11, INK, 2);

    drawBoundedLines(this.page, "This proposal is nonbinding and is not a notice to proceed. The executed owner agreement controls scope, schedule, price, risk allocation, and authorization to begin work.", this.fonts.regular, 6.3, MARGIN, 70, CONTENT_WIDTH, 8.2, MUTED, 2);
    this.y = 58;
  }

  factGrid(items: string[][]) {
    const rowHeight = 49;
    const rows = Math.ceil(items.length / 2);
    this.ensure(rows * rowHeight + 17);
    items.forEach(([label, value], index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = MARGIN + col * 258;
      const top = this.y - row * rowHeight;
      this.page.drawRectangle({ x, y: top - 38, width: 246, height: 42, color: PAPER });
      this.page.drawText(clean(label).toUpperCase(), { x: x + 12, y: top - 11, size: 6.3, font: this.fonts.bold, color: RED });
      this.page.drawText(fit(clean(value || "To be confirmed"), 45), { x: x + 12, y: top - 28, size: 8.8, font: this.fonts.bold, color: INK });
    });
    this.y -= rows * rowHeight + 13;
  }

  statement(label: string, value: string) {
    const lines = wrap(clean(value), this.fonts.regular, 10, CONTENT_WIDTH - 44);
    const height = Math.max(82, 46 + lines.length * 14);
    this.ensure(height + 10);
    this.page.drawRectangle({ x: MARGIN, y: this.y - height, width: CONTENT_WIDTH, height, color: PAPER, borderColor: LINE, borderWidth: 0.5 });
    this.page.drawRectangle({ x: MARGIN, y: this.y - height, width: 6, height, color: RED });
    this.page.drawText(clean(label).toUpperCase(), { x: MARGIN + 24, y: this.y - 25, size: 7, font: this.fonts.bold, color: RED });
    let textY = this.y - 46;
    for (const line of lines) {
      this.page.drawText(line, { x: MARGIN + 24, y: textY, size: 10, font: this.fonts.regular, color: MUTED });
      textY -= 14;
    }
    this.y -= height + 18;
  }

  timelineItem(number: number, title: string, description: string) {
    const lines = wrap(clean(description), this.fonts.regular, 9.7, 420);
    const height = Math.max(72, 40 + lines.length * 13.5);
    this.ensure(height + 10);
    this.page.drawRectangle({ x: MARGIN, y: this.y - height, width: CONTENT_WIDTH, height, color: number % 2 ? PAPER : SOFT });
    this.page.drawText(String(number).padStart(2, "0"), { x: MARGIN + 17, y: this.y - 28, size: 9, font: this.fonts.bold, color: RED });
    this.page.drawLine({ start: { x: MARGIN + 50, y: this.y - 13 }, end: { x: MARGIN + 50, y: this.y - height + 13 }, thickness: 1.2, color: RED });
    this.page.drawText(displayTitle(title), { x: MARGIN + 69, y: this.y - 26, size: 11.5, font: this.fonts.bold, color: INK });
    let textY = this.y - 46;
    for (const line of lines) {
      this.page.drawText(line, { x: MARGIN + 69, y: textY, size: 9.7, font: this.fonts.regular, color: MUTED });
      textY -= 13.5;
    }
    this.y -= height + 10;
  }

  compactStep(number: number, description: string) {
    const lines = wrap(clean(description), this.fonts.regular, 8.7, 430).slice(0, 3);
    const height = Math.max(52, 24 + lines.length * 11);
    this.ensure(height + 7);
    this.page.drawRectangle({ x: MARGIN, y: this.y - height, width: CONTENT_WIDTH, height, color: number % 2 ? PAPER : SOFT });
    this.page.drawText(String(number).padStart(2, "0"), { x: MARGIN + 17, y: this.y - 24, size: 8, font: this.fonts.bold, color: RED });
    this.page.drawLine({ start: { x: MARGIN + 48, y: this.y - 10 }, end: { x: MARGIN + 48, y: this.y - height + 10 }, thickness: 1, color: RED });
    let textY = this.y - 20;
    for (const line of lines) { this.page.drawText(line, { x: MARGIN + 66, y: textY, size: 8.7, font: this.fonts.regular, color: INK }); textY -= 11; }
    this.y -= height + 7;
  }

  teamMember(member: ProposalTeamMember, headshot: PDFImage | null, experiencePhotos: PDFImage[]) {
    const summaryLines = wrap(clean(member.professionalSummary || "Approved project leadership profile."), this.fonts.regular, 9.2, 380);
    const experience = member.experience.slice(0, 3);
    const height = Math.min(500, Math.max(160, 130 + summaryLines.length * 12.5 + experience.length * 62 + (experiencePhotos.length ? 76 : 0)));
    this.ensure(height + 14);
    const top = this.y;
    this.page.drawRectangle({ x: MARGIN, y: top - height, width: CONTENT_WIDTH, height, color: SOFT, borderColor: LINE, borderWidth: 0.6 });
    this.page.drawRectangle({ x: MARGIN, y: top - height, width: 6, height, color: RED });
    const photoFrame = { x: MARGIN + 22, y: top - 104, width: 72, height: 72 };
    this.page.drawRectangle({ ...photoFrame, color: PAPER, borderColor: LINE, borderWidth: 0.5 });
    if (headshot) { const scaled = headshot.scaleToFit(72, 72); this.page.drawImage(headshot, { x: photoFrame.x + (72 - scaled.width) / 2, y: photoFrame.y + (72 - scaled.height) / 2, width: scaled.width, height: scaled.height }); }
    else this.page.drawText(initials(member.displayName), { x: photoFrame.x + 19, y: photoFrame.y + 27, size: 17, font: this.fonts.bold, color: RED });
    this.page.drawText(clean(member.displayName), { x: MARGIN + 116, y: top - 30, size: 15, font: this.fonts.bold, color: INK });
    this.page.drawText(clean(member.proposalRoleLabel || member.companyTitle || "Project Team"), { x: MARGIN + 116, y: top - 49, size: 7.2, font: this.fonts.bold, color: RED });
    if (member.credentials.length) this.page.drawText(fit(clean(member.credentials.join(" · ")), 78), { x: MARGIN + 116, y: top - 66, size: 7.2, font: this.fonts.regular, color: MUTED });
    let textY = top - 88;
    for (const line of summaryLines) { this.page.drawText(line, { x: MARGIN + 116, y: textY, size: 9.2, font: this.fonts.regular, color: MUTED }); textY -= 12.5; }
    if (member.priorExperience.length) { textY -= 3; this.page.drawText("ADDITIONAL EXPERIENCE", { x: MARGIN + 116, y: textY, size: 6.2, font: this.fonts.bold, color: RED }); textY -= 13; for (const line of wrap(clean(member.priorExperience.slice(0, 3).join(" · ")), this.fonts.regular, 7.8, 380).slice(0, 4)) { this.page.drawText(line, { x: MARGIN + 116, y: textY, size: 7.8, font: this.fonts.regular, color: MUTED }); textY -= 10.5; } }
    if (experience.length) { textY -= 6; this.page.drawText("RELEVANT MEFFORD CONTRACTING EXPERIENCE", { x: MARGIN + 22, y: textY, size: 6.4, font: this.fonts.bold, color: RED }); textY -= 16; for (const item of experience) { this.page.drawText(clean(item.projectName), { x: MARGIN + 22, y: textY, size: 8.8, font: this.fonts.bold, color: INK }); textY -= 12; for (const line of wrap(clean(item.summary || `${item.role} on ${item.projectName}`), this.fonts.regular, 8.2, 470).slice(0, 3)) { this.page.drawText(line, { x: MARGIN + 22, y: textY, size: 8.2, font: this.fonts.regular, color: MUTED }); textY -= 10.5; } textY -= 7; } }
    if (experiencePhotos.length) { const photoY = top - height + 18; for (const [index, image] of experiencePhotos.entries()) { const frame = { x: MARGIN + 22 + index * 113, y: photoY, width: 100, height: 58 }; this.page.drawRectangle({ ...frame, color: PAPER, borderColor: LINE, borderWidth: 0.4 }); const scaled = image.scaleToFit(100, 58); this.page.drawImage(image, { x: frame.x + (100 - scaled.width) / 2, y: frame.y + (58 - scaled.height) / 2, width: scaled.width, height: scaled.height }); } }
    this.y -= height + 14;
  }

  scheduleGraphic(milestones: ProposalScheduleMilestone[], startDate: string, durationMonths: number) {
    const items = milestones.slice(0, 10);
    if (!items.length) { this.statement("Schedule development", "The milestone schedule will be confirmed with the owner before the agreement is finalized."); return; }
    const timelineStartDate = startDate || items[0].startDate;
    const endDate = proposalTimelineEndDate(timelineStartDate, durationMonths) || items.at(-1)?.endDate || "";
    const projectStart = isoDay(timelineStartDate);
    const projectEnd = isoDay(endDate);
    if (projectStart === null || projectEnd === null || projectEnd <= projectStart) {
      items.forEach((item, index) => this.timelineItem(index + 1, item.title, `${dateLabel(item.startDate)} - ${dateLabel(item.endDate)} · ${item.phase}`));
      return;
    }

    const monthCount = Math.max(1, Math.ceil(durationMonths || (projectEnd - projectStart) / (30.4375 * 86_400_000)));
    const tickStep = monthCount <= 18 ? 1 : monthCount <= 30 ? 2 : 3;
    const tickCount = Math.ceil(monthCount / tickStep);
    const labelWidth = 164;
    const timelineX = MARGIN + labelWidth;
    const timelineWidth = CONTENT_WIDTH - labelWidth;
    const rowHeight = 47;
    const chartHeight = 34 + items.length * rowHeight;
    this.ensure(chartHeight + 46);
    const top = this.y;
    this.page.drawText(`${formatDuration(durationMonths)} PLANNING WINDOW`, { x: MARGIN, y: top, size: 7.2, font: this.fonts.bold, color: RED });
    this.page.drawText(`${dateLabel(timelineStartDate)} - ${dateLabel(endDate)}`, { x: MARGIN + 183, y: top, size: 7.2, font: this.fonts.bold, color: INK });
    const chartTop = top - 18;
    const chartBottom = chartTop - chartHeight;
    this.page.drawRectangle({ x: MARGIN, y: chartBottom, width: CONTENT_WIDTH, height: chartHeight, color: WHITE, borderColor: LINE, borderWidth: 0.6 });
    this.page.drawRectangle({ x: MARGIN, y: chartTop - 34, width: CONTENT_WIDTH, height: 34, color: PAPER });
    this.page.drawText("MILESTONE", { x: MARGIN + 10, y: chartTop - 21, size: 5.8, font: this.fonts.bold, color: MUTED });
    for (let tick = 0; tick <= tickCount; tick += 1) {
      const x = timelineX + (timelineWidth * tick) / tickCount;
      this.page.drawLine({ start: { x, y: chartTop }, end: { x, y: chartBottom }, thickness: tick === 0 ? 0.8 : 0.35, color: LINE });
      if (tick === tickCount) continue;
      const month = monthTick(timelineStartDate, tick * tickStep);
      this.page.drawText(month.month, { x: x + 4, y: chartTop - 15, size: 5.2, font: this.fonts.bold, color: INK });
      this.page.drawText(month.year, { x: x + 4, y: chartTop - 25, size: 4.8, font: this.fonts.regular, color: MUTED });
    }
    items.forEach((item, index) => {
      const rowTop = chartTop - 34 - index * rowHeight;
      if (index % 2 === 1) this.page.drawRectangle({ x: MARGIN, y: rowTop - rowHeight, width: CONTENT_WIDTH, height: rowHeight, color: SOFT });
      this.page.drawLine({ start: { x: MARGIN, y: rowTop - rowHeight }, end: { x: PAGE_WIDTH - MARGIN, y: rowTop - rowHeight }, thickness: 0.3, color: LINE });
      this.page.drawText(fit(displayTitle(item.title), 31), { x: MARGIN + 10, y: rowTop - 17, size: 7.5, font: this.fonts.bold, color: INK });
      this.page.drawText(`${dateLabel(item.startDate)} - ${dateLabel(item.endDate)}`, { x: MARGIN + 10, y: rowTop - 32, size: 5.6, font: this.fonts.regular, color: MUTED });
      const itemStart = isoDay(item.startDate) ?? projectStart;
      const itemEnd = isoDay(item.endDate) ?? itemStart + 86_400_000;
      const startRatio = Math.max(0, Math.min(1, (itemStart - projectStart) / (projectEnd - projectStart)));
      const endRatio = Math.max(startRatio + 0.012, Math.min(1, (itemEnd - projectStart) / (projectEnd - projectStart)));
      const barX = timelineX + startRatio * timelineWidth;
      const barWidth = Math.max(5, (endRatio - startRatio) * timelineWidth);
      this.page.drawRectangle({ x: barX, y: rowTop - 29, width: Math.min(barWidth, timelineX + timelineWidth - barX), height: 11, color: RED });
    });
    this.y = chartBottom - 14;
  }

  scopeItem(title: string, description: string, amount: string) {
    const textWidth = amount ? 392 : 475;
    const lines = wrap(clean(description || "Included in the current project scope."), this.fonts.regular, 9.5, textWidth);
    const height = Math.max(68, 39 + lines.length * 13);
    this.ensure(height + 9);
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_WIDTH - MARGIN, y: this.y }, thickness: 0.6, color: LINE });
    this.page.drawText(displayTitle(title), { x: MARGIN, y: this.y - 22, size: 10.5, font: this.fonts.bold, color: INK });
    if (amount) {
      const width = this.fonts.bold.widthOfTextAtSize(clean(amount), 9.5);
      this.page.drawText(clean(amount), { x: PAGE_WIDTH - MARGIN - width, y: this.y - 22, size: 9.5, font: this.fonts.bold, color: RED });
    }
    let textY = this.y - 42;
    for (const line of lines) {
      this.page.drawText(line, { x: MARGIN, y: textY, size: 9.5, font: this.fonts.regular, color: MUTED });
      textY -= 13;
    }
    this.y -= height + 9;
  }

  pricePanel(label: string, amount: number) {
    this.ensure(120);
    this.page.drawRectangle({ x: MARGIN, y: this.y - 104, width: CONTENT_WIDTH, height: 104, color: PAPER, borderColor: LINE, borderWidth: 0.7 });
    this.page.drawRectangle({ x: MARGIN, y: this.y - 104, width: 7, height: 104, color: RED });
    this.page.drawText(clean(label).toUpperCase(), { x: MARGIN + 27, y: this.y - 32, size: 7.5, font: this.fonts.bold, color: RED });
    this.page.drawText(money(amount), { x: MARGIN + 27, y: this.y - 73, size: 29, font: this.fonts.bold, color: INK });
    this.y -= 123;
  }

  bullets(values: string[]) {
    for (const value of values) {
      const lines = wrap(clean(value), this.fonts.regular, 9.4, CONTENT_WIDTH - 27);
      this.ensure(lines.length * 13.5 + 10);
      this.page.drawRectangle({ x: MARGIN + 1, y: this.y - 2, width: 5, height: 5, color: RED });
      for (const line of lines) {
        this.page.drawText(line, { x: MARGIN + 21, y: this.y, size: 9.4, font: this.fonts.regular, color: MUTED });
        this.y -= 13.5;
      }
      this.y -= 5;
    }
  }

  signatureLines(owner: string, mefford: string) {
    this.ensure(154);
    const columns = [[owner, "OWNER / AUTHORIZED REPRESENTATIVE"], [mefford, "MEFFORD CONTRACTING, LLC"]];
    columns.forEach(([name, role], index) => {
      const x = MARGIN + index * 270;
      this.page.drawText(clean(name), { x, y: this.y - 7, size: 10, font: this.fonts.bold, color: INK });
      this.page.drawText(role, { x, y: this.y - 24, size: 6.3, font: this.fonts.bold, color: RED });
      this.page.drawLine({ start: { x, y: this.y - 72 }, end: { x: x + 225, y: this.y - 72 }, thickness: 0.7, color: MUTED });
      this.page.drawText("SIGNATURE", { x, y: this.y - 84, size: 6, font: this.fonts.bold, color: MUTED });
      this.page.drawLine({ start: { x, y: this.y - 119 }, end: { x: x + 139, y: this.y - 119 }, thickness: 0.7, color: MUTED });
      this.page.drawLine({ start: { x: x + 153, y: this.y - 119 }, end: { x: x + 225, y: this.y - 119 }, thickness: 0.7, color: MUTED });
      this.page.drawText("PRINTED NAME / TITLE", { x, y: this.y - 132, size: 6, font: this.fonts.bold, color: MUTED });
      this.page.drawText("DATE", { x: x + 153, y: this.y - 132, size: 6, font: this.fonts.bold, color: MUTED });
    });
    this.y -= 149;
  }

  smallPrint(value: string) {
    const lines = wrap(clean(value), this.fonts.regular, 7.2, CONTENT_WIDTH);
    this.ensure(lines.length * 10 + 10);
    for (const line of lines) {
      this.page.drawText(line, { x: MARGIN, y: this.y, size: 7.2, font: this.fonts.regular, color: MUTED });
      this.y -= 10;
    }
  }

  finish(skippedPages = new Set<PDFPage>()) {
    const total = this.pdf.getPageCount();
    for (const [index, page] of this.pdf.getPages().entries()) {
      if (index === 0 || skippedPages.has(page)) continue;
      page.drawLine({ start: { x: MARGIN, y: 38 }, end: { x: PAGE_WIDTH - MARGIN, y: 38 }, thickness: 0.5, color: LINE });
      page.drawText(`${this.recordId}  /  REVISION ${this.revision}`, { x: MARGIN, y: 22, size: 6.3, font: this.fonts.bold, color: MUTED });
      page.drawText(`MEFFORD CONTRACTING  /  ${index + 1} OF ${total}`, { x: 409, y: 22, size: 6.3, font: this.fonts.bold, color: RED });
    }
  }

  private ensure(height: number) {
    if (this.y - height >= 58) return;
    this.openPage("CONTINUED", this.currentTitle);
  }
}

function drawContainedImage(page: PDFPage, image: PDFImage, frame: { x: number; y: number; width: number; height: number }) {
  const scaled = image.scaleToFit(frame.width, frame.height);
  page.drawImage(image, {
    x: frame.x + (frame.width - scaled.width) / 2,
    y: frame.y + (frame.height - scaled.height) / 2,
    width: scaled.width,
    height: scaled.height,
  });
}

function drawBrand(
  page: PDFPage,
  fonts: Fonts,
  logo: PDFImage | null,
  x: number,
  y: number,
  inverse: boolean,
  maxWidth = 78,
) {
  if (logo) {
    const scaled = logo.scaleToFit(maxWidth, 55);
    if (inverse) {
      page.drawRectangle({ x: x - 9, y: y - 8, width: scaled.width + 18, height: scaled.height + 16, color: WHITE });
    }
    page.drawImage(logo, { x, y, width: scaled.width, height: scaled.height });
    return;
  }
  page.drawText("MEFFORD", { x, y: y + 20, size: inverse ? 20 : 16, font: fonts.bold, color: inverse ? WHITE : INK });
  page.drawText("CONTRACTING", { x, y: y + 7, size: 6.5, font: fonts.bold, color: RED });
}

function drawParagraph(
  page: PDFPage,
  value: string,
  font: PDFFont,
  size: number,
  x: number,
  y: number,
  width: number,
  lineHeight: number,
  color: ReturnType<typeof rgb>,
) {
  for (const paragraph of clean(value).split(/\n+/).filter(Boolean)) {
    for (const line of wrap(paragraph, font, size, width)) {
      page.drawText(line, { x, y, size, font, color });
      y -= lineHeight;
    }
    y -= 7;
  }
  return y;
}

function drawWrapped(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  x: number,
  y: number,
  width: number,
  lineHeight: number,
  color: ReturnType<typeof rgb>,
) {
  for (const line of wrap(text, font, size, width)) {
    page.drawText(line, { x, y, size, font, color });
    y -= lineHeight;
  }
  return y;
}

function drawFittedText(
  page: PDFPage,
  value: string,
  font: PDFFont,
  maximumSize: number,
  x: number,
  y: number,
  width: number,
  height: number,
  color: ReturnType<typeof rgb>,
) {
  const text = clean(value);
  let size = maximumSize;
  let lines = wrap(text, font, size, width);
  let lineHeight = size * 1.28;
  while (lines.length * lineHeight > height && size > 2.5) {
    size = Math.max(2.5, size - 0.2);
    lines = wrap(text, font, size, width);
    lineHeight = size * 1.28;
  }
  for (const line of lines) {
    page.drawText(line, { x, y, size, font, color });
    y -= lineHeight;
  }
  return y;
}

function wrap(value: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of clean(value).split(/\n+/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [""];
}

function drawBoundedLines(
  page: PDFPage,
  value: string,
  font: PDFFont,
  size: number,
  x: number,
  y: number,
  width: number,
  lineHeight: number,
  color: ReturnType<typeof rgb>,
  maxLines: number,
) {
  const source = wrap(value, font, size, width);
  const lines = source.slice(0, maxLines);
  if (source.length > maxLines && lines.length) {
    let last = `${lines.at(-1)}...`;
    while (last.length > 3 && font.widthOfTextAtSize(last, size) > width) last = `${last.slice(0, -4).trimEnd()}...`;
    lines[lines.length - 1] = last;
  }
  for (const line of lines) {
    page.drawText(line, { x, y, size, font, color });
    y -= lineHeight;
  }
  return y;
}

function displayTitle(value: unknown) {
  return clean(value).replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function isoDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function monthTick(startDate: string, offset: number) {
  const [year, month] = startDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, Math.max(0, month - 1) + offset, 1));
  return {
    month: date.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase(),
    year: String(date.getUTCFullYear()),
  };
}

function formatDuration(value: number) {
  const months = Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
  return `${months || "PROPOSED"}-MONTH`;
}

function clean(value: unknown) {
  return String(value ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/[\u2022\u25cf\u25a0]/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "")
    .trim();
}

function greeting(name: string, ownerName: string) {
  const first = clean(name).split(/\s+/).filter(Boolean)[0];
  return first ? `Dear ${first},` : `Dear ${clean(ownerName) || "Project"} Team,`;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
}

function dateLabel(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day ? `${month}/${day}/${year}` : clean(value);
}

function mailingAddressLines(value: string) {
  const address = clean(value);
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) return [address || "To Be Confirmed"];
  return [parts.slice(0, -2).join(", "), `${parts.at(-2)}, ${parts.at(-1)}`];
}

function fittedLineSize(lines: string[], font: PDFFont, maximumSize: number, width: number) {
  const widest = Math.max(...lines.map((line) => font.widthOfTextAtSize(line, maximumSize)), 0);
  return widest > width ? maximumSize * width / widest : maximumSize;
}

function fit(value: string, length: number) {
  return value.length <= length ? value : `${value.slice(0, Math.max(0, length - 3))}...`;
}

function pad2(value: number) { return String(value).padStart(2, "0"); }
function initials(value: string) { return clean(value).split(/\s+/).filter(Boolean).slice(0, 2).map((item) => item[0]).join("").toUpperCase() || "MC"; }

async function embedImage(pdf: PDFDocument, bytes?: Uint8Array, contentType = "") {
  if (!bytes?.length) return null;
  try {
    const png = contentType.toLowerCase() === "image/png" || (bytes[0] === 0x89 && bytes[1] === 0x50);
    return png ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  } catch { return null; }
}

function base64Bytes(value: string) {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}
