// 对话队列纯函数单测：文本解析 + 按钮语义 + 状态机推进（无 DOM，无 chrome）
const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../queue.js');

const T = Q.TUNING;

// 走一遍「发送 -> 回答中 -> 静默判定 -> 下一条」，返回事件序列产生的新状态
function drive(state, events) {
  let s = state;
  const effects = [];
  events.forEach((e) => {
    const r = Q.reduceQueue(s, e);
    s = r.state;
    effects.push(...r.effects);
  });
  return { state: s, effects };
}

test('parseQueueText：空输入与全空白不产生条目', () => {
  assert.deepEqual(Q.parseQueueText('').items, []);
  assert.deepEqual(Q.parseQueueText('   \n  \n ').items, []);
  assert.deepEqual(Q.parseQueueText(null).items, []);
  assert.deepEqual(Q.parseQueueText(undefined).items, []);
  assert.equal(Q.parseQueueText('').reason, '内容为空');
});

test('parseQueueText：一行一条，空行忽略', () => {
  const r = Q.parseQueueText('宇宙大爆炸是什么\n\n月球对地球有什么影响\n恐龙是怎么灭绝的\n');
  assert.deepEqual(r.items, ['宇宙大爆炸是什么', '月球对地球有什么影响', '恐龙是怎么灭绝的']);
  assert.equal(r.skipped, 0);
});

test('parseQueueText：所有行都带标记时才统一剥离行首编号', () => {
  const all = Q.parseQueueText('1. 甲问题\n2. 乙问题\n3. 丙问题');
  assert.deepEqual(all.items, ['甲问题', '乙问题', '丙问题']);
  const some = Q.parseQueueText('1. 甲问题\n普通问题');
  assert.deepEqual(some.items, ['1. 甲问题', '普通问题'], '混排时不做剥离，避免误伤正文');
  const cn = Q.parseQueueText('一、甲\n二、乙');
  assert.deepEqual(cn.items, ['甲', '乙']);
  const bullet = Q.parseQueueText('- 甲\n* 乙\n• 丙');
  assert.deepEqual(bullet.items, ['甲', '乙', '丙']);
});

test('parseQueueText：不误伤以数字开头的正文', () => {
  assert.deepEqual(Q.parseQueueText('1.5 倍增长算异常吗').items, ['1.5 倍增长算异常吗']);
  assert.equal(Q.hasMarker('1.5 倍增长算异常吗'), false);
});

test('parseQueueText：单行编号列表按编号切分', () => {
  const r = Q.parseQueueText('1. 请告诉我宇宙大爆炸的概念；2. 月球对地球包含什么影响？；3. 恐龙是怎么灭绝的？');
  assert.deepEqual(r.items, [
    '请告诉我宇宙大爆炸的概念',
    '月球对地球包含什么影响？',
    '恐龙是怎么灭绝的？',
  ]);
});

test('parseQueueText：单行只有一段编号时不切分（不满足连续递增）', () => {
  const r = Q.parseQueueText('1. 只有一个问题');
  assert.deepEqual(r.items, ['1. 只有一个问题']);
});

test('parseQueueText：条数上限截断并如实报数', () => {
  const lines = Array.from({ length: 25 }, (_, i) => `问题${i + 1}`);
  const r = Q.parseQueueText(lines.join('\n'));
  assert.equal(r.items.length, Q.QUEUE_MAX);
  assert.equal(r.overflow, 5);
  assert.equal(r.skipped, 5);
  assert.match(r.reason, /上限/);
});

test('parseQueueText：超长单条判为跳过而不是静默截断', () => {
  const long = 'x'.repeat(Q.ITEM_MAX + 1);
  const r = Q.parseQueueText(`${long}\n正常问题`);
  assert.deepEqual(r.items, ['正常问题']);
  assert.equal(r.tooLong, 1);
  assert.match(r.reason, /跳过/);
});

test('parseQueueText：CRLF 换行同样可用', () => {
  assert.deepEqual(Q.parseQueueText('甲\r\n乙\r\n').items, ['甲', '乙']);
});

test('classifyComposerButton：停止语义优先于发送，避免生成中误点打断', () => {
  assert.equal(Q.classifyComposerButton({ label: '停止生成', type: 'submit' }), 'stop');
  assert.equal(Q.classifyComposerButton({ label: 'Stop generating', type: 'submit' }), 'stop');
  assert.equal(Q.classifyComposerButton({ testid: 'stop-button', type: 'button' }), 'stop');
  assert.equal(Q.classifyComposerButton({ label: '发送', type: 'submit' }), 'send');
  assert.equal(Q.classifyComposerButton({ label: 'Send', type: 'button' }), 'send');
  assert.equal(Q.classifyComposerButton({ type: 'submit' }), 'send');
  assert.equal(Q.classifyComposerButton({ label: '上传附件', type: 'button' }), 'other');
  assert.equal(Q.classifyComposerButton({}), 'other');
  assert.equal(Q.classifyComposerButton(null), 'other');
});

