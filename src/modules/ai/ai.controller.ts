import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { AiService, ChatMessage } from './ai.service.js';

@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  private validate(body: { messages: ChatMessage[] }) {
    if (!Array.isArray(body?.messages) || body.messages.length === 0) {
      throw new BadRequestException('messages bo‘sh bo‘lmasligi kerak');
    }
    return body.messages.slice(-20);
  }

  @Post('chat')
  async chat(@Body() body: { messages: ChatMessage[] }) {
    const reply = await this.ai.chat(this.validate(body));
    return { data: { reply } };
  }

  @Post('stream')
  async stream(@Body() body: { messages: ChatMessage[] }, @Res() res: Response) {
    const messages = this.validate(body);

    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    // Foydalanuvchi sahifani yopsa yoki "To'xtatish" bossa, Gemini so'rovi ham to'xtaydi
    const ctrl = new AbortController();
    res.on('close', () => ctrl.abort());

    const send = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    try {
      for await (const event of this.ai.chatStream(messages, ctrl.signal)) {
        send(event);
      }
    } catch (e: any) {
      if (!ctrl.signal.aborted) {
        console.error('[AI] oqim xatosi:', e?.message);
        send({
          type: 'error',
          message:
            e instanceof ServiceUnavailableException
              ? e.message
              : 'Xatolik yuz berdi, qayta urinib ko‘ring.',
        });
      }
    } finally {
      res.end();
    }
  }
}
