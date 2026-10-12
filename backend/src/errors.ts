import type { Response } from 'express';

export type ErrorCode =
  | 'INVALID_BODY'
  | 'INVALID_URL'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'RATE_LIMITED'
  | 'FETCH_FAILED'
  | 'CAPTCHA'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  INVALID_BODY: 400,
  INVALID_URL: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  RATE_LIMITED: 429,
  FETCH_FAILED: 502,
  CAPTCHA: 403,
  INTERNAL: 500,
};

const MESSAGE: Record<ErrorCode, string> = {
  INVALID_BODY: 'invalid request body or query',
  INVALID_URL: 'invalid tieba post URL',
  UNAUTHORIZED: 'missing or invalid X-Admin-Token',
  NOT_FOUND: 'not found',
  ALREADY_EXISTS: 'resource already exists',
  RATE_LIMITED: 'too many ingest requests',
  FETCH_FAILED: 'failed to fetch remote page',
  CAPTCHA: 'captcha or login wall detected',
  INTERNAL: 'internal server error',
};

export function sendError(
  res: Response,
  code: ErrorCode,
  message?: string,
  extra?: Record<string, unknown>,
): void {
  const body: Record<string, unknown> = {
    error: { code, message: message ?? MESSAGE[code] },
  };
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      body[k] = v;
    }
  }
  res.status(STATUS[code]).json(body);
}
