import * as fs from 'fs';
import * as path from 'path';
import { ForbiddenException } from '@nestjs/common';

export function assertModuleEnabled(
  moduleKey: 'portalWalsanEnabled' | 'raporMuadalahEnabled',
  customMessage?: string
) {
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
