import { strToU8, zipSync } from "fflate";

export type EditableOwnerContractDocxOptions = {
  title: string;
  projectNumber: string;
  contractType: string;
  instrument: string;
  recordId: string;
  revisionLabel: string;
  status: string;
  templateId: string;
  templateVersion: string;
  renderedHtml: string;
  basisAttachments?: Array<{ label: string; name: string; revision: string; fileId: number }>;
};

type HtmlNode = HtmlElement | HtmlText;
type HtmlElement = { kind: "element"; tag: string; attrs: Record<string, string>; children: HtmlNode[] };
type HtmlText = { kind: "text"; text: string };
type Run = { text?: string; break?: boolean; bold?: boolean; italic?: boolean; underline?: boolean; size?: number; superscript?: boolean; subscript?: boolean };
type RunState = Omit<Run, "text" | "break">;
type BlockContext = { inCell?: boolean; indent?: number; headerCell?: boolean };
type TableRow = { element: HtmlElement; header: boolean };

const VOID_TAGS = new Set(["br", "hr", "img", "input", "meta", "link", "col", "source", "wbr"]);
const BLOCK_TAGS = new Set(["body", "main", "section", "article", "header", "footer", "div", "p", "h1", "h2", "h3", "table", "ul", "ol", "li", "blockquote"]);
const IGNORED_TAGS = new Set(["head", "style", "script", "noscript", "template"]);

export function createEditableOwnerContractDocx(options: EditableOwnerContractDocxOptions) {
  const parsed = parseHtml(options.renderedHtml);
  const body = findElement(parsed, "body") || parsed;
  const contractBlocks = body.children.flatMap((node) => blockXml(node, {}));
  const documentXml = documentPart(options, contractBlocks.join(""));
  const created = new Date().toISOString();

  return zipSync({
    "[Content_Types].xml": strToU8(contentTypesXml()),
    "_rels/.rels": strToU8(packageRelationshipsXml()),
    "docProps/core.xml": strToU8(corePropertiesXml(options.title, created)),
    "docProps/app.xml": strToU8(appPropertiesXml()),
    "word/document.xml": strToU8(documentXml),
    "word/styles.xml": strToU8(stylesXml()),
    "word/settings.xml": strToU8(settingsXml()),
    "word/_rels/document.xml.rels": strToU8(documentRelationshipsXml()),
  }, { level: 6 });
}

