"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { isPhotoUpload } from "../lib/photo-uploads";

export type MobileMediaMarkup = {
  originalName: string;
  annotatedFile: File | null;
  caption: string;
  pairRole: "Standalone" | "Before" | "After";
  pairReference: string;
  operationCount: number;
};

type MarkupTool = "Arrow" | "Circle" | "Text";
type Point = { x: number; y: number };
type Operation =
  | { tool: "Arrow"; start: Point; end: Point }
  | { tool: "Circle"; start: Point; end: Point }
  | { tool: "Text"; point: Point; text: string };

export function MobileMediaEditor({
  file,
  initial,
  onCancel,
  onSave,
}: {
  file: File;
  initial?: MobileMediaMarkup;
  onCancel: () => void;
  onSave: (markup: MobileMediaMarkup) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const startRef = useRef<Point | null>(null);
  const previewRef = useRef<Operation | null>(null);
  const [tool, setTool] = useState<MarkupTool>("Arrow");
  const [text, setText] = useState("");
  const [caption, setCaption] = useState(initial?.caption || "");
  const [pairRole, setPairRole] = useState<MobileMediaMarkup["pairRole"]>(initial?.pairRole || "Standalone");
  const [pairReference, setPairReference] = useState(initial?.pairReference || "");
  const [operations, setOperations] = useState<Operation[]>([]);
  const [ready, setReady] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const imageUrl = useMemo(() => URL.createObjectURL(file), [file]);

  useEffect(() => () => URL.revokeObjectURL(imageUrl), [imageUrl]);

  useEffect(() => {
    const image = new Image();
    let cancelled = false;
    imageRef.current = null;
    queueMicrotask(() => {
      if (!cancelled) {
        setReady(false);
        setPreviewError(false);
      }
    });
    image.onload = () => {
      if (cancelled) return;
      imageRef.current = image;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const maxWidth = 1200;
      const scale = Math.min(1, maxWidth / image.naturalWidth);
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      setReady(true);
    };
    image.onerror = () => { if (!cancelled) setPreviewError(true); };
    image.src = imageUrl;
    return () => { cancelled = true; image.onload = null; image.onerror = null; };
  }, [imageUrl]);

  useEffect(() => {
    if (!ready) return;
    renderMarkup(canvasRef.current, imageRef.current, operations, previewRef.current);
  }, [operations, ready]);

  function canvasPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) * canvas.width) / bounds.width,
      y: ((event.clientY - bounds.top) * canvas.height) / bounds.height,
    };
  }

  function begin(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!ready) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = canvasPoint(event);
    if (tool === "Text") {
      const value = text.trim();
      if (!value) return;
      setOperations((current) => [...current, { tool: "Text", point, text: value }]);
      setText("");
      return;
    }
    startRef.current = point;
  }

  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!startRef.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    const operation = { tool, start: startRef.current, end: canvasPoint(event) } as Operation;
    previewRef.current = operation;
    renderMarkup(canvasRef.current, imageRef.current, operations, operation);
  }

  function finish(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!startRef.current) return;
    event.preventDefault();
    const operation = { tool, start: startRef.current, end: canvasPoint(event) } as Operation;
    startRef.current = null;
    previewRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setOperations((current) => [...current, operation]);
  }

  function undo() {
    setOperations((current) => current.slice(0, -1));
  }

  async function save() {
    const canvas = canvasRef.current;
    if (canvas) renderMarkup(canvas, imageRef.current, operations, null);
    const annotatedFile = canvas && operations.length
      ? await canvasFile(canvas, `MARKED-${safeFilename(file.name.replace(/\.[^.]+$/, ""))}.jpg`)
      : null;
    onSave({
      originalName: file.name,
      annotatedFile,
      caption: caption.trim(),
      pairRole,
      pairReference: pairRole === "Standalone" ? "" : pairReference.trim(),
      operationCount: operations.length,
    });
  }

  if (!isPhotoUpload(file)) return null;

  return (
    <div className="mobile-markup-layer" role="presentation">
      <section className="mobile-markup-editor" role="dialog" aria-modal="true" aria-labelledby="mobile-markup-title">
        <header>
          <div><span>FIELD PHOTO MARKUP</span><h2 id="mobile-markup-title">Markup Working Copy</h2><p>{file.name}</p></div>
          <button type="button" aria-label="Close photo markup" onClick={onCancel}>×</button>
        </header>
        <div className="mobile-markup-canvas-wrap">{previewError ? <div className="mobile-markup-unavailable"><strong>Preview Not Available In This Browser</strong><span>The Original Image Is Still Accepted And Will Remain Downloadable. Caption And Before / After Details Can Still Be Saved.</span></div> : <canvas ref={canvasRef} onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} aria-label="Photo markup drawing surface" />}</div>
        {!previewError ? <div className="mobile-markup-tools" role="toolbar" aria-label="Photo markup tools">
          {(["Arrow", "Circle", "Text"] as MarkupTool[]).map((item) => <button key={item} type="button" className={tool === item ? "active" : ""} aria-pressed={tool === item} onClick={() => setTool(item)}>{item === "Arrow" ? "→" : item === "Circle" ? "◯" : "T"} {item}</button>)}
          <button type="button" onClick={undo} disabled={!operations.length}>↶ Undo</button>
        </div> : null}
        {!previewError && tool === "Text" ? <label className="mobile-markup-text">Markup Text<input value={text} onChange={(event) => setText(event.target.value)} placeholder="Type text, then tap its location on the photo" /></label> : null}
        <div className="mobile-markup-details">
          <label className="wide">Photo Caption<input value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Describe what this photo documents" /></label>
          <label>Pairing<select value={pairRole} onChange={(event) => setPairRole(event.target.value as MobileMediaMarkup["pairRole"])}><option>Standalone</option><option>Before</option><option>After</option></select></label>
          <label>Before / After Reference<input value={pairReference} onChange={(event) => setPairReference(event.target.value)} disabled={pairRole === "Standalone"} placeholder="Example: West wall repair 01" /></label>
        </div>
        <footer><span>{operations.length} markup item{operations.length === 1 ? "" : "s"} · original remains unchanged</span><div><button type="button" className="secondary-action" onClick={onCancel}>Cancel</button><button type="button" className="primary-action large" onClick={() => void save()}>Save Marked Copy</button></div></footer>
      </section>
    </div>
  );
}

