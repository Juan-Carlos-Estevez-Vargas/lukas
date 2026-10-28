import { DomainError } from "@lukas/domain";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Cuerpo de error según RFC 9457 (Problem Details for HTTP APIs). */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly code: string;
  readonly instance?: string;
  readonly requestId?: string;
  readonly errors?: readonly { path: string; message: string }[];
}

const TYPE_BASE = "https://lukas.app/problems/";

/** Error HTTP con un código estable que el cliente puede traducir. */
export class HttpProblem extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly title: string;
  readonly errors: ProblemDetails["errors"];

  constructor(
    status: ContentfulStatusCode,
    code: string,
    title: string,
    detail?: string,
    errors?: ProblemDetails["errors"],
  ) {
    super(detail ?? title);
    this.name = "HttpProblem";
    this.status = status;
    this.code = code;
    this.title = title;
    this.errors = errors;
  }
}

const toProblem = (
  error: unknown,
): { status: ContentfulStatusCode; body: Omit<ProblemDetails, "instance" | "requestId"> } => {
  if (error instanceof HttpProblem) {
    return {
      status: error.status,
      body: {
        type: `${TYPE_BASE}${error.code}`,
        title: error.title,
        status: error.status,
        code: error.code,
        ...(error.message !== error.title ? { detail: error.message } : {}),
        ...(error.errors ? { errors: error.errors } : {}),
      },
    };
  }
  if (error instanceof DomainError) {
    return {
      status: 422,
      body: {
        type: `${TYPE_BASE}${error.code}`,
        title: "La operación no cumple una regla de negocio",
        status: 422,
        code: error.code,
        detail: error.message,
      },
    };
  }
  // Nunca se exponen detalles internos de errores inesperados.
  return {
    status: 500,
    body: {
      type: `${TYPE_BASE}internal_error`,
      title: "Error interno",
      status: 500,
      code: "internal_error",
    },
  };
};

export const problemResponse = (c: Context, error: unknown): Response => {
  const { status, body } = toProblem(error);
  const requestId: unknown = c.get("requestId");
  return c.body(
    JSON.stringify({
      ...body,
      instance: new URL(c.req.url).pathname,
      ...(typeof requestId === "string" ? { requestId } : {}),
    }),
    status,
    { "Content-Type": "application/problem+json" },
  );
};

export const notFound = (c: Context): Response =>
  problemResponse(c, new HttpProblem(404, "not_found", "Recurso no encontrado"));
