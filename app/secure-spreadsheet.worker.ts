/// <reference lib="webworker" />

import {
  parseSecureSpreadsheetBuffer,
  type SpreadsheetProfile,
} from "../lib/spreadsheet-security";

type ParseRequest = {
  requestId: string;
  profile: SpreadsheetProfile;
  buffer: ArrayBuffer;
  fileBytes: number;
};

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const requestId = typeof event.data?.requestId === "string" ? event.data.requestId : "unknown";
  try {
    const { profile, buffer, fileBytes } = event.data;
    const result = parseSecureSpreadsheetBuffer(buffer, profile, fileBytes);
    self.postMessage({ requestId, ok: true, result });
  } catch (error) {
    self.postMessage({
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : "The Excel Workbook Could Not Be Parsed Safely.",
    });
  }
};

export {};