test('isDisabled：disabled 与 aria-disabled 都算不可用', () => {
  assert.equal(Q.isDisabled({ disabled: true }), true);
  assert.equal(Q.isDisabled({ ariaDisabled: 'true' }), true);
  assert.equal(Q.isDisabled({ ariaDisabled: true }), true);
  assert.equal(Q.isDisabled({ disabled: false, ariaDisabled: 'false' }), false);
  assert.equal(Q.isDisabled(null), false);
});

test('reduceQueue：空队列启动不产生发送副作用', () => {
  const r = Q.reduceQueue(Q.initialQueueState([]), { type: 'START', now: 0 });
  assert.equal(r.state.status, Q.STATUS.IDLE);
  assert.deepEqual(r.effects, []);
});

test('reduceQueue：重复 START 不重复发送第一条', () => {
  const r = drive(Q.initialQueueState(['甲', '乙']), [
    { type: 'START', now: 0 },
    { type: 'START', now: 10 },
  ]);
  assert.deepEqual(r.effects.filter(e => e.type === 'send').length, 1);
});

test('reduceQueue：两条走完全程（发送 -> 回答 -> 静默 -> 间隔 -> 下一条 -> 完成）', () => {
  const r = drive(Q.initialQueueState(['甲', '乙']), [
    { type: 'START', now: 0 },
    { type: 'SENT', now: 0, turnCount: 1 },
    { type: 'SAMPLE', now: 600, hasStop: true, textLen: 10, turnCount: 2 },
    { type: 'SAMPLE', now: 1200, hasStop: true, textLen: 40, turnCount: 2 },
    { type: 'SAMPLE', now: 1800, hasStop: true, textLen: 40, turnCount: 2 },
    { type: 'SAMPLE', now: 2400, hasStop: false, textLen: 40, turnCount: 2 },
    { type: 'SAMPLE', now: 3000, hasStop: false, textLen: 40, turnCount: 2 },
    { type: 'SAMPLE', now: 4600, hasStop: false, textLen: 40, turnCount: 2 },
    { type: 'SENT', now: 4600, turnCount: 3 },
    { type: 'SAMPLE', now: 5200, hasStop: true, textLen: 5, turnCount: 4 },
    { type: 'SAMPLE', now: 5800, hasStop: true, textLen: 60, turnCount: 4 },
    { type: 'SAMPLE', now: 6400, hasStop: false, textLen: 60, turnCount: 4 },
    { type: 'SAMPLE', now: 7000, hasStop: false, textLen: 60, turnCount: 4 },
    { type: 'SAMPLE', now: 7600, hasStop: false, textLen: 60, turnCount: 4 },
  ]);
  assert.equal(r.state.status, Q.STATUS.DONE);
  assert.equal(r.state.doneCount, 2);
  assert.equal(r.state.index, 1, '结束时 index 停在最后一条');
  assert.deepEqual(r.effects.filter(e => e.type === 'send').length, 2);
  assert.match(r.effects.filter(e => e.type === 'toast').pop().text, /已完成 2 条/);
});

test('reduceQueue：答完后先等间隔再发下一条，间隔内不发送', () => {
  const first = drive(Q.initialQueueState(['甲', '乙']), [
    { type: 'START', now: 0 },
    { type: 'SENT', now: 0, turnCount: 1 },
    { type: 'SAMPLE', now: 600, hasStop: true, textLen: 10, turnCount: 2 },
    { type: 'SAMPLE', now: 1200, hasStop: true, textLen: 40, turnCount: 2 },
    { type: 'SAMPLE', now: 1800, hasStop: true, textLen: 40, turnCount: 2 },
    { type: 'SAMPLE', now: 2400, hasStop: false, textLen: 40, turnCount: 2 },
  ]);
  assert.equal(first.state.phase, 'gap');
  assert.equal(first.effects.filter(e => e.type === 'send').length, 1, '只有 START 那一次发送');
  const early = Q.reduceQueue(first.state, { type: 'SAMPLE', now: 2400 + T.gapMs - 100, hasStop: false, textLen: 0, turnCount: 2 });
  assert.equal(early.effects.length, 0, '间隔未到不发');
  const late = Q.reduceQueue(first.state, { type: 'SAMPLE', now: 2400 + T.gapMs, hasStop: false, textLen: 0, turnCount: 2 });
  assert.equal(late.effects.filter(e => e.type === 'send').length, 1);
  assert.equal(late.state.phase, 'send');
});

