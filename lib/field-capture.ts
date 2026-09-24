const originalNames = new WeakMap<File, string>();

// Camera rolls often reuse IMG.jpg. Preserve every distinct original without
// allowing a later shot to replace an earlier shot or its markup.
export function appendFieldPhotos(current: File[], incoming: File[]) {
  const result = [...current];
  const identity = (file: File) => `${originalNames.get(file) || file.name}\0${file.size}\0${file.lastModified}`;
  const known = new Set(current.map(identity));
  const names = new Set(current.map(file => file.name));
  for (const file of incoming) {
    if (known.has(identity(file))) continue;
    known.add(identity(file));
    let name = file.name;
    let copy = 2;
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : "";
    while (names.has(name)) name = `${stem} (${copy++})${extension}`;
    const selected = name === file.name ? file : new File([file], name, { type: file.type, lastModified: file.lastModified });
    originalNames.set(selected, originalNames.get(file) || file.name);
    names.add(name);
    result.push(selected);
  }
  return result;
}

export async function uploadFieldPhotos(
  files: File[],
  upload: (file: File) => Promise<void>,
  onProgress?: (progress: { uploaded: number; processed: number; total: number }) => void,
) {
  let next = 0;
  let uploaded = 0;
  let processed = 0;
  const failed = new Set<File>();
  onProgress?.({ uploaded, processed, total: files.length });
  await Promise.all(Array.from({ length: Math.min(3, files.length) }, async () => {
    while (next < files.length) {
      const file = files[next++];
      try { await upload(file); uploaded += 1; }
      catch { failed.add(file); }
      processed += 1;
      onProgress?.({ uploaded, processed, total: files.length });
    }
  }));
  return files.filter(file => failed.has(file));
}

export function fieldDateTime(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)?.value || "";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, time: `${value("hour")}:${value("minute")}` };
}
