const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (!/src=|application\/ld\+json/i.test(match[1])) new vm.Script(match[2]);
}
new vm.Script(fs.readFileSync(path.join(__dirname, '../apps_script.gs'), 'utf8'));
test('perspective thumbnails, viewer, refresh and logout on desktop and mobile', async () => {
  const app = express(); app.use(express.static(path.join(__dirname, '..')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = []; const imageRequests = []; let requests = 0;
      page.on('pageerror', err => errors.push(err.message));
      await page.route('https://**/*', async route => {
        const url = route.request().url();
        if (url.includes('lh3.googleusercontent.com')) {
          imageRequests.push(url);
          return route.fulfill({ contentType: 'image/webp', body: fs.readFileSync(path.join(__dirname, '../assets/web/portfolio/p01-640.webp')) });
        }
        if (url.includes('chart.umd.js')) return route.fulfill({ contentType: 'text/javascript', body: 'window.Chart=class {destroy(){}};' });
        if (url.includes('datalabels')) return route.fulfill({ contentType: 'text/javascript', body: 'window.ChartDataLabels={};' });
        return route.fulfill({ body: '' });
      });
      await page.route('**/api/dados*', async route => {
        requests++;
        await new Promise(resolve => setTimeout(resolve, 100));
        return route.fulfill({ json: { config: { nome: 'Cliente de teste', area: 100, perspectivas: ['https://lh3.googleusercontent.com/d/testImage1','https://lh3.googleusercontent.com/d/testImage2','javascript:alert(1)'], projetos: [] }, categorias: [], totalGeral: 0, totalPrevisto: 0, cronograma: [], _cache: { updatedAt: Date.now(), stale: false } } });
      });
      await page.route('**/api/logout', route => route.fulfill({ json: { ok: true } }));
      await page.addInitScript(() => sessionStorage.setItem('fc_expires_at', String(Date.now() + 1800000)));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.locator('.nav-item[onclick*="clientes"]').click();
      await page.locator('.perspective-thumb').first().waitFor();
      assert.equal(await page.locator('.perspective-thumb').count(), 2);
      assert.equal(requests, 1, 'Restored session loads data on entry');
      const first = page.locator('.perspective-thumb').first();
      await first.scrollIntoViewIfNeeded();
      const box = await first.locator('img').boundingBox();
      assert.ok(Math.abs(box.width / box.height - 4 / 3) < 0.02, 'Thumbnails retain a compact 4:3 ratio');
      assert.equal(imageRequests.some(url => url.endsWith('=w1920')), false);
      await first.click();
      assert.equal(await page.locator('#pfLightbox').evaluate(el => el.classList.contains('open')), true);
      assert.match(await page.locator('#pfLightboxImg').getAttribute('src'), /testImage1=w1920$/);
      await page.keyboard.press('ArrowRight');
      assert.match(await page.locator('#pfLightboxImg').getAttribute('src'), /testImage2=w1920$/);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#pfLightbox').evaluate(el => el.classList.contains('open')), false);
      await page.evaluate(() => Promise.all([loadData(), loadData(), loadData()]));
      assert.equal(requests, 2, 'Concurrent browser loads are deduplicated');
      const refreshing = page.waitForRequest('**/api/dados?refresh=1');
      await page.locator('#btnRefresh').click(); await refreshing;
      await page.waitForFunction(() => !_dataRequest);
      assert.equal(await page.locator('#errorMsg').isVisible(), false);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, 'No horizontal overflow');
      await page.locator('.perspective-thumb').first().scrollIntoViewIfNeeded();
      const output = process.env.TEMP || process.env.TMP;
      if (output) await page.screenshot({ path: path.join(output, `studiofc-perspectives-${viewport.width}.png`) });
      await page.evaluate(() => { loadData(); fazerLogout(); });
      await page.waitForTimeout(200);
      assert.equal(await page.locator('#app').evaluate(el => el.classList.contains('active')), false);
      assert.equal(await page.locator('.perspective-thumb').count(), 0);
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
