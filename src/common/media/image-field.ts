import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

/**
 * Staff documents (KTP/ijazah/ifadah) and cabang photos used to be stored as
 * base64 data URLs inside Postgres (hundreds of KB per value). They now live
 * in MinIO; the column stores the `/uploads/<key>` path, served with auth by
 * the uploads handler in main.ts.
 *
 * Clients still send base64 from the upload forms: applyImageFields() uploads
 * those to MinIO at save time, so older browser tabs keep working unchanged.
 */

/** The subset of MinioService this module needs. */
export interface ImageStorage {
  uploadBuffer(key: string, buffer: Buffer, mimetype?: string): Promise<{ key: string; url: string }>;
  deleteObject(key: string): Promise<void>;
}

const DATA_URL = /^data:([\w.+-]+\/[\w.+-]+);base64,(.*)$/s;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

export function parseDataUrl(value: string): { mime: string; buffer: Buffer } | null {
  const m = DATA_URL.exec(value || '');
  if (!m) return null;
  return { mime: m[1].toLowerCase(), buffer: Buffer.from(m[2], 'base64') };
}

export function extensionForMime(mime: string): string | null {
  return EXTENSIONS[mime] ?? null;
}

/** 'ktpUrl' -> 'ktp-url', 'fotoRuangTidur' -> 'foto-ruang-tidur' */
export function fieldSlug(field: string): string {
  return field.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
}

/**
 * MinIO key of a stored value — only when it belongs to this record's prefix.
 * Anything else (legacy base64, other records, student documents) is never
 * treated as ours to delete.
 */
function ownedKey(value: unknown, keyPrefix: string): string | null {
  if (typeof value !== 'string') return null;
  const prefix = `/uploads/${keyPrefix}/`;
  return value.startsWith(prefix) ? value.slice('/uploads/'.length) : null;
}

/** Upload one data URL and return its MinIO key. */
export async function uploadDataUrl(storage: ImageStorage, dataUrl: string, keyPrefix: string, field: string): Promise<string> {
  const parsed = parseDataUrl(dataUrl);
  const ext = parsed ? extensionForMime(parsed.mime) : null;
  if (!parsed || !ext) {
    throw new BadRequestException(`Format berkas ${field} tidak didukung (hanya gambar JPG/PNG/WEBP/GIF atau PDF).`);
  }
  const key = `${keyPrefix}/${fieldSlug(field)}-${randomUUID()}.${ext}`;
  const res = await storage.uploadBuffer(key, parsed.buffer, parsed.mime);
  return res.key;
}

export type EmptyMeans = 'unchanged' | 'clear';

export interface ApplyImageFieldsOptions<F extends string, T> {
  /** Values sent by the client for these fields. */
  input: Partial<Record<F, string | null | undefined>>;
  /** Values currently stored (used to delete replaced objects). */
  current: Partial<Record<F, string | null | undefined>> | null;
  /** e.g. `staff/<id>` or `cabang/<id>` */
  keyPrefix: string;
  fields: readonly F[];
  /**
   * 'unchanged': undefined / '' keep the stored value, only null clears
   *   (guru form — old tabs send '' for documents they never loaded).
   * 'clear': undefined / '' / null all clear (cabang profile form always
   *   sends every photo it loaded).
   */
  emptyMeans: EmptyMeans;
  /** Persist the resolved column values (undefined = leave column untouched). */
  write: (values: Partial<Record<F, string | null | undefined>>) => Promise<T>;
}

/**
 * Resolve image fields for a save: upload new base64 values to MinIO, write
 * the row, then delete objects that were replaced or removed. If the write
 * fails, the freshly uploaded objects are removed and the old ones are kept.
 */
export async function applyImageFields<F extends string, T>(storage: ImageStorage, opts: ApplyImageFieldsOptions<F, T>): Promise<T> {
  const values: Partial<Record<F, string | null | undefined>> = {};
  const uploaded: string[] = [];
  const obsolete: string[] = [];

  try {
    for (const field of opts.fields) {
      const incoming = opts.input[field];
      const stored = opts.current?.[field];
      const empty = incoming === undefined || incoming === '';

      if (empty && opts.emptyMeans === 'unchanged') {
        values[field] = undefined;
        continue;
      }
      if (empty || incoming === null) {
        values[field] = null;
      } else if (incoming!.startsWith('data:')) {
        const key = await uploadDataUrl(storage, incoming!, opts.keyPrefix, field);
        uploaded.push(key);
        values[field] = `/uploads/${key}`;
      } else if (incoming === stored) {
        values[field] = incoming;
      } else {
        // New files always arrive as base64; a plain path is only accepted when
        // it is the value already stored (the form sending back what it loaded).
        throw new BadRequestException(`Nilai berkas ${field} tidak valid.`);
      }

      const oldKey = ownedKey(stored, opts.keyPrefix);
      if (oldKey && values[field] !== stored) obsolete.push(oldKey);
    }
  } catch (err) {
    await Promise.all(uploaded.map(k => storage.deleteObject(k).catch(() => {})));
    throw err;
  }

  let result: T;
  try {
    result = await opts.write(values);
  } catch (err) {
    await Promise.all(uploaded.map(k => storage.deleteObject(k).catch(() => {})));
    throw err;
  }

  await Promise.all(obsolete.map(k => storage.deleteObject(k).catch(() => {})));
  return result;
}
