const test = require('node:test');
const assert = require('node:assert/strict');
const {
  todayInBusinessZone, validMonth, validDate, previousMonth,
  moneyToKopecks, statusForClient,
} = require('../src/lib/billing');

const client = (opts = {}) => ({ kind: 'MONTHLY', startMonth: '2026-01', archivedFromMonth: null, pauses: [], payments: [], ...opts });

test('дата компании использует Красноярск, а не UTC/браузер', () => {
  assert.equal(todayInBusinessZone(new Date('2026-10-31T19:00:00.000Z')), '2026-11-01');
});
test('срок 1–5 число, просрочка с 6-го, и не через 30 дней', () => {
  assert.equal(statusForClient(client(), '2026-11', '2026-11-01').code, 'WAITING');
  assert.equal(statusForClient(client(), '2026-11', '2026-11-05').code, 'WAITING');
  assert.equal(statusForClient(client(), '2026-11', '2026-11-06').code, 'OVERDUE');
  assert.equal(statusForClient(client(), '2026-11', '2026-10-27').code, 'UPCOMING');
  assert.equal(statusForClient(client(), '2026-10', '2026-11-01').code, 'OVERDUE');
});
test('оплата 27 октября за ноябрь закрывает ноябрь, не декабрь', () => {
  const c = client({ payments: [{ periodMonth: '2026-11', receivedOn: '2026-10-27', amountKopecks: 800000 }] });
  assert.deepEqual(statusForClient(c, '2026-11', '2026-11-06'), { code: 'PAID', periodTotal: 800000 });
  assert.equal(statusForClient(c, '2026-12', '2026-12-06').code, 'OVERDUE');
});
test('два платежа одного месяца суммируются, а аннулированный игнорируется', () => {
  const c = client({ payments: [
    { periodMonth: '2026-11', amountKopecks: 700000 },
    { periodMonth: '2026-11', amountKopecks: 300000 },
    { periodMonth: '2026-11', amountKopecks: 123456, voidedAt: '2026-11-01' },
  ] });
  assert.equal(statusForClient(c, '2026-11', '2026-11-06').periodTotal, 1000000);
});
test('разовые заказы, пауза, архив и ещё не начавшиеся не считаются просроченными', () => {
  assert.equal(statusForClient(client({ kind: 'ONE_TIME' }), '2026-11', '2026-11-06').code, 'ONE_TIME');
  assert.equal(statusForClient(client({ pauses: [{ fromMonth: '2026-10', toMonth: '2026-11' }] }), '2026-11', '2026-11-06').code, 'PAUSED');
  assert.equal(statusForClient(client({ startMonth: '2026-12' }), '2026-11', '2026-11-06').code, 'NOT_STARTED');
  assert.equal(statusForClient(client({ archivedFromMonth: '2026-11' }), '2026-11', '2026-11-06').code, 'NOT_STARTED');
});
test('суммы сохраняются в копейках без ошибок округления, даты валидируются строго', () => {
  assert.equal(moneyToKopecks('7000'), 700000);
  assert.equal(moneyToKopecks('8000,25'), 800025);
  assert.equal(moneyToKopecks('0'), null);
  assert.equal(moneyToKopecks('-100'), null);
  assert.equal(moneyToKopecks('9.999'), null);
  assert.equal(validMonth('2026-11'), true);
  assert.equal(validMonth('2026-13'), false);
  assert.equal(validDate('2026-02-29'), false);
  assert.equal(validDate('2028-02-29'), true);
  assert.equal(previousMonth('2026-01'), '2025-12');
});
