export type ApiRequest = {
  method?: string;
  headers: { authorization?: string; [name: string]: string | string[] | undefined };
  body?: Record<string, unknown>;
};

export type ApiResponse = {
  headersSent?: boolean;
  setHeader(name: string, value: string): unknown;
  status(code: number): ApiResponse;
  json(body: unknown): unknown;
  end(): unknown;
};

type Handler = (req: ApiRequest, res: ApiResponse) => unknown | Promise<unknown>;

export function postEndpoint(handler: Handler): Handler {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Allow', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    try { return await handler(req, res); } catch (error) {
      console.error('[SafeRoute API] Request failed', { errorType: error instanceof Error ? error.name : 'UnknownError' });
      if (!res.headersSent) return res.status(500).json({ error: 'The server could not complete this request. Check the Vercel function logs.' });
    }
  };
}
