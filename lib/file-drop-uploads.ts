import { normalizeUploadContentType } from "./photo-uploads";

type UploadFile = Pick<File, "name" | "type">;

export function fileDropError(files: readonly UploadFile[], options: { multiple: boolean; accept: string; disabled: boolean }) {
  if (options.disabled) return "This Upload Is Not Available Right Now.";
  if (!files.length) return "Choose Files Instead Of A Folder Or Link.";
  if (!options.multiple && files.length > 1) return "Drop One File At A Time Here.";
  const accepted = options.accept.toLowerCase().split(",").map(value => value.trim()).filter(Boolean);
  const unsupported = files.filter(file => {
    const type = normalizeUploadContentType(file.name, file.type).toLowerCase();
    return accepted.length && !accepted.some(value => value.startsWith(".")
      ? file.name.toLowerCase().endsWith(value)
      : value.endsWith("/*") ? type.startsWith(value.slice(0, -1)) : type === value);
  });
  return unsupported.length ? `This Upload Does Not Accept: ${unsupported.map(file => file.name).join(", ")}` : "";
}

/** Use the same native change event as the file picker, keeping each screen's upload rules. */
export function applyDroppedFiles(input: HTMLInputElement, files: FileList) {
  const error = fileDropError(Array.from(files), {
    multiple: input.multiple,
    accept: input.accept,
    disabled: input.matches(":disabled"),
  });
  if (error) return error;
  try {
    input.files = files;
  } catch {
    return "Drop Is Unavailable In This Browser. Click To Choose Your Files.";
  }
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return "";
}
