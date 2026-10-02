import { timingSafeEqual } from 'node:crypto';

/**
 * Bearer-token checks for the two kinds of privileged request.
 *
 * `unconfigured` is a distinct result from `unauthorized` on purpose: a missing
 * secret means the deployment cannot authorize anyone, which is a 503 the
 * operator needs to see, not a 401 that looks like a bad token. Either way the
 * request is refused — never authorize when no secret is set.
 */

export type CronAuthResult = 'authorized' | 'unauthorized' | 'unconfigured';

function authorizeBearer(request: Request, secret: string | undefined): CronAuthResult {
  if (secret === undefined || secret.trim() === '') return 'unconfigured';
  const authorization = request.headers.get('authorization') ?? '';
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(authorization);
  if (provided.length !== expected.length) return 'unauthorized';
  return timingSafeEqual(provided, expected) ? 'authorized' : 'unauthorized';
}

/** Scheduled jobs: /api/cron/daily and /api/cron/outcomes. */
export function authorizeCronRequest(
  request: Request,
  secret = process.env.CRON_SECRET,
): CronAuthResult {
  return authorizeBearer(request, secret);
}

/**
 * Operator writes: PUT /api/settings.
 *
 * A SEPARATE secret from CRON_SECRET, deliberately. This one is typed into a
 * browser form, so it is handled by a client and belongs in more places than the
 * server-to-server cron token; sharing one value would widen the cron token's
 * exposure every time someone saves a setting.
 */
export function authorizeAdminRequest(
  request: Request,
  secret = process.env.ADMIN_SECRET,
): CronAuthResult {
  return authorizeBearer(request, secret);
}