function documentPart(options: EditableOwnerContractDocxOptions, body: string) {
  const basis = options.basisAttachments || [];
  const rows = [
    ["Project", `${options.title} · ${options.projectNumber}`],
    ["Contract", [options.contractType, options.instrument].filter(Boolean).join(" · ")],
    ["Controlled Record", `${options.recordId} · ${options.revisionLabel}`],
    ["Template", `${options.templateId} · ${options.templateVersion}`],
    ["Command Center Status", options.status],
  ];
  const coverTable = simpleTable(rows);
  const basisSection = basis.length
    ? `${paragraphXmlFromText("Contract Basis PDFs", "Heading2")}${simpleTable(basis.map((attachment) => [attachment.label, `${attachment.name} · ${attachment.revision} · File ${attachment.fileId}`]))}`
    : "";
  const warning = options.contractType === "External Contract"
    ? "This editable Word file is a review copy of the Command Center control record. The uploaded external agreement remains the controlling contract."
    : "This editable Word file is provided for Project Owner review and proposed edits. It does not change or replace the controlled contract revision in Mefford Command Center. Changes must be reconciled and approved there before signature.";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${paragraphXmlFromText("MEFFORD CONTRACTING, LLC", "SmallHeader")}
    ${paragraphXmlFromText("EDITABLE PROJECT OWNER REVIEW COPY", "Title")}
    ${paragraphXmlFromText(warning, "Notice")}
    ${coverTable}
    ${basisSection}
    ${paragraphXmlFromText("The separate PDF attachments listed above remain unchanged and are not embedded in this editable Word file.", "Notice", basis.length === 0)}
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>
    ${body}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="900" w:right="980" w:bottom="850" w:left="980" w:header="420" w:footer="420" w:gutter="0"/>
      <w:cols w:space="720"/>
      <w:docGrid w:linePitch="360"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

function parseHtml(html: string): HtmlElement {
  const root: HtmlElement = { kind: "element", tag: "root", attrs: {}, children: [] };
  const stack: HtmlElement[] = [root];
  const tokens = html.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>]*>|[^<]+/g) || [];
  for (const token of tokens) {
    if (token.startsWith("<!--") || token.startsWith("<!")) continue;
    if (!token.startsWith("<")) {
      stack[stack.length - 1].children.push({ kind: "text", text: decodeHtml(token) });
      continue;
    }
    if (/^<\//.test(token)) {
      const closing = token.match(/^<\/\s*([A-Za-z0-9:-]+)/)?.[1]?.toLowerCase();
      if (!closing) continue;
      const index = stack.map((node) => node.tag).lastIndexOf(closing);
      if (index > 0) stack.splice(index);
      continue;
    }
    const match = token.match(/^<\s*([A-Za-z0-9:-]+)/);
    if (!match) continue;
    const tag = match[1].toLowerCase();
    const element: HtmlElement = { kind: "element", tag, attrs: parseAttributes(token.slice(match[0].length, token.length - 1)), children: [] };
    stack[stack.length - 1].children.push(element);
    if (!VOID_TAGS.has(tag) && !/\/\s*>$/.test(token)) stack.push(element);
  }
  return root;
}

