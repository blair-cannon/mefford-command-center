import { ownerContractBasisAttachments } from "./owner-contract-basis";

export function renderOwnerContractBasisSchedule(
  fields: Record<string, unknown>,
  fileHref?: (fileId: number) => string,
) {
  const attachments = ownerContractBasisAttachments(fields);
  if (!attachments.length) return "";
  const rows = attachments.map((attachment, index) => {
    const open = fileHref
      ? `<a href="${escapeHtml(fileHref(attachment.fileId))}" target="_blank" rel="noreferrer">Open Attached PDF</a>`
      : "<span>Available In The Project Owner Portal</span>";
    return `<tr><td>${index + 1}</td><td><strong>${escapeHtml(attachment.label)}</strong><span>${escapeHtml(attachment.name)}</span></td><td>${escapeHtml(attachment.revision)}</td><td>${attachment.fileId}</td><td>${open}</td></tr>`;
  }).join("");
  return `<section class="contract-basis-schedule"><header><p>CONTRACT EXHIBIT REGISTER</p><h1>Contract Basis PDFs</h1><span>These exact PDF files are incorporated as contract-basis documents for this revision.</span></header><table><thead><tr><th>No.</th><th>Document</th><th>Revision / Issue Date</th><th>File ID</th><th>Access</th></tr></thead><tbody>${rows}</tbody></table><p class="contract-basis-order">The listed PDFs are part of the basis of this Contract, subject to the Contract’s existing order-of-precedence terms. A discrepancy, conflict, or later replacement must be resolved through a written contract change.</p></section>`;
}

export function renderOwnerContractBasisToolbarLinks(fields: Record<string, unknown>) {
  return ownerContractBasisAttachments(fields).map((attachment) => `<a href="/api/files?id=${encodeURIComponent(String(attachment.fileId))}" target="_blank" rel="noreferrer">Open ${escapeHtml(attachment.label)}</a>`).join("");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);
}
