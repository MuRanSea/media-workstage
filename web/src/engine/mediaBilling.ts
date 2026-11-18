export interface MediaBilling { status?: string; amount?: string | null; currency?: string }

const labels: Record<string, string> = {
  reserved: '已预留，未结算', reconciling: '账务核对中', release_pending: '预留额度待释放',
  released: '预留额度已释放', settled: '已结算', refunded: '已退款（净额）',
};
export function billingLabel(value: MediaBilling): string {
  const status = labels[value.status ?? ''] ?? value.status ?? '未知';
  if (value.status === 'released') return `账务：${status}`;
  const amount = typeof value.amount === 'string' && value.amount !== '' ? ` · ${value.amount} ${value.currency || ''}` : ' · 金额未确认';
  return `账务：${status}${amount}`;
}
export function readBilling(raw?: string): MediaBilling | undefined {
  if (!raw) return;
  try {
    const value = JSON.parse(raw) as MediaBilling | null;
    if (typeof value?.status === 'string') return value;
  } catch { /* absent or older non-Media billing */ }
}

// Never persist provider-internal recovery blobs (Ark may carry the original image batch).
export function mergeBilling(previous?: string, raw?: string): string | undefined {
  if (!raw || raw.length > 16_384) return previous;
  const value = readBilling(raw);
  if (!value?.status || !Object.hasOwn(labels, value.status)) return previous;
  const prior = readBilling(previous)?.status;
  const pending = ['reserved', 'release_pending', 'reconciling'];
  if (prior && ((!pending.includes(prior) && pending.includes(value.status)) || (prior === 'refunded' && value.status !== prior))) return previous;
  return JSON.stringify({ status: value.status, amount: typeof value.amount === 'string' || value.amount === null ? value.amount : undefined, currency: typeof value.currency === 'string' ? value.currency : undefined });
}
