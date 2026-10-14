/** A reviewer-supplied URL is only linked when it is plain http(s): never javascript:. */
export function safeHttpUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}
