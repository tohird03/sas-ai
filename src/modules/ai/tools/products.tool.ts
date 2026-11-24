import { ConfigService } from '@nestjs/config';

export type Column<T> = {
  title: string;
  value: (row: T, index: number) => string | number | null | undefined;
};

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

// Modelga tayyor markdown jadval beradi
export function toMarkdownTable<T>(columns: Column<T>[], rows: T[]): string {
  const head = '| ' + columns.map((c) => c.title).join(' | ') + ' |';
  const sep = '|' + columns.map(() => '---').join('|') + '|';
  const body = rows.map(
    (row, i) =>
      '| ' + columns.map((c) => esc(String(c.value(row, i) ?? '-'))).join(' | ') + ' |',
  );
  return [head, sep, ...body].join('\n');
}

export const fmt = (n: number | null | undefined) =>
  n == null || Number.isNaN(Number(n)) ? '-' : Number(n).toLocaleString('ru-RU');

export const getProductsDeclaration = {
  name: 'get_products',
  description:
    "ORDIX ombordagi mahsulotlarni qidiradi, filtrlaydi yoki reyting qilib beradi. " +
    "Mahsulot bor-yo'qligi, qoldig'i yoki narxi haqida savol bo'lsa shu funksiyani chaqir. " +
    "Maydonlar: price - 1 dona sotuv narxi, cost - 1 dona tannarx, count - ombordagi qoldiq (manfiy bo'lishi mumkin), " +
    "minAmount - minimal qoldiq, totalPrice = count * price, totalCost = count * cost. " +
    "Qoldiq bo'yicha filtr uchun maxCount/minCount ishlat (masalan, qoldig'i nol yoki kam: maxCount=0), " +
    "funksiya barcha mahsulotlarni tekshirib, mosini qaytaradi. " +
    "Reyting savollarida (eng qimmat, eng ko'p qolgan) sortBy va limit ishlat. " +
    "Filtr bilan hamma moslarini so'rashsa limit berma.",
  parameters: {
    type: 'object',
    properties: {
      search: {
        type: 'string',
        description: "Umumiy qidiruv matni (mahsulot nomining bir qismi bo'lishi mumkin)",
      },
      name: { type: 'string', description: "Mahsulot nomi bo'yicha filtr" },
      maxCount: {
        type: 'number',
        description: "Qoldiq shu sondan katta bo'lmagan mahsulotlar (count <= maxCount)",
      },
      minCount: {
        type: 'number',
        description: "Qoldiq shu sondan kam bo'lmagan mahsulotlar (count >= minCount)",
      },
      sortBy: {
        type: 'string',
        enum: ['price', 'cost', 'count', 'totalPrice', 'totalCost'],
        description: 'Saralash maydoni',
      },
      sortOrder: {
        type: 'string',
        enum: ['desc', 'asc'],
        description: "desc - kattadan kichikka (eng qimmat, eng ko'p), asc - kichikdan kattaga",
      },
      limit: {
        type: 'number',
        description:
          "Nechta mahsulot qaytarilsin (reyting uchun odatda 10). Hamma mosini so'rashsa bermang.",
      },
    },
  },
};

export interface GetProductsArgs {
  search?: string;
  name?: string;
  maxCount?: number;
  minCount?: number;
  sortBy?: 'price' | 'cost' | 'count' | 'totalPrice' | 'totalCost';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
}

const PAGE_SIZE = 50;
const MAX_SHOWN = 300; // modelga ko'pi bilan shuncha mahsulot beriladi
const LIST_PAGES = 3; // oddiy ro'yxat: ko'pi bilan 150 ta olinadi
const SCAN_PAGES = 100; // filtr/saralash: ko'pi bilan 5000 ta mahsulot ko'riladi
const BATCH = 10; // bir vaqtda nechta sahifa so'raladi

// Modelga faqat kerakli maydonlar ketadi (token tejash uchun)
const mapProduct = (p: any) => ({
  name: p.name,
  count: Number(p.count ?? 0),
  minAmount: p.minAmount,
  price: p.price,
  cost: p.cost,
  totalPrice: p.totalPrice,
  lastSellingDate: p.lastSellingDate,
});

