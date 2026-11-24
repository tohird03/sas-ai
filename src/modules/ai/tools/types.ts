// ===== API'dan keladigan xom javob =====

export interface IApiList<T> {
  data: T[];
  totalCount?: number;
  pageNumber?: number;
  pageSize?: number;
}

// Hamma ro'yxat javobi shu ko'rinishda: { data: { totalCount, pageNumber, pageSize, data: [...] } }
export interface IApiEnvelope<T> {
  data: IApiList<T>;
}

// Takrorlarni topish uchun id va nom maydonlari
export interface IHasId {
  id: string;
  name?: string;
  fullname?: string;
}

export interface IProductRaw {
  id: string;
  name: string;
  count: number;
  minAmount: number;
  cost: number;
  price: number;
  totalCost: number;
  totalPrice: number;
  createdAt: string;
  lastSellingDate: string | null;
}

export interface IClientRaw {
  id: string;
  fullname: string;
  telegram: string | null;
  actions: unknown[];
  createdAt: string;
  phone: string;
  debt: number;
  lastSellingDate: string | null;
}

// ===== Modelga beriladigan toza ma'lumot =====

export interface IProduct {
  name: string;
  count: number;
  minAmount: number;
  price: number;
  cost: number;
  totalPrice: number;
  totalCost: number;
  lastSellingDate: string | null;
}

export interface IClient {
  fullname: string;
  phone: string;
  telegram: string | null;
  debt: number;
  lastSellingDate: string | null;
  createdAt: string;
}

// ===== Umumiy =====

export type SortOrder = 'asc' | 'desc';
export type ProductSortKey = 'price' | 'cost' | 'count' | 'totalPrice' | 'totalCost';
export type ClientSortKey = 'debt' | 'lastSellingDate' | 'createdAt';

// Gemini'ga beriladigan funksiya e'loni
export interface IToolProperty {
  type: 'string' | 'number';
  description: string;
  enum?: string[];
}

export interface IToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, IToolProperty>;
  };
}
