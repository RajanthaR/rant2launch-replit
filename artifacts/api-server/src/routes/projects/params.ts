import { z } from "zod";

export const SLUG_PARAM = z.object({ slug: z.string().min(1) });
export const TOKEN_PARAM = z.object({ token: z.string().min(1).max(200) });
