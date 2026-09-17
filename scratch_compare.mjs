import fs from 'fs';
import { LjkOmrService } from './dist/modules/formal/ljk/ljk-omr.service.js';

async function run() {
  const omr = new LjkOmrService();
  const f1 = '/home/aithendi/.gemini/antigravity-ide/brain/0f130cb1-7754-44f8-922a-92dda850b952/.user_uploaded/media_1789641883239.jpg';
  const f2 = '/home/aithendi/.gemini/antigravity-ide/brain/0f130cb1-7754-44f8-922a-92dda850b952/.user_uploaded/media_1789641883251.jpg';

  console.log('=== TESTING IMAGE 1 ===');
  const res1 = await omr.processLjkImage(fs.readFileSync(f1));
  console.log('Result 1:', {
    allMarkersFound: res1.detectedMetrics?.allMarkersFound,
    corners: res1.detectedMetrics?.corners,
    kodeCabang: res1.kodeCabang,
    nisn: res1.nisn,
    confidence: res1.confidence,
    ambiguities: res1.ambiguities,
  });

  console.log('\n=== TESTING IMAGE 2 ===');
  const res2 = await omr.processLjkImage(fs.readFileSync(f2));
  console.log('Result 2:', {
    allMarkersFound: res2.detectedMetrics?.allMarkersFound,
    corners: res2.detectedMetrics?.corners,
    kodeCabang: res2.kodeCabang,
    nisn: res2.nisn,
    confidence: res2.confidence,
    ambiguities: res2.ambiguities,
  });
}

run().catch(console.error);