test('reduceQueue：观察到停止按钮时按短阈值判定，未观察到则用长阈值兜底', () => {
  const withStop = drive(Q.initialQueueState(['甲']), [
    { type: 'START', now: 0 },
    { type: 'SENT', now: 0, turnCount: 0 },
    { type: 'SAMPLE', now: 600, hasStop: true, textLen: 10, turnCount: 1 },
    { type: 'SAMPLE', now: 1200, hasStop: true, textLen: 40, turnCount: 1 },
    { type: 'SAMPLE', now: 1800, hasStop: true, textLen: 40, turnCount: 1 },
    { type: 'SAMPLE', now: 2400, hasStop: false, textLen: 40, turnCount: 1 },
  ]);
  assert.equal(withStop.state.status, Q.STATUS.DONE);

  const noStop = drive(Q.initialQueueState(['甲']), [
    { type: 'START', now: 0 },
    { type: 'SENT', now: 0, turnCount: 0 },
    { type: 'SAMPLE', now: 600, hasStop: false, textLen: 40, turnCount: 1 },
    { type: 'SAMPLE', now: 1200, hasStop: false, textLen: 40, turnCount: 1 },
    { type: 'SAMPLE', now: 1800, hasStop: false, textLen: 40, turnCount: 1 },
  ]);
  assert.equal(noStop.state.status, Q.STATUS.RUNNING, '没观察到停止按钮时不敢早判完成');
  const later = drive(noStop.state, [
    { type: 'SAMPLE', now: 2400, hasStop: false, textLen: 40, turnCount: 1 },
    { type: 'SAMPLE', now: 3000, hasStop: false, textLen: 40, turnCount: 1 },
    { type: 'SAMPLE', now: 3600, hasStop: false, textLen: 40, turnCount: 1 },
    { type: 'SAMPLE', now: 4200, hasStop: false, textLen: 40, turnCount: 1 },
    { type: 'SAMPLE', now: 4800, hasStop: false, textLen: 40, turnCount: 1 },
  ]);
  assert.equal(later.state.status, Q.STATUS.DONE, '静默足够久后仍会判定完成');
});

test('reduceQueue：hasStop 为真时永不判定完成', () => {
  const r = drive(Q.initialQueueState(['甲']), [
    { type: 'START', now: 0 },
    { type: 'SENT', now: 0, turnCount: 0 },
    { type: 'SAMPLE', now: 600, hasStop: true, textLen: 10, turnCount: 1 },
    { type: 'SAMPLE', now: 1200, hasStop: true, textLen: 10, turnCount: 1 },
    { type: 'SAMPLE', now: 1800, hasStop: true, textLen: 10, turnCount: 1 },
    { type: 'SAMPLE', now: 2400, hasStop: true, textLen: 10, turnCount: 1 },
  ]);
  assert.equal(r.state.status, Q.STATUS.RUNNING);
  assert.equal(r.state.phase, 'stream');
});

test('reduceQueue：no-start 判据成立时暂停，继续时允许重发同一条', () => {
  const r = drive(Q.initialQueueState(['甲', '乙']), [
    { type: 'START', now: 0 },
    { type: 'SENT', now: 0, turnCount: 1 },
    { type: 'SAMPLE', now: T.guardStartMs + 100, hasStop: false, textLen: 0, turnCount: 1 },
  ]);
  assert.equal(r.state.status, Q.STATUS.PAUSED);
  assert.equal(r.state.lastError, 'no-start');
  assert.equal(r.state.index, 0, '失败不推进条目');
  const resumed = Q.reduceQueue(r.state, { type: 'RESUME', now: T.guardStartMs + 200 });
  assert.equal(resumed.state.status, Q.STATUS.RUNNING);
  assert.equal(resumed.state.phase, 'send');
  assert.equal(resumed.effects.filter(e => e.type === 'send').length, 1);
});

test('reduceQueue：回答生成中暂停再继续不重发，只恢复守候', () => {
  const r = drive(Q.initialQueueState(['甲', '乙']), [
    { type: 'START', now: 0 },
    { type: 'SENT', now: 0, turnCount: 1 },
    { type: 'SAMPLE', now: 600, hasStop: true, textLen: 10, turnCount: 2 },
    { type: 'PAUSE', now: 700 },
  ]);
  assert.equal(r.state.status, Q.STATUS.PAUSED);
  assert.equal(r.state.phase, 'stream');
  const resumed = Q.reduceQueue(r.state, { type: 'RESUME', now: 5000 });
  assert.equal(resumed.state.status, Q.STATUS.RUNNING);
  assert.equal(resumed.state.phase, 'stream');
  assert.deepEqual(resumed.effects.filter(e => e.type === 'send'), [], '绝不重发已发出的条目');
});