function parseAttributes(source: string) {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function findElement(node: HtmlElement, tag: string): HtmlElement | null {
  for (const child of node.children) {
    if (child.kind !== "element") continue;
    if (child.tag === tag) return child;
    const nested = findElement(child, tag);
    if (nested) return nested;
  }
  return null;
}

function blockXml(node: HtmlNode, context: BlockContext): string[] {
  if (node.kind === "text") {
    const text = collapseHtmlWhitespace(node.text).trim();
    return text ? [paragraphXml([{ text }], context)] : [];
  }
  if (IGNORED_TAGS.has(node.tag) || node.tag === "col" || node.tag === "thead" || node.tag === "tbody" || node.tag === "tfoot" || node.tag === "tr" || node.tag === "td" || node.tag === "th") return [];
  if (node.tag === "table") return [tableXml(node, context)];
  if (node.tag === "p" || node.tag === "h1" || node.tag === "h2" || node.tag === "h3" || node.tag === "blockquote") {
    const runs = inlineRuns(node.children, {}, context.headerCell);
    return hasRunContent(runs) ? [paragraphXml(runs, context, node)] : [];
  }
  if (node.tag === "ul" || node.tag === "ol") {
    const items = node.children.filter((child): child is HtmlElement => child.kind === "element" && child.tag === "li");
    return items.flatMap((item, index) => {
      const runs = inlineRuns(item.children, {}, context.headerCell);
      const marker = node.tag === "ol" ? `${index + 1}. ` : "• ";
      return hasRunContent(runs) ? [paragraphXml([{ text: marker, bold: node.tag === "ol" }, ...runs], { ...context, indent: (context.indent || 0) + 240 }, item)] : [];
    });
  }
  if (node.tag === "li") {
    const runs = inlineRuns(node.children, {}, context.headerCell);
    return hasRunContent(runs) ? [paragraphXml([{ text: "• " }, ...runs], { ...context, indent: (context.indent || 0) + 240 }, node)] : [];
  }

  const className = node.attrs.class || "";
  const indented = /\b(subsection|scope-block)\b/.test(className) ? (context.indent || 0) + 220 : context.indent;
  const childContext = { ...context, indent: indented };
  const hasBlockChild = node.children.some((child) => child.kind === "element" && BLOCK_TAGS.has(child.tag));
  if (!hasBlockChild && !["root", "html"].includes(node.tag)) {
    const runs = inlineRuns(node.children, node.tag === "header" ? { bold: true, size: 17 } : {}, context.headerCell);
    return hasRunContent(runs) ? [paragraphXml(runs, childContext, node)] : [];
  }
  return node.children.flatMap((child) => blockXml(child, childContext));
}

function inlineRuns(nodes: HtmlNode[], state: RunState = {}, forceBold = false): Run[] {
  const runs: Run[] = [];
  for (const node of nodes) {
    if (node.kind === "text") {
      const text = collapseHtmlWhitespace(node.text);
      if (text) runs.push({ text, ...state, ...(forceBold ? { bold: true } : {}) });
      continue;
    }
    if (node.tag === "br") {
      runs.push({ break: true });
      continue;
    }
    if (node.tag === "img") {
      const label = node.attrs.alt || "Electronic Signature";
      runs.push({ text: `[${label} retained in the controlled Command Center record]`, italic: true });
      continue;
    }
    if (IGNORED_TAGS.has(node.tag)) continue;
    const next = runState(node, state);
    runs.push(...inlineRuns(node.children, next, forceBold));
  }
  return trimRuns(runs);
}

function runState(node: HtmlElement, state: RunState): RunState {
  const next = { ...state };
  if (["b", "strong"].includes(node.tag)) next.bold = true;
  if (["i", "em"].includes(node.tag)) next.italic = true;
  if (["u", "a"].includes(node.tag)) next.underline = true;
  if (node.tag === "sup") next.superscript = true;
  if (node.tag === "sub") next.subscript = true;
  const style = node.attrs.style || "";
  if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) next.bold = true;
  if (/font-weight\s*:\s*(normal|[1-4]00)/i.test(style)) next.bold = false;
  if (/font-style\s*:\s*italic/i.test(style)) next.italic = true;
  if (/font-style\s*:\s*normal/i.test(style)) next.italic = false;
  const size = style.match(/font-size\s*:\s*([\d.]+)pt/i);
  if (size) next.size = Math.max(14, Math.min(56, Math.round(Number(size[1]) * 2)));
  return next;
}

function paragraphXml(runs: Run[], context: BlockContext, element?: HtmlElement) {
  const tag = element?.tag || "p";
  const classes = element?.attrs.class || "";
  const style = element?.attrs.style || "";
  const centered = element?.attrs.align?.toLowerCase() === "center" || /text-align\s*:\s*center/i.test(style);
  const right = element?.attrs.align?.toLowerCase() === "right" || /text-align\s*:\s*right/i.test(style);
  const pageBreak = /page-break-before\s*:\s*always|break-before\s*:\s*page/i.test(style) || /\bpage-break-before\b/.test(classes);
  const isBrand = element?.tag === "header" || /\bbrand\b/.test(classes);
  const styleId = tag === "h1" ? (centered ? "Title" : "Heading1") : tag === "h2" ? "Heading2" : tag === "h3" ? "Heading3" : isBrand ? "SmallHeader" : tag === "blockquote" ? "Quote" : context.inCell ? "TableText" : /\bscope-block\b/.test(classes) ? "ScopeText" : "Normal";
  const indent = context.indent || 0;
  const properties = [
    `<w:pStyle w:val="${styleId}"/>`,
    centered ? '<w:jc w:val="center"/>' : right ? '<w:jc w:val="right"/>' : "",
    indent ? `<w:ind w:left="${indent}"/>` : "",
    pageBreak ? "<w:pageBreakBefore/>" : "",
    ["h1", "h2", "h3"].includes(tag) ? "<w:keepNext/>" : "",
    context.inCell ? '<w:spacing w:after="0"/>' : "",
    /\bscope-block\b/.test(classes) ? '<w:pBdr><w:left w:val="single" w:sz="8" w:space="6" w:color="000000"/></w:pBdr>' : "",
  ].join("");
  return `<w:p><w:pPr>${properties}</w:pPr>${runs.map(runXml).join("")}</w:p>`;
}

