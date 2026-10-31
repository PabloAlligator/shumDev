'use strict';

// Все календарные расчёты ShumDev ведутся по Красноярску (UTC+7).
const BUSINESS_TIME_ZONE = 'Asia/Krasnoyarsk';
const MONTH_RE = /^(20\d{2})-(0[1-9]|1[0-2])$/;
const DATE_RE = /^(20\d{2})-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;

function todayInBusinessZone(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function validMonth(value) {
  return typeof value === 'string' && MONTH_RE.test(value);
}

function validDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month && d.getUTCDate() === day;
}

function previousMonth(month) {
  if (!validMonth(month)) throw new Error('Некорректный месяц');
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function moneyToKopecks(value) {
  const text = String(value ?? '').trim();
  const match = /^(\d{1,8})(?:[.,](\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const amount = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return amount > 0 && Number.isSafeInteger(amount) && amount <= 2000000000 ? amount : null;
}

function isPausedInMonth(pauses, month) {
  return pauses.some((pause) => pause.fromMonth <= month && (!pause.toMonth || pause.toMonth >= month));
}

function statusForClient(client, month, today = todayInBusinessZone()) {
  const periodTotal = (client.payments || [])
    .filter((payment) => !payment.voidedAt && payment.periodMonth === month)
    .reduce((sum, payment) => sum + payment.amountKopecks, 0);
  if (periodTotal > 0) return { code: 'PAID', periodTotal };
  if (client.kind === 'ONE_TIME') return { code: 'ONE_TIME', periodTotal: 0 };
  if (client.startMonth > month || (client.archivedFromMonth && client.archivedFromMonth <= month))
    return { code: 'NOT_STARTED', periodTotal: 0 };
  if (isPausedInMonth(client.pauses || [], month)) return { code: 'PAUSED', periodTotal: 0 };
  if (month > today.slice(0, 7)) return { code: 'UPCOMING', periodTotal: 0 };
  if (month < today.slice(0, 7)) return { code: 'OVERDUE', periodTotal: 0 };
  return { code: Number(today.slice(-2)) > 5 ? 'OVERDUE' : 'WAITING', periodTotal: 0 };
}

module.exports = { todayInBusinessZone, validMonth, validDate, previousMonth, moneyToKopecks, isPausedInMonth, statusForClient };