test('reduceQueue：单条等待超过看门狗则暂停且不标记可重发', () => {
  const r = drive(Q.initialQueueState(['甲', '乙']), [
    { type: 'START', now: 0 },
    { type: 'SENT', now: 0, turnCount: 1 },
    { type: 'SAMPLE', now: 600, hasStop: true, textLen: 10, turnCount: 2 },
    { type: 'SAMPLE', now: 1200, hasStop: true, textLen: 20, turnCount: 2 },
    { type: 'SAMPLE', now: T.guardTotalMs + 1000, hasStop: true, textLen: 30, turnCount: 2 },
  ]);
  assert.equal(r.state.status, Q.STATUS.PAUSED);
  assert.equal(r.state.lastError, 'timeout');
  assert.equal(r.state.pendingResend, false);
});

test('reduceQueue：硬失败暂停后可继续（重发同一条）', () => {
  const r = drive(Q.initialQueueState(['甲']), [{ type: 'START', now: 0 }]);
  const failed = Q.reduceQueue(r.state, { type: 'FAIL', reason: 'draft', message: '输入框里有草稿' });
  assert.equal(failed.state.status, Q.STATUS.PAUSED);
  assert.equal(failed.state.pendingResend, true, 'phase=send 时属于「还没发出去」，继续即重发');
  assert.equal(failed.state.phase, 'send');
  const resumed = Q.reduceQueue(failed.state, { type: 'RESUME', now: 100 });
  assert.equal(resumed.effects.filter(e => e.type === 'send').length, 1);
});

test('reduceQueue：CLEAR 与 ABORT 幂等且清空条目', () => {
  const running = drive(Q.initialQueueState(['甲', '乙']), [
    { type: 'START', now: 0 },
    { type: 'SENT', now: 0, turnCount: 1 },
  ]).state;
  const cleared = Q.reduceQueue(running, { type: 'CLEAR' }).state;
  assert.equal(cleared.status, Q.STATUS.IDLE);
  assert.deepEqual(cleared.items, []);
  const aborted = Q.reduceQueue(cleared, { type: 'ABORT', reason: 'url-changed' }).state;
  assert.equal(aborted.status, Q.STATUS.IDLE);
  const again = Q.reduceQueue(aborted, { type: 'ABORT' }).state;
  assert.deepEqual(again.items, []);
});

test('reduceQueue：未知事件与缺省 now 不抛异常', () => {
  const s = Q.initialQueueState(['甲']);
  assert.doesNotThrow(() => Q.reduceQueue(s, { type: 'WHAT' }));
  assert.doesNotThrow(() => Q.reduceQueue(s, {}));
  assert.doesNotThrow(() => Q.reduceQueue(s, null));
  assert.doesNotThrow(() => Q.initialQueueState(null));
  assert.deepEqual(Q.initialQueueState(['', '  ', 5, null]).items, []);
});

test('queueStatusText：空 / 运行中 / 暂停 / 完成 四态文案', () => {
  assert.equal(Q.queueStatusText(Q.initialQueueState([])), '队列为空');
  const running = drive(Q.initialQueueState(['甲', '乙']), [
    { type: 'START', now: 0 },
    { type: 'SENT', now: 0, turnCount: 1 },
    { type: 'SAMPLE', now: 600, hasStop: true, textLen: 10, turnCount: 2 },
  ]).state;
  assert.equal(Q.queueStatusText(running), '第 1/2 条 · 回答生成中');
  const paused = Q.reduceQueue(running, { type: 'PAUSE', now: 900 }).state;
  assert.equal(Q.queueStatusText(paused), '已暂停 · 第 1/2 条');
  const done = { ...running, status: Q.STATUS.DONE };
  assert.equal(Q.queueStatusText(done), '已完成 2/2');
});

test('queueErrorText：常见失败原因有人话，未知原因不抛异常', () => {
  assert.match(Q.queueErrorText({ lastError: 'no-start' }), /没有回答/);
  assert.match(Q.queueErrorText({ lastError: 'draft' }), /草稿/);
  assert.match(Q.queueErrorText({ lastError: 'busy' }), /导出/);
  assert.equal(Q.queueErrorText({ lastError: '' }), '');
  assert.equal(Q.queueErrorText({}), '');
  assert.equal(Q.queueErrorText(null), '');
  assert.ok(Q.queueErrorText({ lastError: 'weird' }).length > 0);
});
