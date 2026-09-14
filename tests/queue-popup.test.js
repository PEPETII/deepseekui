// popup 队列分区纯函数单测：进度行状态映射（无 DOM，无 chrome）
const test = require('node:test');
const assert = require('node:assert/strict');
const popup = require('../popup.js');

function snap(extra) {
  return { status: 'running', phase: 'stream', index: 0, total: 3, doneCount: 0, items: ['甲', '乙', '丙'], label: '', error: '', ...extra };
}

test('queueRowState：运行中把当前条标为 current，之前的标为 done，之后的待发', () => {
  const s = snap({ index: 1, doneCount: 1 });
  assert.equal(popup.queueRowState(s, 0), 'done');
  assert.equal(popup.queueRowState(s, 1), 'current');
  assert.equal(popup.queueRowState(s, 2), 'pending');
});

test('queueRowState：暂停时当前条显示为 paused 而不是 current', () => {
  const s = snap({ status: 'paused', index: 1 });
  assert.equal(popup.queueRowState(s, 1), 'paused');
  assert.equal(popup.queueRowState(s, 0), 'done');
});

test('queueRowState：完成态下所有条目都是 done', () => {
  const s = snap({ status: 'done', index: 2, doneCount: 3 });
  [0, 1, 2].forEach(i => assert.equal(popup.queueRowState(s, i), 'done'));
});

test('queueRowState：拿不到快照或脏数据时不抛异常且视为待发', () => {
  assert.equal(popup.queueRowState(null, 0), 'current');
  assert.equal(popup.queueRowState(undefined, 2), 'pending');
  assert.equal(popup.queueRowState({}, 0), 'current');
  assert.equal(popup.queueRowState({ status: 'weird', index: 1 }, 0), 'done');
  assert.equal(popup.queueRowState({ status: 'weird', index: 1 }, 5), 'pending');
});

test('queueMark：四种状态各有独立符号，未知状态回退为待发符号', () => {
  const marks = [
    popup.queueMark(snap({ index: 0 }), 0),
    popup.queueMark(snap({ index: 0 }), 1),
    popup.queueMark(snap({ status: 'paused', index: 0 }), 0),
    popup.queueMark(snap({ index: 0 }), 0),
  ];
  assert.deepEqual(marks, ['▸', '·', '‖', '▸']);
  assert.equal(popup.queueMark({ status: 'done', index: 0 }, 0), '✓');
  assert.equal(popup.queueMark(snap({ index: 9 }), 99), '·');
});
