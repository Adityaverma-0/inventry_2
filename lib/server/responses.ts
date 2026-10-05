import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "./security";

export function json(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export function errorResponse(error: unknown) {
  if (error instanceof ZodError)
    return json(
      {
        error: error.issues
          .map((i) => `${i.path.join(".") || "Input"}: ${i.message}`)
          .join("; "),
        code: "VALIDATION",
      },
      400,
    );
  const e = error as { status?: number; code?: string; message?: string };
  if (
    error instanceof HttpError ||
    (e.status && e.status >= 400 && e.status < 500)
  )
    return json({ error: e.message, code: e.code }, e.status);
  if (e.code === "23505")
    return json(
      {
        error:
          "That record already exists. Check the name, email or reference.",
        code: "DUPLICATE",
      },
      409,
    );
  if (["23514", "23503", "22P02", "22003", "23502"].includes(e.code || ""))
    return json(
      {
        error: "Check the entered quantities and linked records.",
        code: "INVALID_DATA",
      },
      400,
    );
  console.error("Request failed:", {
    code: e.code || "SERVER_ERROR",
    message: e.message,
  });
  return json(
    {
      error:
        "The request could not be completed. Your changes have not been confirmed. Retry with the same request.",
      code: "SERVER_ERROR",
    },
    503,
  );
}
