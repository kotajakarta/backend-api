/**
 * Run with:
 *   JWT_SECRET=x npx tsx --test src/modules/pemesanan-buku/pemesanan-buku.controller.spec.ts
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { PemesananBukuController, kirimBerkas } = await import('./pemesanan-buku.controller.js');

function fakeRes() {
  const headers: Record<string, string> = {};
  let body: Buffer | null = null;
  return {
    headers,
    get body() { return body; },
    setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; },
    end: (b: Buffer) => { body = b; },
  };
}

describe('kirimBerkas', () => {
  it('menyetel header aman dan mengirim buffer', () => {
    const res = fakeRes();
    kirimBerkas(res as any, new Uint8Array([1, 2, 3]), 'application/pdf', 'Bukti "x"/../a b.pdf', 'attachment');
    assert.equal(res.headers['content-type'], 'application/pdf');
    assert.equal(res.headers['content-length'], '3');
    assert.equal(res.headers['content-disposition'], 'attachment; filename="Bukti_x_.._a_b.pdf"');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.deepEqual([...res.body!], [1, 2, 3]);
  });
});

describe('PemesananBukuController', () => {
  it('meneruskan req.user dan query ke service', async () => {
    const calls: any[] = [];
    const service: any = new Proxy({}, { get: (_t, name) => async (...args: any[]) => (calls.push([name, ...args]), { buffer: new Uint8Array([1]), filename: 'f.pdf', mime: 'application/pdf' }) });
    const ctrl = new PemesananBukuController(service, {} as any);
    const req = { user: { id: 'u1', scope: 'CABANG', cabangId: 'c1' } };
    await ctrl.getCabang(req, 's1', undefined);
    await ctrl.submitCabang(req, { sesiId: 's1' });
    const res = fakeRes();
    await ctrl.pdfCabang(req, 's1', 'c9', res as any);
    assert.deepEqual(calls[0], ['getCabang', req.user, 's1', undefined]);
    assert.deepEqual(calls[1], ['submitCabang', req.user, 's1']);
    assert.deepEqual(calls[2], ['buktiCabangPdf', req.user, 's1', 'c9']);
    assert.equal(res.headers['content-disposition'], 'attachment; filename="f.pdf"');
  });
});

describe('UkuranBerkasFilter', () => {
  it('mengganti pesan multer "File too large" dengan pesan Indonesia', async () => {
    const { UkuranBerkasFilter } = await import('./pemesanan-buku.controller.js');
    const { PayloadTooLargeException } = await import('@nestjs/common');
    let status = 0;
    let body: any = null;
    const res = { status: (s: number) => ((status = s), { json: (b: any) => { body = b; } }) };
    const host: any = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ url: '/api/v1/pemesanan-buku/wilayah/ttd' }) }) };
    new UkuranBerkasFilter().catch(new PayloadTooLargeException('File too large'), host);
    assert.equal(status, 413);
    assert.equal(body.message, 'Ukuran berkas maksimal 10 MB.');
  });
});
