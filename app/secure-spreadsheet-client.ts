"use client";

import {
  SPREADSHEET_PARSE_TIMEOUT_MS,
  validateSecureSpreadsheetResult,
  validateSpreadsheetFileMetadata,
  type SecureSpreadsheetResult,
  type SpreadsheetProfile,
} from "../lib/spreadsheet-security";

type WorkerReply = {
  requestId?: string;
  ok?: boolean;
  result?: unknown;
  error?: string;
};

type SpreadsheetWorker = Pick<Worker, "postMessage" | "terminate"> & {
  onmessage: ((event: MessageEvent<WorkerReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
};

export async function parseSpreadsheetFile(
  file: File,
  profile: SpreadsheetProfile,
): Promise<SecureSpreadsheetResult> {
  validateSpreadsheetFileMetadata(file, profile);
  const buffer = await file.arrayBuffer();
  const worker = new Worker(new URL("./secure-spreadsheet.worker.ts", import.meta.url), {
    type: "module",
    name: "mefford-secure-spreadsheet-parser",
  });
  return parseSpreadsheetBufferWithWorker(worker, buffer, file.size, profile);
}

export function parseSpreadsheetBufferWithWorker(
  worker: SpreadsheetWorker,
  buffer: ArrayBuffer,
  fileBytes: number,
  profile: SpreadsheetProfile,
  timeoutMs = SPREADSHEET_PARSE_TIMEOUT_MS,
): Promise<SecureSpreadsheetResult> {
  const requestId = `${profile}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise<SecureSpreadsheetResult>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      worker.terminate();
      callback();
    };
    const timeout = globalThis.setTimeout(() => {
      finish(() => reject(new Error("The Excel Workbook Exceeded The 5 Second Safety Limit And Was Stopped.")));
    }, timeoutMs);

    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      if (!reply || reply.requestId !== requestId) {
        finish(() => reject(new Error("The Excel Parser Returned An Invalid Response.")));
        return;
      }
      if (!reply.ok) {
        finish(() => reject(new Error(reply.error || "The Excel Workbook Could Not Be Parsed Safely.")));
        return;
      }
      try {
        const result = validateSecureSpreadsheetResult(reply.result, profile);
        finish(() => resolve(result));
      } catch (error) {
        finish(() => reject(error));
      }
    };
    worker.onerror = () => {
      finish(() => reject(new Error("The Isolated Excel Parser Stopped Before Completing The Import.")));
    };
    worker.onmessageerror = () => {
      finish(() => reject(new Error("The Isolated Excel Parser Returned Unreadable Data.")));
    };

    worker.postMessage({ requestId, profile, buffer, fileBytes }, [buffer]);
  });
}
