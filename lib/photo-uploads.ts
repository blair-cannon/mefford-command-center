const PHOTO_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  jfif: "image/jpeg",
  pjpeg: "image/jpeg",
  png: "image/png",
  apng: "image/apng",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heics: "image/heic-sequence",
  heif: "image/heif",
  heifs: "image/heif-sequence",
  hif: "image/heif",
  avif: "image/avif",
  bmp: "image/bmp",
  dib: "image/bmp",
  tga: "image/x-tga",
  pcx: "image/x-pcx",
  pic: "image/x-pict",
  pct: "image/x-pict",
  pict: "image/x-pict",
  sgi: "image/sgi",
  ras: "image/x-cmu-raster",
  hdr: "image/vnd.radiance",
  exr: "image/x-exr",
  wbmp: "image/vnd.wap.wbmp",
  xbm: "image/x-xbitmap",
  xpm: "image/x-xpixmap",
  icns: "image/icns",
  emf: "image/emf",
  wmf: "image/wmf",
  tif: "image/tiff",
  tiff: "image/tiff",
  svg: "image/svg+xml",
  svgz: "image/svg+xml",
  ico: "image/x-icon",
  cur: "image/x-icon",
  jp2: "image/jp2",
  j2k: "image/jp2",
  jpf: "image/jpx",
  jpx: "image/jpx",
  jpm: "image/jpm",
  mj2: "image/mj2",
  jxl: "image/jxl",
  psd: "image/vnd.adobe.photoshop",
  psb: "image/vnd.adobe.photoshop",
  eps: "image/x-eps",
  ai: "application/postscript",
  qoi: "image/qoi",
  ppm: "image/x-portable-pixmap",
  pgm: "image/x-portable-graymap",
  pbm: "image/x-portable-bitmap",
  pnm: "image/x-portable-anymap",
  dds: "image/vnd.ms-dds",
  xcf: "image/x-xcf",
  dng: "image/x-adobe-dng",
  raw: "image/x-raw",
  "3fr": "image/x-hasselblad-3fr",
  ari: "image/x-arri-raw",
  bay: "image/x-casio-bay",
  cap: "image/x-phaseone-cap",
  cin: "image/x-cineon",
  cr2: "image/x-canon-cr2",
  cr3: "image/x-canon-cr3",
  dcr: "image/x-kodak-dcr",
  dcs: "image/x-kodak-dcs",
  drf: "image/x-kodak-drf",
  eip: "image/x-phaseone-eip",
  fff: "image/x-hasselblad-fff",
  gpr: "image/x-gopro-gpr",
  iiq: "image/x-phaseone-iiq",
  k25: "image/x-kodak-k25",
  kdc: "image/x-kodak-kdc",
  mdc: "image/x-minolta-mdc",
  mrw: "image/x-minolta-mrw",
  nef: "image/x-nikon-nef",
  nrw: "image/x-nikon-nrw",
  arw: "image/x-sony-arw",
  sr2: "image/x-sony-sr2",
  srf: "image/x-sony-srf",
  rw2: "image/x-panasonic-rw2",
  orf: "image/x-olympus-orf",
  raf: "image/x-fuji-raf",
  pef: "image/x-pentax-pef",
  ptx: "image/x-pentax-ptx",
  pxn: "image/x-logitech-pxn",
  r3d: "image/x-red-r3d",
  rwl: "image/x-leica-rwl",
  srw: "image/x-samsung-srw",
  x3f: "image/x-sigma-x3f",
  erf: "image/x-epson-erf",
  mef: "image/x-mamiya-mef",
  mos: "image/x-leaf-mos",
};

const VIDEO_CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  qt: "video/quicktime",
  webm: "video/webm",
  avi: "video/x-msvideo",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  mpe: "video/mpeg",
  mkv: "video/x-matroska",
  mts: "video/mp2t",
  m2ts: "video/mp2t",
  ts: "video/mp2t",
  "3gp": "video/3gpp",
  "3g2": "video/3gpp2",
  ogv: "video/ogg",
  vob: "video/dvd",
  wmv: "video/x-ms-wmv",
  flv: "video/x-flv",
};

const COMMON_FILE_CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  xml: "application/xml",
  zip: "application/zip",
  gz: "application/gzip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  dwg: "image/vnd.dwg",
  dxf: "image/vnd.dxf",
  ifc: "application/x-step",
  rvt: "application/octet-stream",
  rfa: "application/octet-stream",
  skp: "application/vnd.sketchup.skp",
};

export const PHOTO_UPLOAD_ACCEPT = ["image/*", ...Object.keys(PHOTO_CONTENT_TYPES).map((extension) => `.${extension}`)].join(",");
export const VIDEO_UPLOAD_ACCEPT = ["video/*", ...Object.keys(VIDEO_CONTENT_TYPES).map((extension) => `.${extension}`)].join(",");
export const PDF_AND_PHOTO_UPLOAD_ACCEPT = `application/pdf,.pdf,${PHOTO_UPLOAD_ACCEPT}`;

export function fileExtension(name: string) {
  return name.toLowerCase().split(".").pop()?.trim() || "";
}

export function isPhotoExtension(name: string) {
  return Boolean(PHOTO_CONTENT_TYPES[fileExtension(name)]);
}

export function isPhotoUpload(file: { name: string; type?: string | null }) {
  return Boolean(file.type?.toLowerCase().startsWith("image/")) || isPhotoExtension(file.name);
}

export function isVideoUpload(file: { name: string; type?: string | null }) {
  return Boolean(file.type?.toLowerCase().startsWith("video/")) || Boolean(VIDEO_CONTENT_TYPES[fileExtension(file.name)]);
}

export function normalizeUploadContentType(name: string, reportedType?: string | null) {
  const normalizedReportedType = reportedType?.trim().toLowerCase() || "";
  const extension = fileExtension(name);
  const inferredType = PHOTO_CONTENT_TYPES[extension] || VIDEO_CONTENT_TYPES[extension] || COMMON_FILE_CONTENT_TYPES[extension] || "";
  if (normalizedReportedType && normalizedReportedType !== "application/octet-stream") return normalizedReportedType;
  return inferredType || normalizedReportedType || "application/octet-stream";
}

export function normalizePhotoContentType(name: string, reportedType?: string | null) {
  return normalizeUploadContentType(name, reportedType);
}

export function photoUploadContentType(file: { name: string; type?: string | null }) {
  return normalizeUploadContentType(file.name, file.type);
}

export function isPdfOrPhotoUpload(file: { name: string; type?: string | null }) {
  return file.type?.toLowerCase() === "application/pdf" || fileExtension(file.name) === "pdf" || isPhotoUpload(file);
}

export function storedFileResponseHeaders(input: {
  name: string;
  contentType?: string | null;
  sizeBytes?: number | null;
  cacheControl?: string;
}) {
  const contentType = normalizeUploadContentType(input.name, input.contentType);
  const normalized = contentType.split(";", 1)[0].trim().toLowerCase();
  const inline = normalized === "application/pdf" || normalized === "text/plain" || normalized.startsWith("image/") || normalized.startsWith("audio/") || normalized.startsWith("video/");
  return {
    "Content-Type": contentType,
    ...(Number.isFinite(input.sizeBytes) && Number(input.sizeBytes) >= 0 ? { "Content-Length": String(input.sizeBytes) } : {}),
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(input.name)}`,
    "Cache-Control": input.cacheControl || "private, no-store",
    "X-Content-Type-Options": "nosniff",
    ...(normalized === "image/svg+xml" ? { "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:" } : {}),
  };
}
