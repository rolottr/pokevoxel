import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const text = (path: string) => readFileSync(resolve(root, path), 'utf8');
const siteUrl = 'https://pokevoxel.xyz/';
const imageUrl = `${siteUrl}assets/pokevoxel.jpg`;

describe('homepage SEO contract', () => {
  it('publishes one consistent canonical search and social identity', () => {
    const html = text('index.html');
    expect(html).toContain(`<link rel="canonical" href="${siteUrl}" />`);
    expect(html).toContain('<meta name="description"');
    expect(html).toContain('content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"');
    expect(html).toContain(`<meta property="og:url" content="${siteUrl}" />`);
    expect(html).toContain(`<meta property="og:image" content="${imageUrl}" />`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain(`<meta name="twitter:image" content="${imageUrl}" />`);
    expect(html).not.toContain('Validation, gameplay, and saves stay local on your device.');
  });

  it('ships valid VideoGame structured data using the same canonical URLs', () => {
    const html = text('index.html');
    const jsonLd = html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)?.[1];
    expect(jsonLd).toBeTruthy();
    expect(JSON.parse(jsonLd!)).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'VideoGame',
      name: 'Pokevoxel',
      url: siteUrl,
      image: imageUrl,
      gamePlatform: 'Web browser',
      isAccessibleForFree: true,
    });
  });

  it('exposes the supplied JPEG to crawlers and the README', () => {
    const imagePath = resolve(root, 'public/assets/pokevoxel.jpg');
    expect(existsSync(imagePath)).toBe(true);
    expect([...readFileSync(imagePath).subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(text('README.md')).toContain('](public/assets/pokevoxel.jpg)');
    expect(text('public/robots.txt')).toContain(`Sitemap: ${siteUrl}sitemap.xml`);
    expect(text('public/sitemap.xml')).toContain(`<loc>${siteUrl}</loc>`);
  });
});
