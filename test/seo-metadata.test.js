'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDirectory = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(publicDirectory, 'index.html'), 'utf8');

function htmlAttribute(tagPattern, attributeName) {
  const tag = html.match(tagPattern)?.[0] || '';
  return tag.match(new RegExp(`${attributeName}="([^"]+)"`))?.[1] || '';
}

test('homepage exposes complete indexable search metadata', () => {
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1] || '';
  const description = htmlAttribute(/<meta name="description"[^>]*>/, 'content');

  assert.equal(title, 'Devman API: Free Online REST API Testing Tool');
  assert.ok(description.length >= 120 && description.length <= 170);
  assert.equal(htmlAttribute(/<link rel="canonical"[^>]*>/, 'href'), 'https://devman-api.com/');
  assert.match(htmlAttribute(/<meta name="robots"[^>]*>/, 'content'), /index, follow/);
  assert.equal(htmlAttribute(/<meta property="og:url"[^>]*>/, 'content'), 'https://devman-api.com/');
  assert.equal(htmlAttribute(/<meta property="og:image"[^>]*>/, 'content'), 'https://devman-api.com/devman-api-logo.png');
  assert.equal(htmlAttribute(/<meta name="twitter:card"[^>]*>/, 'content'), 'summary_large_image');
  assert.doesNotMatch(html, /<meta name="keywords"/i);
});

test('homepage structured data identifies the website, webpage, image, and creator', () => {
  const rawStructuredData = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(rawStructuredData, 'Homepage must include JSON-LD structured data');
  const structuredData = JSON.parse(rawStructuredData);
  const types = structuredData['@graph'].map((item) => item['@type']);

  assert.equal(structuredData['@context'], 'https://schema.org');
  assert.deepEqual(types, ['WebSite', 'WebPage', 'ImageObject', 'Person']);
  assert.equal(structuredData['@graph'][0].url, 'https://devman-api.com/');
});

test('homepage contains visible, semantic API testing content', () => {
  assert.match(html, /<h2 id="seoHeroTitle">Test REST APIs/);
  assert.match(html, /Swagger and OpenAPI testing/);
  assert.match(html, /Postman and cURL import/);
  assert.match(html, /id="api-testing-faq"/);
});

test('robots and sitemap expose only the canonical public website', () => {
  const robots = fs.readFileSync(path.join(publicDirectory, 'robots.txt'), 'utf8');
  const sitemap = fs.readFileSync(path.join(publicDirectory, 'sitemap.xml'), 'utf8');

  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.match(robots, /^Sitemap: https:\/\/devman-api\.com\/sitemap\.xml$/m);
  assert.match(sitemap, /<loc>https:\/\/devman-api\.com\/<\/loc>/);
  assert.equal((sitemap.match(/<url>/g) || []).length, 1);
});