function renderMarkup(canvas: HTMLCanvasElement | null, image: HTMLImageElement | null, operations: Operation[], preview: Operation | null) {
  if (!canvas || !image) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const operation of preview ? [...operations, preview] : operations) drawOperation(context, operation, canvas.width);
}

function drawOperation(context: CanvasRenderingContext2D, operation: Operation, canvasWidth: number) {
  const scale = Math.max(1, canvasWidth / 800);
  context.save();
  context.strokeStyle = "#d72f25";
  context.fillStyle = "#d72f25";
  context.lineWidth = 5 * scale;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (operation.tool === "Text") {
    context.font = `900 ${Math.round(26 * scale)}px Arial, sans-serif`;
    context.lineWidth = 4 * scale;
    context.strokeStyle = "rgba(255,255,255,.95)";
    context.strokeText(operation.text, operation.point.x, operation.point.y);
    context.fillText(operation.text, operation.point.x, operation.point.y);
  } else if (operation.tool === "Circle") {
    const centerX = (operation.start.x + operation.end.x) / 2;
    const centerY = (operation.start.y + operation.end.y) / 2;
    context.beginPath();
    context.ellipse(centerX, centerY, Math.abs(operation.end.x - operation.start.x) / 2, Math.abs(operation.end.y - operation.start.y) / 2, 0, 0, Math.PI * 2);
    context.stroke();
  } else {
    const angle = Math.atan2(operation.end.y - operation.start.y, operation.end.x - operation.start.x);
    const head = 20 * scale;
    context.beginPath();
    context.moveTo(operation.start.x, operation.start.y);
    context.lineTo(operation.end.x, operation.end.y);
    context.lineTo(operation.end.x - head * Math.cos(angle - Math.PI / 6), operation.end.y - head * Math.sin(angle - Math.PI / 6));
    context.moveTo(operation.end.x, operation.end.y);
    context.lineTo(operation.end.x - head * Math.cos(angle + Math.PI / 6), operation.end.y - head * Math.sin(angle + Math.PI / 6));
    context.stroke();
  }
  context.restore();
}

function canvasFile(canvas: HTMLCanvasElement, name: string) {
  return new Promise<File>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(new File([blob], name, { type: "image/jpeg", lastModified: Date.now() })) : reject(new Error("The marked photo could not be created.")), "image/jpeg", 0.9);
  });
}

function safeFilename(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "PHOTO";
}
