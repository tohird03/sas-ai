import { ConfigService } from '@nestjs/config';
import { getProductsDeclaration, runGetProducts } from './products.tool.js';
import { getClientsDeclaration, runGetClients } from './client.tool.js';

// Keyingi toollar faqat shu fayldagi uch joyga qo'shiladi
export const toolDeclarations = [getProductsDeclaration, getClientsDeclaration];

export const toolStatusText: Record<string, string> = {
  get_products: 'Mahsulotlar qidirilmoqda...',
  get_clients: 'Mijozlar qidirilmoqda...',
};

export async function executeTool(name: string, args: any, config: ConfigService) {
  switch (name) {
    case 'get_products':
      return runGetProducts(args ?? {}, config);
    case 'get_clients':
      return runGetClients(args ?? {}, config);
    default:
      throw new Error(`Noma'lum funksiya: ${name}`);
  }
}
