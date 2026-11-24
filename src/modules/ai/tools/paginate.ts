import { ConfigService } from '@nestjs/config';

const FETCH_SIZE = 5000; // bitta so'rovda olinadigan eng ko'p yozuv

type Params = Record<string, string | number | undefined>;

export async function fetchPages(
  config: ConfigService,
  urlKey: string,
  params: Params,
  _maxPages?: number, // eski chaqiruvlar buzilmasligi uchun qoldirildi
) {
  const url = new URL(config.getOrThrow<string>(urlKey));

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  url.searchParams.set('pageNumber', '1');
  url.searchParams.set('pageSize', String(FETCH_SIZE));

  const token = config.get<string>('PRODUCTS_API_TOKEN');
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    throw new Error(`API xatosi (${url.pathname}): ${res.status}`);
  }

  const json: any = await res.json();
  const page = json?.data ?? json;
  const items: any[] = Array.isArray(page?.data) ? page.data : Array.isArray(page) ? page : [];
  const total = (page?.totalCount as number | undefined) ?? items.length;

  const ids = items.map((c) => c?.id).filter((id) => id != null);
  if (new Set(ids).size !== ids.length) {
    console.warn(`[fetch] ${url.pathname}: javobning o'zida takror id lar bor`);
  }
  console.log(`[fetch] ${url.pathname}: ${items.length}/${total}`);

  return { items, total };
}
