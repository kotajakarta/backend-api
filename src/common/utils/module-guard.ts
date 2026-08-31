import * as fs from 'fs';
import * as path from 'path';
import { ForbiddenException } from '@nestjs/common';

/**
 * Memeriksa apakah fitur CCTV diaktifkan secara global melalui file .env (CCTV=true/false).
 * Mendukung variasi key: CCTV, cctv, ENABLE_CCTV, CCTV_ENABLED.
 */
export function isCctvEnabled(): boolean {
  const raw = process.env.CCTV ?? (process.env as any).cctv ?? process.env.ENABLE_CCTV ?? process.env.CCTV_ENABLED ?? 'true';
  const val = String(raw).trim().replace(/^["']|["']$/g, '').toLowerCase();
  if (val === 'false' || val === '0' || val === 'off' || val === 'no') {
    return false;
  }
  return true;
}

export function assertCctvEnabled(customMessage?: string) {
  if (!isCctvEnabled()) {
    throw new ForbiddenException(
      customMessage || 'Fitur CCTV sedang dinonaktifkan oleh konfigurasi sistem (.env).'
    );
  }
}

export function assertModuleEnabled(
  moduleKey: 'portalWalsanEnabled' | 'raporMuadalahEnabled' | 'cctvEnabled',
  customMessage?: string
) {
  if (moduleKey === 'cctvEnabled') {
    assertCctvEnabled(customMessage);
    return;
  }

  const filePath = path.join(process.cwd(), 'uploads', 'module-settings.json');
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const settings = JSON.parse(raw);
      if (settings && settings[moduleKey] === false) {
        throw new ForbiddenException(
          customMessage || `Modul ini (${moduleKey}) sedang dinonaktifkan oleh Administrator Pusat.`
        );
      }
    } catch (e: any) {
      if (e instanceof ForbiddenException) {
        throw e;
      }
    }
  }
}

