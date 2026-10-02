import { authorizeAdminRequest, authorizeCronRequest } from '../lib/cronAuth';

describe('authorizeCronRequest', () => {
  it('requires a configured secret', () => {
    const request = new Request('https://example.test/api/cron/daily');
    expect(authorizeCronRequest(request, undefined)).toBe('unconfigured');
    expect(authorizeCronRequest(request, '   ')).toBe('unconfigured');
  });

  it('accepts the matching Bearer token', () => {
    const request = new Request('https://example.test/api/cron/daily', {
      headers: { authorization: 'Bearer local-secret' },
    });
    expect(authorizeCronRequest(request, 'local-secret')).toBe('authorized');
  });

  it('rejects absent, malformed, or incorrect credentials', () => {
    expect(authorizeCronRequest(new Request('https://example.test'), 'local-secret')).toBe('unauthorized');
    const wrongScheme = new Request('https://example.test', {
      headers: { authorization: 'Basic local-secret' },
    });
    expect(authorizeCronRequest(wrongScheme, 'local-secret')).toBe('unauthorized');
    const wrongSecret = new Request('https://example.test', {
      headers: { authorization: 'Bearer another-secret' },
    });
    expect(authorizeCronRequest(wrongSecret, 'local-secret')).toBe('unauthorized');
  });
});

describe('authorizeAdminRequest', () => {
  function put(authorization?: string): Request {
    return new Request('https://example.test/api/settings', {
      method: 'PUT',
      headers: authorization === undefined ? {} : { authorization },
    });
  }

  it('refuses every save when ADMIN_SECRET is unset', () => {
    // Fails closed. An unconfigured deployment must not leave the route that sets
    // equity and risk percent open to anyone who can reach it.
    expect(authorizeAdminRequest(put('Bearer anything'), undefined)).toBe('unconfigured');
    expect(authorizeAdminRequest(put('Bearer anything'), '')).toBe('unconfigured');
    expect(authorizeAdminRequest(put('Bearer anything'), '  ')).toBe('unconfigured');
  });

  it('accepts the matching Bearer token', () => {
    expect(authorizeAdminRequest(put('Bearer admin-secret'), 'admin-secret')).toBe('authorized');
  });

  it('rejects absent, malformed, or incorrect credentials', () => {
    expect(authorizeAdminRequest(put(), 'admin-secret')).toBe('unauthorized');
    expect(authorizeAdminRequest(put('admin-secret'), 'admin-secret')).toBe('unauthorized');
    expect(authorizeAdminRequest(put('Basic admin-secret'), 'admin-secret')).toBe('unauthorized');
    expect(authorizeAdminRequest(put('Bearer Admin-Secret'), 'admin-secret')).toBe('unauthorized');
  });

  it('does not accept the cron secret, and cron does not accept the admin secret', () => {
    // The point of having two secrets. If either check fell back to the other,
    // the browser-handled token would also unlock the scheduled jobs.
    expect(authorizeAdminRequest(put('Bearer cron-secret'), 'admin-secret')).toBe('unauthorized');
    expect(authorizeCronRequest(put('Bearer admin-secret'), 'cron-secret')).toBe('unauthorized');
  });
});