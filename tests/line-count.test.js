const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('actively maintained source files stay within the 600-line limit', () => {
  let output = '';
  try {
    output = execFileSync(process.execPath, ['scripts/check-line-count.js'], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    output = `${error.stdout || ''}${error.stderr || ''}`;
    assert.fail(`line-count check failed:\n${output}`);
  }
  assert.doesNotMatch(output, /\bFAIL\b/); // 项目无生成产物后不存在豁免文件，任何 FAIL 都不允许
});
