import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    
    // Header X-API-KEY, Authorization: ApiKey <key> / Bearer <key>, or query param api_key
    const authHeader = request.headers['authorization'];
    const xApiKey = request.headers['x-api-key'] as string;
    const queryKey = request.query?.api_key as string;

    let providedKey = xApiKey || queryKey;
    if (!providedKey && authHeader) {
      if (authHeader.startsWith('ApiKey ') || authHeader.startsWith('Bearer ')) {
        providedKey = authHeader.split(' ')[1];
      } else {
        providedKey = authHeader;
      }
    }

    let validKey = (process.env.EXTERNAL_PESANTREN_API_KEY || '').trim();
    
    // Baca dinamis dari file .env agar perubahan key langsung aktif tanpa restart server
    try {
      const envPath = path.join(process.cwd(), '.env');
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(/^EXTERNAL_PESANTREN_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/m);
        if (match && match[1]) {
          validKey = match[1].trim();
        }
      }
    } catch (_) {
      // Abaikan error fs dan gunakan process.env
    }

    if (!validKey) {
      validKey = 'daimi_pesantren_key_2026_pusdatin';
    }

    if (!providedKey || providedKey.trim() !== validKey) {
      throw new UnauthorizedException(
        'Akses ditolak: API Key tidak valid atau tidak disertakan pada header X-API-KEY.'
      );
    }

    return true;
  }
}
