import { chromium } from 'playwright';

const BASE = 'http://localhost:8080';
const SHOT = '/tmp/uishots';
const URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // Me at the zoo, 19s

const log = (...a) => console.log('[ui]', ...a);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 850 } });
const page = await ctx.newPage();
page.on('console', (m) => log('page.console:', m.text().slice(0, 120)));

try {
  // 1. 打开 → 登录页
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${SHOT}/1-login.png` });
  log('login page loaded, title=', await page.title());

  // 2. 登录
  await page.getByPlaceholder('用户名').fill('admin');
  await page.getByPlaceholder('密码').fill('test123');
  await page.getByRole('button', { name: '进入' }).click();

  // 3. 主页面
  await page.getByPlaceholder(/粘贴视频链接/).waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${SHOT}/2-home.png` });
  log('home page loaded');

  // 4. 校验
  await page.getByPlaceholder(/粘贴视频链接/).fill(URL);
  await page.getByRole('button', { name: '校验' }).click();
  await page.getByText(/支持/).waitFor({ timeout: 30000 });
  await page.screenshot({ path: `${SHOT}/3-validated.png` });
  const validateText = await page.locator('text=/支持/').first().innerText();
  log('validate result:', validateText.slice(0, 120));

  // 5. 提交
  const submit = page.getByRole('button', { name: '开始提取并上传' });
  await submit.click();
  log('submitted, watching progress...');

  // 6. 轮询进度直到完成/失败(最多 150s)
  let final = '';
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(5000);
    const done = await page.locator('text=/全部完成/').count();
    const failed = await page.locator('text=/任务失败/').count();
    // 抓当前阶段+百分比
    const bar = await page.locator('.max-w-2xl, body').first();
    if (i % 2 === 0) await page.screenshot({ path: `${SHOT}/4-progress-${i}.png` });
    if (done) { final = 'success'; break; }
    if (failed) { final = 'failed'; break; }
  }
  await page.screenshot({ path: `${SHOT}/5-final.png` });
  log('FINAL:', final || 'timeout');

  // 打印页面可见文本关键片段
  const body = await page.locator('body').innerText();
  const lines = body.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 40);
  log('visible text:\n' + lines.join('\n'));
  process.exitCode = final === 'success' ? 0 : 1;
} catch (e) {
  log('ERROR', e.message);
  await page.screenshot({ path: `${SHOT}/error.png` });
  process.exitCode = 2;
} finally {
  await browser.close();
}
