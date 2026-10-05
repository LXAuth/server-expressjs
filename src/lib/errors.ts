/**
 * The error envelope.
 *
 * Every error the API returns has the same shape, so a client parses one thing:
 *
 *   { "error": { "code": "member_not_found", "message": "...", "details": {} } }
 *
 * `code` is the stable contract and is safe to branch on. `message` is for
 * humans and may change. Internal failures never leak their cause — an
 * unexpected error becomes a generic 500 with a request id, and the real cause
 * goes to the log where it can be correlated by that id.
 */

export type ErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthorized'
  | 'invalid_credentials'
  | 'token_expired'
  | 'token_invalid'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'already_exists'
  | 'last_owner'
  | 'rate_limited'
  | 'payment_failed'
  | 'signature_unavailable'
  | 'internal_error';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  /** Set on 500s so the response and the log line can be tied together. */
  readonly requestId?: string;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    options?: { details?: unknown; requestId?: string },
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (options?.details !== undefined) this.details = options.details;
    if (options?.requestId !== undefined) this.requestId = options.requestId;
    Error.captureStackTrace?.(this, ApiError);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'bad_request', message, { details });

export const validationFailed = (details: unknown, message = 'Request validation failed.') =>
  new ApiError(422, 'validation_failed', message, { details });

export const unauthorized = (message = 'Authentication required.') =>
  new ApiError(401, 'unauthorized', message);

export const invalidCredentials = (message = 'Invalid email or password.') =>
  new ApiError(401, 'invalid_credentials', message);

export const tokenExpired = (message = 'Token has expired.') =>
  new ApiError(401, 'token_expired', message);

export const tokenInvalid = (message = 'Token is invalid.') =>
  new ApiError(401, 'token_invalid', message);

export const forbidden = (message = 'You do not have permission to perform this action.') =>
  new ApiError(403, 'forbidden', message);

export const notFound = (resource: string, id?: string | number) =>
  new ApiError(
    404,
    'not_found',
    id === undefined ? `${resource} not found.` : `${resource} ${id} not found.`,
    { details: { resource, ...(id === undefined ? {} : { id }) } },
  );

export const conflict = (message: string, details?: unknown) =>
  new ApiError(409, 'conflict', message, { details });

export const alreadyExists = (resource: string, details?: unknown) =>
  new ApiError(409, 'already_exists', `${resource} already exists.`, { details });

/**
 * Removing or demoting the only owner would leave an organization nobody can
 * administer. Distinct from a generic conflict because the fix is different:
 * promote someone else first.
 */
export const lastOwner = (message = 'An organization must always have exactly one owner.') =>
  new ApiError(409, 'last_owner', message);

export const rateLimited = (message = 'Too many requests.') =>
  new ApiError(429, 'rate_limited', message);

export const paymentFailed = (message = 'Payment could not be completed.') =>
  new ApiError(402, 'payment_failed', message);

/**
 * The build has no way to verify a signature — no secp256k1 recovery is
 * installed. 503 rather than 401 or 403, because the caller's signature may be
 * perfectly good and the server simply cannot check it. Reporting it as a
 * rejected signature would send someone hunting for a bug in their wallet.
 */
export const signatureUnavailable = (
  message = 'Signature verification is not available in this deployment.',
) => new ApiError(503, 'signature_unavailable', message);

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
