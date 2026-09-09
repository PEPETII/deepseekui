const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../rich-model.js');

function oneBlock(text, marks = {}, kind = 'text') {
  return { blocks: [{ kind, runs: [{ text, marks }] }] };
}

test('bold toggles on and off for a non-empty selection', () => {
  const source = oneBlock('测试文本');
  const applied = model.toggleMark(source, 0, 4, 'bold');
  assert.equal(applied.changed, true);
  assert.deepEqual(applied.model.blocks[0].runs, [
    { text: '测试文本', marks: { bold: true } },
  ]);

  const removed = model.toggleMark(applied.model, 0, 4, 'bold');
  assert.equal(removed.changed, true);
  assert.deepEqual(removed.model.blocks[0].runs, [
    { text: '测试文本', marks: {} },
  ]);
});

test('partially bold selection applies bold to the complete selected range', () => {
  const source = {
    blocks: [{
      kind: 'text',
      runs: [
        { text: '前', marks: {} },
        { text: '中', marks: { bold: true } },
        { text: '后', marks: {} },
      ],
    }],
  };
  const result = model.toggleMark(source, 0, 3, 'bold');
  assert.equal(result.changed, true);
  assert.deepEqual(result.model.blocks[0].runs, [
    { text: '前中后', marks: { bold: true } },
  ]);

  const second = model.toggleMark(result.model, 1, 2, 'bold');
  assert.deepEqual(second.model.blocks[0].runs, [
    { text: '前', marks: { bold: true } },
    { text: '中', marks: {} },
    { text: '后', marks: { bold: true } },
  ]);
});

test('selection can cross block boundaries without losing the newline offset', () => {
  const source = {
    blocks: [
      { kind: 'text', runs: [{ text: '第一行', marks: {} }] },
      { kind: 'text', runs: [{ text: '第二行', marks: {} }] },
    ],
  };
  const result = model.toggleMark(source, 2, 6, 'bold');
  assert.deepEqual(result.model.blocks.map((block) => block.runs), [
    [{ text: '第一', marks: {} }, { text: '行', marks: { bold: true } }],
    [{ text: '第二', marks: { bold: true } }, { text: '行', marks: {} }],
  ]);
  assert.equal(model.modelTextLength(result.model), 7);
});

test('collapsed selection changes the typing mark without changing document text', () => {
  const source = oneBlock('abc');
  const result = model.toggleMark(source, 3, 3, 'bold');
  assert.equal(result.changed, false);
  assert.equal(result.typingMark, true);
  assert.deepEqual(result.model, model.normalizeModel(source));
});

test('bold composes with italic and does not change code runs', () => {
  const source = {
    blocks: [{
      kind: 'text',
      runs: [
        { text: '代码', marks: { code: true } },
        { text: '普通', marks: { italic: true } },
      ],
    }],
  };
  const result = model.toggleMark(source, 0, 4, 'bold');
  assert.equal(result.changed, true);
  assert.deepEqual(result.model.blocks[0].runs, [
    { text: '代码', marks: { code: true } },
    { text: '普通', marks: { bold: true, italic: true } },
  ]);
});

test('markdown round-trip keeps nested inline marks', () => {
  const source = '**粗体 *斜体***';
  const parsed = model.parseMarkdown(source);
  assert.deepEqual(parsed.blocks[0].runs, [
    { text: '粗体 ', marks: { bold: true } },
    { text: '斜体', marks: { bold: true, italic: true } },
  ]);
  assert.deepEqual(model.parseMarkdown(model.serializeMarkdown(parsed)), parsed);

  const italicOuter = model.parseMarkdown('*斜体 **粗体***');
  assert.deepEqual(italicOuter.blocks[0].runs, [
    { text: '斜体 ', marks: { italic: true } },
    { text: '粗体', marks: { bold: true, italic: true } },
  ]);
  assert.deepEqual(model.parseMarkdown(model.serializeMarkdown(italicOuter)), italicOuter);
});

test('code-only selection and an all-text block toggle are safe no-ops', () => {
  const code = oneBlock('代码', { code: true });
  const codeResult = model.toggleMark(code, 0, 2, 'bold');
  assert.equal(codeResult.changed, false);
  assert.deepEqual(codeResult.model, model.normalizeModel(code));

  const text = oneBlock('文本');
  const blockResult = model.toggleBlock(text, 0, 2, 'text');
  assert.equal(blockResult.changed, false);
  assert.deepEqual(blockResult.model, model.normalizeModel(text));
});

test('block toggle changes block kind while preserving selected offsets', () => {
  const source = {
    blocks: [
      { kind: 'text', runs: [{ text: '一', marks: {} }] },
      { kind: 'text', runs: [{ text: '二', marks: {} }] },
    ],
  };
  const result = model.toggleBlock(source, 0, 3, 'h2');
  assert.equal(result.selectionStart, 0);
  assert.equal(result.selectionEnd, 3);
  assert.deepEqual(result.model.blocks.map((block) => block.kind), ['h2', 'h2']);
});
