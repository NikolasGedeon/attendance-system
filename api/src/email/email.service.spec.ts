import { Logger } from '@nestjs/common';
import { EmailService } from './email.service';

describe('EmailService (Microsoft Graph)', () => {
  const SECRET = 'super-secret-client-value';
  const RESET_TOKEN = 'raw-reset-token-abc123';
  const ACCESS_TOKEN = 'graph-access-token-xyz';

  let service: EmailService;
  let fetchMock: jest.Mock;
  let errorSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  const tokenResponse = (overrides: Partial<Response> = {}) =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: ACCESS_TOKEN, expires_in: 3600 }),
      text: async () => '',
      ...overrides,
    }) as unknown as Response;

  const sendResponse = (overrides: Partial<Response> = {}) =>
    ({
      ok: true,
      status: 202,
      json: async () => ({}),
      text: async () => '',
      ...overrides,
    }) as unknown as Response;

  beforeEach(() => {
    process.env.EMAIL_PROVIDER = 'graph';
    process.env.AZURE_TENANT_ID = 'tenant-123';
    process.env.AZURE_CLIENT_ID = 'client-456';
    process.env.AZURE_CLIENT_SECRET = SECRET;
    process.env.EMAIL_FROM = 'attendance@marfields.com';

    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    service = new EmailService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.EMAIL_PROVIDER;
    delete process.env.AZURE_TENANT_ID;
    delete process.env.AZURE_CLIENT_ID;
    delete process.env.AZURE_CLIENT_SECRET;
    delete process.env.EMAIL_FROM;
  });

  it('acquires a token with client credentials and correct form fields', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(sendResponse());

    await service.sendPasswordResetEmail('user@marfields.com', RESET_TOKEN, 15);

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe(
      'https://login.microsoftonline.com/tenant-123/oauth2/v2.0/token',
    );
    const body = (tokenInit.body as URLSearchParams).toString();
    expect(body).toContain('grant_type=client_credentials');
    expect(body).toContain(
      `scope=${encodeURIComponent('https://graph.microsoft.com/.default')}`,
    );
    expect(body).toContain('client_id=client-456');
  });

  it('caches the token: two sends, one token request', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(sendResponse())
      .mockResolvedValueOnce(sendResponse());

    await service.sendPasswordResetEmail('a@marfields.com', RESET_TOKEN, 15);
    await service.sendPasswordResetEmail('b@marfields.com', RESET_TOKEN, 15);

    const tokenCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('login.microsoftonline.com'),
    );
    const sendCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('graph.microsoft.com'),
    );
    expect(tokenCalls).toHaveLength(1);
    expect(sendCalls).toHaveLength(2);
  });

  it('sends via /users/{sender}/sendMail with the required payload', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(sendResponse());

    await service.sendPasswordResetEmail('user@marfields.com', RESET_TOKEN, 15);

    const [sendUrl, sendInit] = fetchMock.mock.calls[1];
    expect(sendUrl).toBe(
      'https://graph.microsoft.com/v1.0/users/attendance%40marfields.com/sendMail',
    );
    expect(sendInit.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);

    const payload = JSON.parse(sendInit.body as string);
    expect(payload.saveToSentItems).toBe(true);
    expect(payload.message.subject).toBe(
      'Reset your Attendance App password',
    );
    expect(payload.message.body.contentType).toBe('HTML');
    expect(payload.message.body.content).toContain(
      `reset-password?token=${RESET_TOKEN}`,
    );
    expect(payload.message.toRecipients[0].emailAddress.address).toBe(
      'user@marfields.com',
    );
  });

  it('rejects on Graph authentication failure with sanitized logging', async () => {
    fetchMock.mockResolvedValueOnce(
      tokenResponse({
        ok: false,
        status: 401,
        text: async () =>
          JSON.stringify({
            error: 'invalid_client',
            error_description: `secret ${SECRET} is wrong`,
          }),
      } as unknown as Partial<Response>),
    );

    await expect(
      service.sendPasswordResetEmail('user@marfields.com', RESET_TOKEN, 15),
    ).rejects.toThrow();

    const logged = errorSpy.mock.calls.flat().join(' ');
    expect(logged).toContain('Graph token request failed: HTTP 401');
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(RESET_TOKEN);
  });

  it('rejects on Graph send failure, logs only status + error code', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        sendResponse({
          ok: false,
          status: 403,
          text: async () =>
            JSON.stringify({
              error: {
                code: 'ErrorAccessDenied',
                message: 'Access to user@marfields.com is denied',
              },
            }),
        } as unknown as Partial<Response>),
      );

    await expect(
      service.sendPasswordResetEmail('user@marfields.com', RESET_TOKEN, 15),
    ).rejects.toThrow();

    const logged = errorSpy.mock.calls.flat().join(' ');
    expect(logged).toContain('HTTP 403');
    expect(logged).toContain('ErrorAccessDenied');
    expect(logged).not.toContain('user@marfields.com'); // no recipient
    expect(logged).not.toContain(ACCESS_TOKEN);
  });

  it('never logs the access token, secret, reset token or recipient on success', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(sendResponse());

    await service.sendPasswordResetEmail('user@marfields.com', RESET_TOKEN, 15);

    const allLogged = [...logSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .join(' ');
    expect(allLogged).not.toContain(SECRET);
    expect(allLogged).not.toContain(ACCESS_TOKEN);
    expect(allLogged).not.toContain(RESET_TOKEN);
    expect(allLogged).not.toContain('user@marfields.com');
  });
});