function paragraphXmlFromText(text: string, styleId: string, omit = false) {
  if (omit || !text.trim()) return "";
  return `<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>${runXml({ text })}</w:p>`;
}

function runXml(run: Run) {
  if (run.break) return "<w:r><w:br/></w:r>";
  const properties = [
    run.bold === true ? "<w:b/>" : run.bold === false ? '<w:b w:val="0"/>' : "",
    run.italic === true ? "<w:i/>" : run.italic === false ? '<w:i w:val="0"/>' : "",
    run.underline ? '<w:u w:val="single"/>' : "",
    run.size ? `<w:sz w:val="${run.size}"/><w:szCs w:val="${run.size}"/>` : "",
    run.superscript ? '<w:vertAlign w:val="superscript"/>' : run.subscript ? '<w:vertAlign w:val="subscript"/>' : "",
  ].join("");
  const text = run.text || "";
  const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ""}<w:t${preserve}>${xml(text)}</w:t></w:r>`;
}

function tableXml(table: HtmlElement, context: BlockContext) {
  const rows = tableRows(table);
  if (!rows.length) return "";
  const signature = /\bsignature\b/.test(table.attrs.class || "");
  const columnCount = Math.max(...rows.map((row) => tableCells(row.element).length), 1);
  const widths = columnWidths(rows[0]?.element, columnCount, 9360);
  const borders = signature
    ? '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>'
    : '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="555555"/><w:left w:val="single" w:sz="4" w:color="555555"/><w:bottom w:val="single" w:sz="4" w:color="555555"/><w:right w:val="single" w:sz="4" w:color="555555"/><w:insideH w:val="single" w:sz="4" w:color="777777"/><w:insideV w:val="single" w:sz="4" w:color="777777"/></w:tblBorders>';
  const grid = widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("");
  const rowXml = rows.map((row) => {
    const cells = tableCells(row.element);
    const labelRow = signature && /\blabel\b/.test(row.element.attrs.class || "");
    return `<w:tr>${row.header ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${cells.map((cell, index) => tableCellXml(cell, widths[index] || Math.round(9360 / columnCount), { ...context, inCell: true, headerCell: row.header || cell.tag === "th" }, signature, labelRow)).join("")}</w:tr>`;
  }).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="fixed"/>${borders}<w:tblCellMar><w:top w:w="90" w:type="dxa"/><w:left w:w="110" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rowXml}</w:tbl>`;
}

