import { fileExtension, isPhotoUpload, normalizeUploadContentType } from "./photo-uploads";

export function isDocumentReadyImage(file: { name: string; type?: string | null }) {
  const contentType = normalizeUploadContentType(file.name, file.type);
  return contentType === "image/jpeg" || contentType === "image/png";
}

export async function prepareDocumentImage(file: File, maximumDimension = 4_096) {
  if (!isPhotoUpload(file)) throw new Error(`${file.name} Is Not Recognized As An Image File.`);
  if (isDocumentReadyImage(file)) return { file, converted: false };

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(sourceUrl);
    const sourceWidth = image.naturalWidth;
    const sourceHeight = image.naturalHeight;
    if (!sourceWidth || !sourceHeight) throw new Error("The Image Has No Readable Dimensions.");
    const scale = Math.min(1, maximumDimension / Math.max(sourceWidth, sourceHeight), Math.sqrt(12_000_000 / (sourceWidth * sourceHeight)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("This Browser Cannot Prepare An Image Preview.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob?.size) throw new Error("The Image Could Not Be Converted For Document Use.");
    const extension = fileExtension(file.name);
    const baseName = extension ? file.name.slice(0, -(extension.length + 1)) : file.name;
    return {
      file: new File([blob], `${baseName || "uploaded-image"}-document-copy.png`, { type: "image/png", lastModified: file.lastModified }),
      converted: true,
    };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function loadImage(sourceUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("This Browser Could Not Decode The Image For A Document Preview."));
    image.src = sourceUrl;
  });
}
