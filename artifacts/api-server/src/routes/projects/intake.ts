import { type IntakeContext } from "./generation";

export function intakeFromSourceInput(
  metadata: Record<string, unknown> | null,
): IntakeContext {
  const m = metadata ?? {};
  const ctx: IntakeContext = {};
  if (typeof m.audience === "string") ctx.audience = m.audience;
  if (typeof m.offer === "string") ctx.offer = m.offer;
  if (typeof m.cta === "string") ctx.cta = m.cta;
  if (typeof m.tone === "string") ctx.tone = m.tone;
  if (Array.isArray(m.channels)) {
    ctx.channels = m.channels.filter((c): c is string => typeof c === "string");
  }
  if (typeof m.timestamps === "string") ctx.timestamps = m.timestamps;
  return ctx;
}
