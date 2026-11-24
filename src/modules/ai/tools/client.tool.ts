import { ConfigService } from '@nestjs/config';
import { fetchPages } from './paginate.js';

export const getClientsDeclaration = {
  name: 'get_clients',
  description:
    "ORDIX mijozlarini qidiradi, filtrlaydi yoki reyting qilib beradi. " +
    "Mijoz, uning telefoni, qarzi va oxirgi xaridi haqida savol bo'lsa shu funksiyani chaqir. " +
    "Funksiya barcha mijozlarni tekshirib, filtr va saralashni o'zi bajaradi. " +
    "Maydonlar: fullname - mijoz ismi, phone - telefon, " +
    "debt - qarz (musbat: mijoz bizga qarzdor, manfiy: biz mijozga qarzdormiz), " +
    "lastSellingDate - oxirgi sotuv sanasi (null bo'lsa hali xarid qilmagan), createdAt - qo'shilgan sana. " +
    "Qarz bo'yicha filtr uchun debtType (gt - katta, lt - kichik, eq - teng) va debtValue ishlat: " +
    "qarzdorlar uchun debtType=gt, debtValue=0; qarzi 40000 dan ko'p uchun debtType=gt, debtValue=40000; " +
    "qarzi yo'qlar uchun debtType=eq, debtValue=0. " +
    "Reyting savollarida (eng ko'p qarzdor, eng oxirgi xarid qilgan) sortBy va limit ishlat. " +
    "Foydalanuvchi son aytmasa va hamma mosini so'rasa limit berma. " +
    "startDate/endDate faqat foydalanuvchi sana oralig'ini aytganda ishlatiladi. " +
    "Natijadagi table maydonini o'zgartirmasdan chiqar." +
    "Ustunlar: №, Mijoz, Telefon, Qarz, Oxirgi xarid. " +
    "Pastida jami qarzni alohida qatorda yoz. " +
    "Bitta mijoz so'ralsa jadval shart emas, oddiy matn yetadi.",
  parameters: {
    type: 'object',
    properties: {
      search: {
        type: 'string',
        description: 'Umumiy qidiruv matni (ism yoki telefonning bir qismi)',
      },
      fullname: { type: 'string', description: "Ism bo'yicha filtr" },
      phone: { type: 'string', description: "Telefon bo'yicha filtr" },
      debtType: {
        type: 'string',
        enum: ['gt', 'lt', 'eq'],
        description: 'Qarz filtri turi: gt - katta, lt - kichik, eq - teng',
      },
      debtValue: { type: 'number', description: 'Qarz filtri uchun qiymat' },
      startDate: { type: 'string', description: 'Boshlanish sanasi, YYYY-MM-DD' },
      endDate: { type: 'string', description: 'Tugash sanasi, YYYY-MM-DD' },
      sortBy: {
        type: 'string',
        enum: ['debt', 'lastSellingDate', 'createdAt'],
        description: 'Saralash maydoni',
      },
      sortOrder: {
        type: 'string',
        enum: ['desc', 'asc'],
        description: 'desc - kattadan kichikka yoki yangidan eskiga, asc - teskarisi',
      },
      limit: {
        type: 'number',
        description:
          "Nechta mijoz qaytarilsin. Foydalanuvchi son aytsa shuni ber (masalan, 5 ta). " +
          "Aytmasa bermang, mos kelganlarning hammasi qaytadi (ko'pi bilan 300).",
      },
    },
  },
};

export interface GetClientsArgs {
  search?: string;
  fullname?: string;
  phone?: string;
  debtType?: 'gt' | 'lt' | 'eq';
  debtValue?: number;
  startDate?: string;
  endDate?: string;
  sortBy?: 'debt' | 'lastSellingDate' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
}

const MAX_SHOWN = 300; // modelga ko'pi bilan shuncha mijoz beriladi
const SCAN_PAGES = 100; // ko'pi bilan 5000 ta mijoz ko'riladi

