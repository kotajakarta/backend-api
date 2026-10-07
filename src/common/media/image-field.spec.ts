/**
 * Unit tests for image-field (base64 data URL -> MinIO object).
 *
 * Run with:
 *   npx tsx --test src/common/media/image-field.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDataUrl, applyImageFields, ImageStorage } from './image-field.js';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const PNG = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;
const JPG = `data:image/jpeg;base64,${Buffer.from('jpegbytes').toString('base64')}`;

function makeStorage(opts: { failUpload?: boolean } = {}) {
  const objects = new Map<string, { buffer: Buffer; mime?: string }>();
  const deleted: string[] = [];
  const storage: ImageStorage = {
    uploadBuffer: async (key, buffer, mime) => {
      if (opts.failUpload) throw new Error('minio down');
      objects.set(key, { buffer, mime });
      return { key, url: `/uploads/${key}` };
    },
    deleteObject: async key => {
      deleted.push(key);
      objects.delete(key);
    },
  };
  return { storage, objects, deleted };
}

describe('parseDataUrl', () => {
  it('decodes a base64 image data URL', () => {
    const parsed = parseDataUrl(PNG);
    assert.equal(parsed?.mime, 'image/png');
    assert.deepEqual(parsed?.buffer, PNG_BYTES);
  });

  it('returns null for anything that is not a base64 data URL', () => {
    for (const v of ['/uploads/staff/x.jpg', 'https://x/y.png', '', 'data:text/plain,hello']) {
      assert.equal(parseDataUrl(v), null, v);
    }
  });
});

describe('applyImageFields', () => {
  const fields = ['ktpUrl', 'ijazahUrl'] as const;

  it('uploads base64 values to MinIO under the record prefix and writes /uploads paths', async () => {
    const { storage, objects } = makeStorage();
    let written: any;
    await applyImageFields(storage, {
      input: { ktpUrl: PNG, ijazahUrl: JPG },
      current: {},
      keyPrefix: 'staff/s1',
      fields,
      emptyMeans: 'unchanged',
      write: async values => (written = values),
    });
    assert.match(written.ktpUrl, /^\/uploads\/staff\/s1\/ktp-url-[0-9a-f-]{36}\.png$/);
    assert.match(written.ijazahUrl, /^\/uploads\/staff\/s1\/ijazah-url-[0-9a-f-]{36}\.jpg$/);
    const ktpKey = written.ktpUrl.slice('/uploads/'.length);
    assert.deepEqual(objects.get(ktpKey)?.buffer, PNG_BYTES);
    assert.equal(objects.get(ktpKey)?.mime, 'image/png');
  });

  it("with emptyMeans='unchanged', undefined and '' leave the column alone", async () => {
    const { storage, deleted } = makeStorage();
    let written: any;
    await applyImageFields(storage, {
      input: { ktpUrl: '' },
      current: { ktpUrl: '/uploads/staff/s1/ktp-url-old.jpg' },
      keyPrefix: 'staff/s1',
      fields,
      emptyMeans: 'unchanged',
      write: async values => (written = values),
    });
    assert.equal(written.ktpUrl, undefined);
    assert.equal(written.ijazahUrl, undefined);
    assert.deepEqual(deleted, []);
  });

  it("with emptyMeans='clear', undefined and '' clear the column (cabang profile form semantics)", async () => {
    const { storage } = makeStorage();
    let written: any;
    await applyImageFields(storage, {
      input: { ktpUrl: '' },
      current: {},
      keyPrefix: 'cabang/c1',
      fields,
      emptyMeans: 'clear',
      write: async values => (written = values),
    });
    assert.equal(written.ktpUrl, null);
    assert.equal(written.ijazahUrl, null);
  });

  it('keeps an existing path as is and does not re-upload or delete it', async () => {
    const { storage, objects, deleted } = makeStorage();
    let written: any;
    await applyImageFields(storage, {
      input: { ktpUrl: '/uploads/staff/s1/ktp-url-old.jpg' },
      current: { ktpUrl: '/uploads/staff/s1/ktp-url-old.jpg' },
      keyPrefix: 'staff/s1',
      fields,
      emptyMeans: 'unchanged',
      write: async values => (written = values),
    });
    assert.equal(written.ktpUrl, '/uploads/staff/s1/ktp-url-old.jpg');
    assert.equal(objects.size, 0);
    assert.deepEqual(deleted, []);
  });

  it('deletes the replaced or removed object after a successful write', async () => {
    const { storage, deleted } = makeStorage();
    await applyImageFields(storage, {
      input: { ktpUrl: PNG, ijazahUrl: null },
      current: { ktpUrl: '/uploads/staff/s1/ktp-url-old.jpg', ijazahUrl: '/uploads/staff/s1/ijazah-url-old.jpg' },
      keyPrefix: 'staff/s1',
      fields,
      emptyMeans: 'unchanged',
      write: async () => ({}),
    });
    assert.deepEqual(deleted.sort(), ['staff/s1/ijazah-url-old.jpg', 'staff/s1/ktp-url-old.jpg']);
  });

  it('never deletes objects outside the record prefix (e.g. student documents or legacy base64)', async () => {
    const { storage, deleted } = makeStorage();
    await applyImageFields(storage, {
      input: { ktpUrl: null, ijazahUrl: null },
      current: { ktpUrl: '/uploads/biodata/xyz/kk.jpg', ijazahUrl: JPG },
      keyPrefix: 'staff/s1',
      fields,
      emptyMeans: 'unchanged',
      write: async () => ({}),
    });
    assert.deepEqual(deleted, []);
  });

  it('removes freshly uploaded objects and keeps the old ones when the write fails', async () => {
    const { storage, objects, deleted } = makeStorage();
    await assert.rejects(
      applyImageFields(storage, {
        input: { ktpUrl: PNG },
        current: { ktpUrl: '/uploads/staff/s1/ktp-url-old.jpg' },
        keyPrefix: 'staff/s1',
        fields,
        emptyMeans: 'unchanged',
        write: async () => {
          throw new Error('db down');
        },
      }),
      /db down/
    );
    assert.equal(objects.size, 0, 'uploaded object must be cleaned up');
    assert.ok(!deleted.includes('staff/s1/ktp-url-old.jpg'), 'old object must survive a failed write');
  });

  it("rejects a path that is not the record's stored value (cannot point at someone else's file)", async () => {
    const { storage } = makeStorage();
    let wrote = false;
    await assert.rejects(
      applyImageFields(storage, {
        input: { ktpUrl: '/uploads/biodata/other-student/kk.jpg' },
        current: { ktpUrl: '/uploads/staff/s1/ktp-url-old.jpg' },
        keyPrefix: 'staff/s1',
        fields,
        emptyMeans: 'unchanged',
        write: async () => { wrote = true; },
      }),
      /tidak valid/
    );
    assert.equal(wrote, false);
  });

  it('rejects a data URL that is not an image or PDF', async () => {
    const { storage } = makeStorage();
    await assert.rejects(
      applyImageFields(storage, {
        input: { ktpUrl: `data:text/html;base64,${Buffer.from('<script>').toString('base64')}` },
        current: {},
        keyPrefix: 'staff/s1',
        fields,
        emptyMeans: 'unchanged',
        write: async () => ({}),
      }),
      /tidak didukung/
    );
  });
});
