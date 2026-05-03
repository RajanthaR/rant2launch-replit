// Keep `*.errorMessage` columns from blowing up rows when an upstream
// API echoes back a multi-MB stack trace (D7 audit finding). Used by
// both the legacy generation_runs path and the new generation_jobs
// worker so error persistence stays uniform across both tables.
export const MAX_ERROR_MESSAGE_LEN = 4000;

export function clampErrorMessage(msg: string): string {
  if (msg.length <= MAX_ERROR_MESSAGE_LEN) return msg;
  return msg.slice(0, MAX_ERROR_MESSAGE_LEN - 1) + "…";
}
