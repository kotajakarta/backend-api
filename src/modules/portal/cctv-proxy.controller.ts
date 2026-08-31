import { Controller, Get, Query, Res, BadRequestException, ForbiddenException, Inject } from '@nestjs/common';
import { Response } from 'express';
import * as http from 'http';
import * as https from 'https';
import { decryptStreamUrl, encryptStreamUrl, isSafeStreamUrl } from '../../common/utils/cctv-crypto.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { assertCctvEnabled } from '../../common/utils/module-guard.js';

@Controller('cctv/stream-proxy')
export class CctvProxyController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Proxies HLS .m3u8 playlists.
   * Only accepts encrypted stream tokens — raw URLs are strictly rejected to prevent SSRF.
   * Rewrites all internal segment links to encrypted proxy endpoints.
   */
  @Get('playlist')
  async getPlaylist(
    @Query('token') token: string,
    @Res() res: Response
  ) {
    assertCctvEnabled();
    if (!token) {
      throw new BadRequestException('Token streaming CCTV wajib disertakan');
    }

    const targetUrl = decryptStreamUrl(token);
    if (!targetUrl) {
      throw new ForbiddenException('Token streaming CCTV tidak valid atau rusak');
    }

    // SSRF validation
    if (!isSafeStreamUrl(targetUrl)) {
      throw new ForbiddenException('Akses ke target stream ditolak oleh kebijakan keamanan (SSRF Protection)');
    }

    try {
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
        },
      });

      if (!response.ok) {
        return res.status(response.status).send('Stream CCTV tidak dapat dijangkau');
      }

      const contentType = response.headers.get('content-type') || 'application/vnd.apple.mpegurl';
      const m3u8Text = await response.text();

      // Base URL of the target stream (e.g., https://domain/play/hls/CT-01/)
      const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);

      // Rewrite every line in .m3u8 playlist to use encrypted tokens ONLY
      const lines = m3u8Text.split('\n');
      const rewrittenLines = lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          return line;
        }

        // Construct absolute target segment URL
        let segmentTarget = trimmed;
        if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
          segmentTarget = new URL(trimmed, baseUrl).toString();
        }

        if (!isSafeStreamUrl(segmentTarget)) {
          return ''; // Strip unsafe segment URLs
        }

        const encryptedSegmentToken = encryptStreamUrl(segmentTarget);

        // If it's a sub-playlist (.m3u8), proxy through playlist endpoint
        if (trimmed.includes('.m3u8')) {
          return `/api/v1/cctv/stream-proxy/playlist?token=${encodeURIComponent(encryptedSegmentToken)}`;
        }

        // Segment media chunk (.ts / .m4s / .mp4), proxy through segment endpoint
        return `/api/v1/cctv/stream-proxy/segment?token=${encodeURIComponent(encryptedSegmentToken)}`;
      });

      const rewrittenM3u8 = rewrittenLines.filter(Boolean).join('\n');

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.send(rewrittenM3u8);
    } catch (err: any) {
      console.error('Error proxying HLS playlist:', err);
      return res.status(502).send('Gateway Error proxying CCTV stream');
    }
  }

  /**
   * Streams raw video segment chunks (.ts / .m4s / mp4) directly to client.
   * Requires encrypted token containing the target URL.
   */
  @Get('segment')
  async getSegment(@Query('token') token: string, @Res() res: Response) {
    assertCctvEnabled();
    if (!token) {
      throw new BadRequestException('Token segment CCTV wajib disertakan');
    }

    const targetUrl = decryptStreamUrl(token);
    if (!targetUrl) {
      throw new ForbiddenException('Token segment CCTV tidak valid');
    }

    // SSRF validation
    if (!isSafeStreamUrl(targetUrl)) {
      throw new ForbiddenException('Akses ke target segment ditolak oleh kebijakan keamanan (SSRF Protection)');
    }

    try {
      const isHttps = targetUrl.startsWith('https');
      const clientReq = (isHttps ? https : http).get(
        targetUrl,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        },
        (targetRes) => {
          res.setHeader('Content-Type', targetRes.headers['content-type'] || 'video/MP2T');
          res.setHeader('Cache-Control', 'public, max-age=3600');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.status(targetRes.statusCode || 200);

          targetRes.pipe(res);
        }
      );

      clientReq.on('error', (e) => {
        console.error('Error piping segment chunk:', e);
        if (!res.headersSent) res.status(502).send('Error fetching segment');
      });
    } catch (e) {
      console.error('Segment proxy error:', e);
      if (!res.headersSent) res.status(500).send('Internal Segment Proxy Error');
    }
  }
}