const round = (n: number) => Math.round(n * 10000) / 10000;

const mapClient = (c: any) => ({
  fullname: String(c.fullname ?? '').trim(),
  phone: c.phone,
  telegram: c.telegram,
  debt: Number(c.debt ?? 0),
  lastSellingDate: c.lastSellingDate ?? null,
  createdAt: c.createdAt,
});

export async function runGetClients(args: GetClientsArgs, config: ConfigService) {
  // Qarz filtri serverga ketmaydi: barcha mijozlarni olib, o'zimiz filtrlaymiz
  const { items, total } = await fetchPages(
    config,
    'CLIENTS_API_URL',
    {
      search: args.search,
      fullname: args.fullname,
      phone: args.phone,
      startDate: args.startDate,
      endDate: args.endDate,
    },
    SCAN_PAGES,
  );


  const mapClient = (c: any) => ({
    id: c.id,
    fullname: String(c.fullname ?? '').trim(),
    phone: c.phone,
    telegram: c.telegram,
    debt: Number(c.debt ?? 0),
    lastSellingDate: c.lastSellingDate ?? null,
    createdAt: c.createdAt,
  });

  const all = items.map(mapClient);

  const complete = all.length >= total;

  const value = args.debtValue ?? 0;
  const matched = all.filter((c) => {
    if (!args.debtType) return true;
    if (args.debtType === 'gt') return c.debt > value;
    if (args.debtType === 'lt') return c.debt < value;
    return Math.abs(c.debt - value) < 0.0001;
  });

  // Saralash aytilmagan, lekin qarz filtri bor bo'lsa: eng kattasidan boshlaymiz
  const sortBy = args.sortBy ?? (args.debtType && args.debtType !== 'eq' ? 'debt' : undefined);

  if (sortBy) {
    const defaultOrder = !args.sortBy && args.debtType === 'lt' ? 'asc' : 'desc';
    const dir = (args.sortOrder ?? defaultOrder) === 'asc' ? 1 : -1;

    matched.sort((a, b) => {
      const x = a[sortBy];
      const y = b[sortBy];
      // qiymati yo'qlar (masalan, hali xarid qilmaganlar) doim oxirida
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const diff = typeof x === 'number' ? x - (y as number) : String(x).localeCompare(String(y));
      return dir * diff;
    });
  }

  const limit = Math.min(Math.max(args.limit ?? MAX_SHOWN, 1), MAX_SHOWN);
  const shown = matched.slice(0, limit);

  const owing = matched.filter((c) => c.debt > 0);
  const owed = matched.filter((c) => c.debt < 0);
  const fmt = (n: number) => n.toLocaleString('ru-RU');
  const esc = (s: string) => s.replace(/\|/g, '\\|');

  const table =
    '| № | Mijoz | Telefon | Qarz | Oxirgi xarid |\n' +
    '|---|-------|---------|------|--------------|\n' +
    shown
      .map(
        (c, i) =>
          `| ${i + 1} | ${esc(c.fullname)} | ${c.phone ?? '-'} | ${fmt(c.debt)} | ${c.lastSellingDate ? String(c.lastSellingDate).slice(0, 10) : '-'
          } |`,
      )
      .join('\n');

  return {
    totalCount: total, // qidiruvga mos jami mijozlar soni
    scanned: all.length, // nechtasi tekshirildi
    complete, // hammasi tekshirildimi
    matched: matched.length, // filtrga mos kelganlar soni
    shown: shown.length,
    truncated: matched.length > shown.length,
    // yig'indilar filtrga mos barcha mijozlar bo'yicha (ko'rsatilganlar bo'yicha emas)
    clientsOweUs: round(owing.reduce((sum, c) => sum + c.debt, 0)),
    clientsOweUsCount: owing.length,
    weOweClients: round(-owed.reduce((sum, c) => sum + c.debt, 0)),
    weOweClientsCount: owed.length,
    table,
    clients: shown,
  };
}
