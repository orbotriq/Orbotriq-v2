import "server-only";

import { z } from "zod";

export function isEditablePlanId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,39}$/.test(id) &&
    id !== "trial" &&
    id !== "demo" && id !== "create";
}

const allowances = {
  brandLimit: z.number().int().min(1).max(10000),
  geoLimit: z.number().int().min(0).max(1000000),
};

export const createPlanSchema = z.object({
  planId: z.string().refine(
    isEditablePlanId,
    "Invalid or reserved plan ID."
  ),
  ...allowances,
}).strict();

export const updatePlanSchema = z.object({
  ...allowances,
  version: z.string()
    .max(40)
    .regex(/^\d+:\d+$/),
}).strict();

export function validAllowance(
  value: unknown
): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : null;
}

export function failure(
  error: string,
  status = 400
) {
  return {
    ok: false as const,
    error,
    status,
  };
}
