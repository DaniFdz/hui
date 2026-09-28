/** Compact process uptime; seconds matter only during the first minute. */
export function formatGatewayUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.floor(seconds);
  if (total < 60) return `${total}s`;
  const days = Math.floor(total / 86400);
  const hours = Math.floor(total / 3600) % 24;
  const minutes = Math.floor(total / 60) % 60;
  return [days && `${days}d`, hours && `${hours}h`, minutes && `${minutes}m`]
    .filter(Boolean).join(" ");
}
