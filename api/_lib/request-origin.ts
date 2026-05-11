import type { VercelRequest } from "@vercel/node";

const fallbackOrigin = "https://epsteiner.vercel.app";

const cleanOrigin = (value: string | undefined): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
};

const firstHeader = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const requestOrigin = (req: VercelRequest): string => {
  const host = firstHeader(req.headers.host);
  if (!host) return fallbackOrigin;
  const proto = firstHeader(req.headers["x-forwarded-proto"])?.split(",")[0]?.trim() || "https";
  return cleanOrigin(`${proto}://${host}`) || fallbackOrigin;
};

export const resolveAppOrigin = (req: VercelRequest, bodyOrigin?: string): string => {
  const configured = cleanOrigin(process.env.PUBLIC_APP_URL);
  if (configured) return configured;

  const fromRequest = requestOrigin(req);
  const candidate = cleanOrigin(bodyOrigin);
  if (!candidate) return fromRequest;

  return new URL(candidate).host === new URL(fromRequest).host ? candidate : fromRequest;
};
