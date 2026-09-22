const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|curl|wget|lighthouse|pingdom|uptime/i;

export function isBotUserAgent(ua: string | null): boolean {
  return Boolean(ua && BOT_RE.test(ua));
}
