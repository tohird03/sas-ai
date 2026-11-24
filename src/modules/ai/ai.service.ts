import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { executeTool, toolDeclarations, toolStatusText } from './tools/tools.service.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'status'; text: string }
  | { type: 'done' };

  const SYSTEM_PROMPT = `Sen ORDIX ERP tizimining yordamchisisan.
  Foydalanuvchiga o'zbek tilida, qisqa va aniq javob ber.
  Mahsulot, ombor, qoldiq, narx, mijoz va qarz haqidagi savollarga faqat funksiyalardan olingan ma'lumot bilan javob ber, o'zingdan to'qima.
  Funksiya hech narsa topmasa, buni ochiq ayt.
  Mahsulotlar uchun get_products, mijozlar uchun get_clients ishlat.
  Mahsulot maydonlari: count - ombordagi qoldiq (manfiy bo'lishi mumkin), price - 1 dona sotuv narxi, cost - 1 dona tannarx, totalPrice - qoldiqning umumiy sotuv qiymati.
  Mijoz maydonlari: debt - qarz miqdori, lastSellingDate - oxirgi xarid sanasi (null bo'lsa hali xarid qilmagan).
  Ma'lumotda valyuta ko'rsatilmagan, shuning uchun summa yoniga o'zingdan valyuta yozma.
  Qoldiq bo'yicha so'ralsa maxCount/minCount, qarz bo'yicha so'ralsa debtType/debtValue filtrini ishlat. Hamma mosini so'rashsa limit berma.
  Funksiya qaytargan hamma elementni ber, birortasini tashlab ketma, o'zingdan "faqat N tasi tekshirildi" deb to'qima.
  Natijada table maydoni bo'lsa, uni o'zgartirmasdan, aynan shu holda markdown jadval qilib chiqar. Ro'yxat (1., 2., -) ko'rinishida yozma.
  Javob boshida nechta mos element topilganini ayt (mahsulotlarda matched, mijozlarda totalCount).
  truncated true bo'lsa, faqat shown tasi ko'rsatilayotganini ayt. complete false bo'lsa, jami totalCount tadan faqat scanned tasi tekshirilganini ayt.
  Jami qarz so'ralsa debtSum dan foydalan, lekin complete false bo'lsa uning to'liq emasligini ayt.
  Reyting savollarida (eng qimmat, eng ko'p qarzdor) sortBy va limit ishlat va truncated haqida gapirma.`;

const RETRY_STATUSES = [429, 500, 503];
const MAX_ATTEMPTS = 2;
const MAX_STEPS = 5;
const CONNECT_TIMEOUT_MS = 20000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class AiService {
  constructor(private readonly config: ConfigService) { }

  // Gemini'ga ulanish. Javob sarlavhalari kelguncha timeout ishlaydi, oqim boshlangach emas
  private async connect(model: string, contents: any[], clientSignal?: AbortSignal) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONNECT_TIMEOUT_MS);
    clientSignal?.addEventListener('abort', () => ctrl.abort(), { once: true });

    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.config.getOrThrow<string>('GEMINI_API_KEY'),
        },
        signal: ctrl.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          tools: [{ functionDeclarations: toolDeclarations }],
          generationConfig: {
            thinkingConfig: { thinkingLevel: 'low' },
          },
        }),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  // Qayta urinish va zaxira modelga o'tish (oqim boshlanishidan oldin)
  private async open(contents: any[], clientSignal?: AbortSignal): Promise<Response> {
    const primary = this.config.get<string>('MODEL') ?? 'gemini-3.5-flash-lite';
    const fallback = this.config.get<string>('FALLBACK_MODEL');
    const models = fallback && fallback !== primary ? [primary, fallback] : [primary];

    for (const model of models) {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (clientSignal?.aborted) throw new Error('aborted');
        const started = Date.now();
        let res: Response;

        try {
          res = await this.connect(model, contents, clientSignal);
        } catch (e: any) {
          console.warn(`[AI] ${model} javob bermadi (${e?.name}), urinish ${attempt + 1}/${MAX_ATTEMPTS}`);
          await sleep(1000);
          continue;
        }

        if (res.ok && res.body) {
          console.log(`[AI] ${model} oqim boshlandi: ${Date.now() - started}ms`);
          return res;
        }

        const detail = await res.text();
        if (!RETRY_STATUSES.includes(res.status)) {
          throw new BadGatewayException(`AI API xatosi ${res.status}: ${detail}`);
        }

        console.warn(`[AI] ${model} ${res.status}, urinish ${attempt + 1}/${MAX_ATTEMPTS}`);
        await sleep(1000 * (attempt + 1));
      }
    }

    throw new ServiceUnavailableException(
      "AI hozir band. Birozdan keyin qayta urinib ko'ring.",
    );
  }

  // Gemini SSE oqimini JSON bo'laklarga ajratadi
  private async *readChunks(res: Response): AsyncGenerator<any> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const parse = (block: string) => {
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('');
      return data && data !== '[DONE]' ? JSON.parse(data) : null;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');

      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const chunk = parse(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
        if (chunk) yield chunk;
      }
    }

    const rest = parse(buffer);
    if (rest) yield rest;
  }

  async *chatStream(
    messages: ChatMessage[],
    clientSignal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const contents: any[] = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    let gotText = false;

    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await this.open(contents, clientSignal);

      // Modelning barcha qismlarini o'zgarmagan holda yig'amiz (thought signature saqlanishi shart)
      const modelParts: any[] = [];
      const calls: any[] = [];

      for await (const chunk of this.readChunks(res)) {
        const parts: any[] = chunk.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          modelParts.push(part);

          if (part.functionCall) {
            calls.push(part);
          } else if (typeof part.text === 'string' && part.text && !part.thought) {
            gotText = true;
            yield { type: 'text', text: part.text };
          }
        }
      }

      // Funksiya chaqirilmagan bo'lsa, javob tugadi
      if (calls.length === 0) {
        if (!gotText) {
          yield { type: 'text', text: 'Javob olinmadi, qayta urinib ko‘ring.' };
        }
        yield { type: 'done' };
        return;
      }

      contents.push({ role: 'model', parts: modelParts });

      const responseParts: any[] = [];
      for (const part of calls) {
        const { name, args, id } = part.functionCall;
        console.log(`[AI] funksiya: ${name}`, JSON.stringify(args ?? {}));
        yield { type: 'status', text: toolStatusText[name] ?? 'Ma’lumot olinmoqda...' };

        let response: Record<string, unknown>;
        try {
          response = { result: await executeTool(name, args, this.config) };
        } catch (e: any) {
          console.warn(`[AI] funksiya xatosi: ${e?.message}`);
          response = { error: e?.message ?? 'Funksiya xatosi' };
        }

        responseParts.push({
          functionResponse: { ...(id ? { id } : {}), name, response },
        });
      }

      contents.push({ role: 'user', parts: responseParts });
    }

    yield {
      type: 'text',
      text: "Kechirasiz, so'rovni bajarib bo'lmadi. Savolni boshqacha yozib ko'ring.",
    };
    yield { type: 'done' };
  }

  // Oddiy (oqimsiz) variant: /ai/chat uchun
  async chat(messages: ChatMessage[]): Promise<string> {
    let text = '';
    for await (const event of this.chatStream(messages)) {
      if (event.type === 'text') text += event.text;
    }
    return text;
  }
}
