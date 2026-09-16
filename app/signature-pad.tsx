"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export function SignaturePad({ value, onChange, label = "Draw Signature" }: { value: string; onChange: (value: string) => void; label?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(Boolean(value));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = Math.max(320, Math.floor(canvas.getBoundingClientRect().width));
    const height = 150;
    const scale = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(scale, scale);
    context.lineWidth = 2.2;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#111111";
    if (value) {
      const image = new Image();
      image.onload = () => context.drawImage(image, 0, 0, width, height);
      image.src = value;
    }
  }, [value]);

  function point(event: ReactPointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function begin(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    const context = event.currentTarget.getContext("2d");
    const next = point(event);
    context?.beginPath();
    context?.moveTo(next.x, next.y);
  }

  function draw(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    event.preventDefault();
    const context = event.currentTarget.getContext("2d");
    const next = point(event);
    context?.lineTo(next.x, next.y);
    context?.stroke();
    setHasInk(true);
  }

  function finish(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    onChange(event.currentTarget.toDataURL("image/png"));
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    onChange("");
  }

  return <section className="signature-pad">
    <header><div><b>{label}</b><small>Use a finger, Apple Pencil, stylus, or mouse. Typed identity and consent are also required.</small></div><button type="button" onClick={clear} disabled={!hasInk}>Clear</button></header>
    <canvas ref={canvasRef} aria-label={`${label} drawing area`} onPointerDown={begin} onPointerMove={draw} onPointerUp={finish} onPointerCancel={finish} />
    <footer><span>Sign Above</span><i>{hasInk ? "SIGNATURE CAPTURED" : "REQUIRED"}</i></footer>
  </section>;
}