function tableCellXml(cell: HtmlElement, width: number, context: BlockContext, signature: boolean, labelRow: boolean) {
  const blocks = cell.children.flatMap((child) => blockXml(child, context));
  const content = blocks.length ? blocks.join("") : "<w:p/>";
  const bottomBorder = signature && !labelRow ? '<w:tcBorders><w:bottom w:val="single" w:sz="4" w:color="000000"/></w:tcBorders>' : "";
  const shade = context.headerCell && !signature ? '<w:shd w:fill="D9D9D9"/>' : "";
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade}${bottomBorder}<w:vAlign w:val="top"/></w:tcPr>${content}</w:tc>`;
}

function tableRows(table: HtmlElement) {
  const rows: TableRow[] = [];
  const visit = (element: HtmlElement, header: boolean) => {
    for (const child of element.children) {
      if (child.kind !== "element") continue;
      if (child.tag === "tr") rows.push({ element: child, header });
      else if (["thead", "tbody", "tfoot"].includes(child.tag)) visit(child, header || child.tag === "thead");
    }
  };
  visit(table, false);
  return rows;
}

function tableCells(row: HtmlElement) {
  return row.children.filter((child): child is HtmlElement => child.kind === "element" && ["td", "th"].includes(child.tag));
}

function columnWidths(row: HtmlElement | undefined, count: number, total: number) {
  const raw = row ? tableCells(row).map((cell) => Number.parseFloat(cell.attrs.width || "0")) : [];
  const sum = raw.reduce((value, width) => value + (Number.isFinite(width) ? width : 0), 0);
  if (sum > 0 && raw.length === count) return raw.map((width) => Math.max(360, Math.round((width / sum) * total)));
  return Array.from({ length: count }, () => Math.round(total / count));
}

function simpleTable(rows: string[][]) {
  const elements: HtmlElement = {
    kind: "element",
    tag: "table",
    attrs: {},
    children: rows.map((row) => ({
      kind: "element" as const,
      tag: "tr",
      attrs: {},
      children: row.map((value, index) => ({ kind: "element" as const, tag: index === 0 ? "th" : "td", attrs: { width: index === 0 ? "30" : "70" }, children: [{ kind: "text" as const, text: value }] })),
    })),
  };
  return tableXml(elements, {});
}

function trimRuns(runs: Run[]) {
  const next = runs.filter((run) => run.break || Boolean(run.text));
  const firstText = next.find((run) => run.text);
  const lastText = [...next].reverse().find((run) => run.text);
  if (firstText?.text) firstText.text = firstText.text.replace(/^\s+/, "");
  if (lastText?.text) lastText.text = lastText.text.replace(/\s+$/, "");
  return next.filter((run) => run.break || Boolean(run.text));
}

function hasRunContent(runs: Run[]) {
  return runs.some((run) => run.break || Boolean(run.text?.trim()));
}

function collapseHtmlWhitespace(value: string) {
  return value.replace(/[\t\n\r ]+/g, " ");
}

function decodeHtml(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, key: string) => {
    const normalized = key.toLowerCase();
    if (normalized === "amp") return "&";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "quot") return '"';
    if (normalized === "apos") return "'";
    if (normalized === "nbsp") return " ";
    const code = normalized.startsWith("#x") ? Number.parseInt(normalized.slice(2), 16) : Number.parseInt(normalized.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
  });
}

function xml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&apos;", '"': "&quot;" })[character] || character);
}

function contentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}

function packageRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function documentRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`;
}

function corePropertiesXml(title: string, created: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:subject>Editable Project Owner Contract Review Copy</dc:subject><dc:creator>Mefford Contracting, LLC</dc:creator><cp:lastModifiedBy>Mefford Command Center</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>`;
}

function appPropertiesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Mefford Command Center</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><Company>Mefford Contracting, LLC</Company><AppVersion>1.0</AppVersion></Properties>`;
}

function settingsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial"/><w:color w:val="000000"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="110" w:line="284" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="100" w:after="180"/><w:jc w:val="center"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="260" w:after="110"/><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="220" w:after="90"/><w:keepNext/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="180" w:after="80"/><w:keepNext/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="SmallHeader"><w:name w:val="Small Header"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="150"/><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="6" w:color="000000"/></w:pBdr></w:pPr><w:rPr><w:b/><w:sz w:val="17"/><w:szCs w:val="17"/><w:caps/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Notice"><w:name w:val="Review Notice"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="180"/><w:ind w:left="180" w:right="180"/><w:pBdr><w:top w:val="single" w:sz="6" w:space="6" w:color="000000"/><w:left w:val="single" w:sz="6" w:space="6" w:color="000000"/><w:bottom w:val="single" w:sz="6" w:space="6" w:color="000000"/><w:right w:val="single" w:sz="6" w:space="6" w:color="000000"/></w:pBdr></w:pPr><w:rPr><w:b/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="250" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ScopeText"><w:name w:val="Scope Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="150"/><w:ind w:left="180"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360" w:right="360"/><w:spacing w:after="120"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
</w:styles>`;
}
