import type { ApiError } from "@grocery/shared";
import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { type ErrorCode, FastifyHttpError } from "../errors";

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
};

export function errorPayload(code: ErrorCode, message: string): ApiError {
  return { error: { code, message } };
}

export function zodErrorPayload(error: ZodError): ApiError {
  const first = error.issues[0];
  const where = first && first.path.length > 0 ? first.path.join(".") : "body";
  const message = first ? `${where}: ${first.message}` : "Validation failed";
  return errorPayload("VALIDATION_ERROR", message);
}

/** Maps every error to the contract shape `{ error: { code, message } }` (docs/API.md). */
export function applyErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error instanceof FastifyHttpError) {
      return reply.status(error.status).send(errorPayload(error.code, error.message));
    }
    if (error instanceof ZodError) {
      return reply.status(400).send(zodErrorPayload(error));
    }
    if (error.validation) {
      return reply.status(400).send(errorPayload("VALIDATION_ERROR", error.message));
    }
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      app.log.error({ err: error }, "unhandled error");
      return reply.status(500).send(errorPayload("INTERNAL_ERROR", "Internal server error"));
    }
    const code = STATUS_TO_CODE[status] ?? "VALIDATION_ERROR";
    return reply.status(status).send(errorPayload(code, error.message));
  });

  app.setNotFoundHandler((request, reply) => {
    reply
      .status(404)
      .send(errorPayload("NOT_FOUND", `Route ${request.method} ${request.url} not found`));
  });
}
