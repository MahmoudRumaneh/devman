'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDirectory = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(publicDirectory, 'index.html'), 'utf8');

const LANDING_SLUGS = [
  'api-testing',
  'automated-api-testing',
  'openapi-testing',
  'swagger-testing',
  'postman-alternative',
  'curl-api-testing',
];

function htmlAttribute(tagPattern, attributeName) {
  const tag = html.match(tagPattern)?.[0] || '';
  return tag.match(new RegExp(`${attributeName}="([^"]+)"`))?.[1] || '';
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('homepage exposes complete indexable search metadata', () => {
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1] || '';
  const description = htmlAttribute(/<meta name="description"[^>]*>/, 'content');

  assert.equal(title, 'Devman API – Free Open Source REST API Testing Tool');
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
  assert.deepEqual(types, ['WebSite', 'WebPage', 'SoftwareApplication', 'ImageObject', 'Person', 'FAQPage']);
  assert.equal(structuredData['@graph'][0].url, 'https://devman-api.com/');
});

test('homepage contains visible, semantic API testing content', () => {
  assert.match(html, /<h2 id="seoHeroTitle">Test REST APIs and complete workflows/);
  assert.match(html, /Swagger and OpenAPI testing/);
  assert.match(html, /Postman and cURL import/);
  assert.match(html, /id="api-testing-faq"/);
});

test('API guide and FAQ uses an accessible hash-linked dialog', () => {
  assert.match(html, /id="apiInfoLink"[^>]+href="#api-testing-faq"[^>]+aria-haspopup="dialog"/);
  assert.match(html, /id="api-testing-faq" class="modal-backdrop api-info-backdrop" hidden/);
  assert.match(html, /class="modal api-info-modal" role="dialog" aria-modal="true"/);
  assert.match(html, /aria-labelledby="apiTestingGuideTitle"/);
  assert.match(html, /<details>\s*<summary>What is Devman API\?<\/summary>/);
  assert.match(html, /id="apiInfoClose"[^>]+aria-label="Close API guide and FAQ"/);
});

test('robots and sitemap expose only the canonical public website', () => {
  const robots = fs.readFileSync(path.join(publicDirectory, 'robots.txt'), 'utf8');
  const sitemap = fs.readFileSync(path.join(publicDirectory, 'sitemap.xml'), 'utf8');

  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.match(robots, /^User-agent: GPTBot$/m);
  assert.match(robots, /^User-agent: ClaudeBot$/m);
  assert.match(robots, /^Sitemap: https:\/\/devman-api\.com\/sitemap\.xml$/m);
  assert.match(sitemap, /<loc>https:\/\/devman-api\.com\/<\/loc>/);
  assert.equal((sitemap.match(/<url>/g) || []).length, 7);
  for (const slug of LANDING_SLUGS) {
    assert.match(sitemap, new RegExp(`<loc>https://devman-api\\.com/${slug}</loc>`));
  }
});

test('homepage publishes an llms.txt summary for AI assistants', () => {
  const llmsTxt = fs.readFileSync(path.join(publicDirectory, 'llms.txt'), 'utf8');

  assert.match(llmsTxt, /^# Devman API$/m);
  assert.match(llmsTxt, /MIT/);
  assert.match(llmsTxt, /https:\/\/github\.com\/MahmoudRumaneh\/devman/);
  for (const slug of LANDING_SLUGS) {
    assert.match(llmsTxt, new RegExp(`devman-api\\.com/${slug}`));
  }
});

test('each landing page has unique, indexable metadata and valid structured data', () => {
  const seenTitles = new Set();
  const seenFaqQuestions = new Set();

  for (const slug of LANDING_SLUGS) {
    const pageHtml = fs.readFileSync(path.join(publicDirectory, `${slug}.html`), 'utf8');
    const title = pageHtml.match(/<title>([^<]+)<\/title>/)?.[1] || '';
    const description = pageHtml.match(/<meta name="description" content="([^"]+)"/)?.[1] || '';
    const canonical = pageHtml.match(/<link rel="canonical" href="([^"]+)"/)?.[1] || '';

    assert.ok(title.length > 0, `${slug}: missing title`);
    assert.ok(!seenTitles.has(title), `${slug}: duplicate title "${title}"`);
    seenTitles.add(title);

    assert.ok(description.length >= 120 && description.length <= 170, `${slug}: description length ${description.length}`);
    assert.equal(canonical, `https://devman-api.com/${slug}`);
    assert.doesNotMatch(pageHtml, /<meta name="keywords"/i);

    const rawStructuredData = pageHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    assert.ok(rawStructuredData, `${slug}: missing JSON-LD`);
    const structuredData = JSON.parse(rawStructuredData);
    const types = structuredData['@graph'].map((item) => item['@type']);
    assert.deepEqual(types, ['WebPage', 'BreadcrumbList', 'FAQPage'], `${slug}: unexpected JSON-LD types`);

    const faq = structuredData['@graph'].find((item) => item['@type'] === 'FAQPage');
    for (const question of faq.mainEntity) {
      assert.ok(!seenFaqQuestions.has(question.name), `duplicate FAQ question across pages: "${question.name}"`);
      seenFaqQuestions.add(question.name);
      assert.match(pageHtml, new RegExp(escapeRegExp(question.name)), `${slug}: FAQPage question "${question.name}" not found in visible <details> text`);
    }
  }
});
