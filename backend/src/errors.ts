import type { Response } from 'express';

export type ErrorCode =
  | 'INVALID_BODY'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  INVALID_BODY: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INTERNAL: 500,
};

const MESSAGE: Record<ErrorCode, string> = {
  INVALID_BODY: 'invalid request body or query',
  UNAUTHORIZED: 'missing or invalid X-Admin-Token',
  NOT_FOUND: 'not found',
  INTERNAL: 'internal server error',
};

export function sendError(res: Response, code: ErrorCode, message?: string): void {
  res.status(STATUS[code]).json({ error: { code, message: message ?? MESSAGE[code] } });
}