type Mapped = ReturnType<typeof mapProduct>;

async function fetchPage(args: GetProductsArgs, pageNumber: number, config: ConfigService) {
  const url = new URL(config.getOrThrow<string>('PRODUCTS_API_URL'));
  const token = config.get<string>('PRODUCTS_API_TOKEN');

  if (args.name) url.searchParams.set('name', args.name);
  if (args.search) url.searchParams.set('search', args.search);
  url.searchParams.set('pageNumber', String(pageNumber));
  url.searchParams.set('pageSize', String(PAGE_SIZE));

  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Mahsulotlar API xatosi: ${res.status}`);
  }

  const json: any = await res.json();
  const page = json?.data ?? json;
  const items: any[] = Array.isArray(page?.data) ? page.data : Array.isArray(page) ? page : [];

  return { items, totalCount: page?.totalCount as number | undefined };
}

async function fetchAll(args: GetProductsArgs, maxPages: number, config: ConfigService) {
  const first = await fetchPage(args, 1, config);
  const total = first.totalCount ?? first.items.length;
  const pages = Math.min(Math.ceil(total / PAGE_SIZE), maxPages);

  const items = [...first.items];

  // Qolgan sahifalarni 10 tadan parallel olamiz
  for (let start = 2; start <= pages; start += BATCH) {
    const numbers = Array.from(
      { length: Math.min(BATCH, pages - start + 1) },
      (_, i) => start + i,
    );
    const chunk = await Promise.all(numbers.map((n) => fetchPage(args, n, config)));
    chunk.forEach((c) => items.push(...c.items));
  }

  return { items, total };
}

export async function runGetProducts(args: GetProductsArgs, config: ConfigService) {
  const sorting = !!args.sortBy;
  const filtering = args.maxCount !== undefined || args.minCount !== undefined;
  const scanAll = sorting || filtering;

  const { items, total } = await fetchAll(args, scanAll ? SCAN_PAGES : LIST_PAGES, config);
  const all: Mapped[] = items.map(mapProduct);

  const matched = all.filter(
    (p) =>
      (args.maxCount === undefined || p.count <= args.maxCount) &&
      (args.minCount === undefined || p.count >= args.minCount),
  );

  // Filtr bo'lsa va saralash aytilmagan bo'lsa, qoldiq bo'yicha o'sish tartibida beramiz
  const sortBy = args.sortBy ?? (filtering ? 'count' : undefined);
  if (sortBy) {
    const dir = args.sortOrder === 'desc' || (args.sortOrder === undefined && sorting) ? -1 : 1;
    matched.sort((a, b) => dir * (((a as any)[sortBy] ?? 0) - ((b as any)[sortBy] ?? 0)));
  }

  const defaultLimit = sorting && !filtering ? 10 : MAX_SHOWN;
  const limit = Math.min(Math.max(args.limit ?? defaultLimit, 1), MAX_SHOWN);
  const shown = matched.slice(0, limit);
  const fmt = (n: number | null | undefined) =>
    n == null || Number.isNaN(Number(n))
      ? '-'
      : Number(n).toLocaleString('ru-RU');

  const esc = (s: string) =>
    s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

  const table =
    '| № | Mahsulot | Qoldiq | Minimal qoldiq | Sotuv narxi | Tannarx | Jami sotuv qiymati |\n' +
    '|---|----------|--------|---------------|-------------|---------|--------------------|\n' +
    shown
      .map(
        (p, i) =>
          `| ${i + 1} | ${esc(p.name)} | ${fmt(p.count)} | ${fmt(p.minAmount)} | ${fmt(p.price)} | ${fmt(p.cost)} | ${fmt(p.totalPrice)} |`,
      )
      .join('\n');

  return {
    totalCount: total, // qidiruvga mos jami mahsulotlar soni
    scanned: all.length, // nechtasi tekshirildi
    complete: all.length >= total, // hammasi tekshirildimi
    matched: matched.length, // filtrga mos kelganlar soni
    shown: shown.length,
    truncated: matched.length > shown.length,
    table,
    products: shown,
  };
}
