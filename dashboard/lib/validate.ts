/**
 * Tiny request-validation helpers. Throw ValidationError (→ HTTP 400) on bad
 * input so routes stay terse and never trust the client.
 */
export class ValidationError extends Error {}

const MAX_BODY_BYTES = 64 * 1024; // 64 KB — generous for our small JSON payloads

/** Parse a JSON body with a hard size cap. */
export async function readJson(req: Request): Promise<any> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new ValidationError("payload too large");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new ValidationError("invalid JSON");
  }
}

export function str(v: unknown, name: string, max = 4000): string {
  if (typeof v !== "string" || v.trim().length === 0) throw new ValidationError(`${name} is required`);
  if (v.length > max) throw new ValidationError(`${name} is too long`);
  return v;
}

/** A Sui object id / address: 0x + hex. */
export function suiId(v: unknown, name: string): string {
  const s = str(v, name, 80);
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(s)) throw new ValidationError(`${name} is not a valid Sui id`);
  return s;
}

export function hex(v: unknown, name: string, max = 4096): string {
  const s = str(v, name, max);
  if (!/^[0-9a-fA-F]+$/.test(s) || s.length % 2 !== 0) throw new ValidationError(`${name} is not valid hex`);
  return s;
}

export function num(v: unknown, name: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ValidationError(`${name} must be a number`);
  return n;
}

export function strArray(v: unknown, name: string, maxItems = 50, maxLen = 4000): string[] {
  if (!Array.isArray(v)) throw new ValidationError(`${name} must be an array`);
  if (v.length > maxItems) throw new ValidationError(`${name} has too many items`);
  return v.map((x, i) => str(x, `${name}[${i}]`, maxLen));
}
