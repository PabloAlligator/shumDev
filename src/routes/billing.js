'use strict';

const express = require('express');
const prisma = require('../lib/prisma');
const { requireRoles } = require('../middleware/auth');
const { normalizeText, parsePositiveInt } = require('../lib/security');
const { recordActivity } = require('../lib/activity');
const { todayInBusinessZone, validMonth, validDate, previousMonth, moneyToKopecks, statusForClient } = require('../lib/billing');

const router = express.Router();
router.use(requireRoles('OWNER'));
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
const clientId = (raw) => parsePositiveInt(raw) || fail('Некорректный ID клиента');
const paymentId = (raw) => parsePositiveInt(raw) || fail('Некорректный ID платежа');
const monthFrom = (value) => validMonth(value) ? value : fail('Месяц должен иметь формат ГГГГ-ММ');

function clientData(body, isNew = false) {
  const name = normalizeText(body.name, 150);
  if (!name) fail('Укажите имя клиента или название компании');
  const kind = body.kind;
  if (!['MONTHLY', 'ONE_TIME'].includes(kind)) fail('Некорректный тип клиента');
  return {
    name,
    kind,
    startMonth: monthFrom(body.startMonth || (isNew ? todayInBusinessZone().slice(0, 7) : '')),
    projectName: normalizeText(body.projectName, 200) || null,
    note: normalizeText(body.note, 1000) || null,
  };
}

function paymentData(body) {
  const amountKopecks = moneyToKopecks(body.amount);
  if (!amountKopecks) fail('Укажите положительную сумму до 20 млн ₽ (не более двух знаков после запятой)');
  const receivedOn = body.receivedOn;
  if (!validDate(receivedOn) || receivedOn > todayInBusinessZone()) fail('Укажите существующую дату фактического поступления, не позже сегодняшней');
  return {
    periodMonth: monthFrom(body.periodMonth),
    receivedOn,
    amountKopecks,
    note: normalizeText(body.note, 500) || null,
  };
}

async function requiredClient(id) {
  const client = await prisma.billingClient.findUnique({ where: { id } });
  if (!client) fail('Клиент не найден', 404);
  return client;
}
async function requiredPayment(id) {
  const payment = await prisma.billingPayment.findUnique({ where: { id } });
  if (!payment || payment.voidedAt) fail('Платёж не найден', 404);
  return payment;
}

router.get('/', wrap(async (req, res) => {
  const today = todayInBusinessZone();
  const month = monthFrom(req.query.month || today.slice(0, 7));
  const [clients, receipts] = await Promise.all([
    prisma.billingClient.findMany({
      include: {
        pauses: { orderBy: { fromMonth: 'asc' } },
        payments: { where: { periodMonth: month, voidedAt: null }, orderBy: { receivedOn: 'desc' } },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
    prisma.billingPayment.findMany({
      where: { receivedOn: { gte: `${month}-01`, lte: `${month}-31` }, voidedAt: null },
      select: { id: true, amountKopecks: true, receivedOn: true, periodMonth: true, client: { select: { name: true } } },
      orderBy: [{ receivedOn: 'desc' }, { id: 'desc' }],
    }),
  ]);
  const enriched = clients.map((client) => ({
    ...client,
    status: statusForClient(client, month, today),
  }));
  const active = enriched.filter((client) => !client.archivedFromMonth || client.archivedFromMonth > month);
  res.json({
    success: true, month, today,
    metrics: {
      receivedKopecks: receipts.reduce((sum, payment) => sum + payment.amountKopecks, 0),
      totalClients: active.length,
      paidCount: active.filter((client) => client.status.code === 'PAID').length,
      unpaidCount: active.filter((client) => ['WAITING', 'OVERDUE'].includes(client.status.code)).length,
    },
    clients: enriched,
    receipts: receipts.slice(0, 40),
  });
}));

router.post('/clients', wrap(async (req, res) => {
  const client = await prisma.billingClient.create({ data: clientData(req.body, true) });
  await recordActivity({ actorId: req.user.id, type: 'BILLING', entityType: 'BILLING_CLIENT', entityId: client.id, title: `Создан клиент: ${client.name}` });
  res.status(201).json({ success: true, client });
}));

router.patch('/clients/:id', wrap(async (req, res) => {
  const id = clientId(req.params.id);
  const old = await requiredClient(id);
  const client = await prisma.billingClient.update({ where: { id }, data: clientData(req.body) });
  await recordActivity({ actorId: req.user.id, type: 'BILLING', entityType: 'BILLING_CLIENT', entityId: id, title: `Изменён клиент: ${client.name}`, details: { previous: { name: old.name, kind: old.kind, startMonth: old.startMonth }, next: { name: client.name, kind: client.kind, startMonth: client.startMonth } } });
  res.json({ success: true, client });
}));

router.post('/clients/:id/archive', wrap(async (req, res) => {
  const id = clientId(req.params.id);
  const old = await requiredClient(id);
  const archive = req.body.archived === true;
  const month = todayInBusinessZone().slice(0, 7);
  const client = await prisma.billingClient.update({ where: { id }, data: { archivedFromMonth: archive ? (old.archivedFromMonth || month) : null } });
  await recordActivity({ actorId: req.user.id, type: 'BILLING', entityType: 'BILLING_CLIENT', entityId: id, title: `${archive ? 'Архивирован' : 'Восстановлен'} клиент: ${client.name}` });
  res.json({ success: true, client });
}));

router.post('/clients/:id/pause', wrap(async (req, res) => {
  const id = clientId(req.params.id);
  const client = await requiredClient(id);
  if (client.kind !== 'MONTHLY') fail('Пауза доступна только ежемесячным клиентам');
  if (client.archivedFromMonth) fail('Сначала восстановите клиента из архива');
  const month = todayInBusinessZone().slice(0, 7);
  const openPause = await prisma.billingPause.findFirst({ where: { clientId: id, toMonth: null } });
  if (req.body.paused === true) {
    if (openPause) fail('Обслуживание уже на паузе');
    await prisma.billingPause.create({ data: { clientId: id, fromMonth: month } });
  } else if (req.body.paused === false) {
    if (!openPause) fail('Клиент не на паузе');
    if (openPause.fromMonth === month) await prisma.billingPause.delete({ where: { id: openPause.id } });
    else await prisma.billingPause.update({ where: { id: openPause.id }, data: { toMonth: previousMonth(month) } });
  } else fail('Укажите состояние paused');
  await recordActivity({ actorId: req.user.id, type: 'BILLING', entityType: 'BILLING_CLIENT', entityId: id, title: `${req.body.paused ? 'Пауза' : 'Возобновление'}: ${client.name}` });
  res.json({ success: true });
}));

router.get('/clients/:id/payments', wrap(async (req, res) => {
  const id = clientId(req.params.id);
  await requiredClient(id);
  const payments = await prisma.billingPayment.findMany({ where: { clientId: id, voidedAt: null }, orderBy: [{ receivedOn: 'desc' }, { id: 'desc' }] });
  res.json({ success: true, payments });
}));

router.post('/clients/:id/payments', wrap(async (req, res) => {
  const id = clientId(req.params.id);
  const client = await requiredClient(id);
  if (client.archivedFromMonth) fail('Нельзя вносить оплату архивному клиенту');
  const data = paymentData(req.body);
  const requestKey = typeof req.body.requestKey === 'string' && /^[a-zA-Z0-9-]{12,80}$/.test(req.body.requestKey) ? req.body.requestKey : null;
  // Повтор того же POST (например, после обрыва связи) не создаёт второй платёж.
  if (requestKey) {
    const existing = await prisma.billingPayment.findUnique({ where: { requestKey } });
    if (existing) {
      if (existing.clientId !== id || existing.voidedAt) fail('Ключ платежа уже использован', 409);
      return res.json({ success: true, payment: existing, duplicate: true });
    }
  }
  const payment = await prisma.$transaction(async (tx) => {
    const created = await tx.billingPayment.create({ data: { clientId: id, createdById: req.user.id, requestKey, ...data } });
    await tx.activity.create({ data: { actorId: req.user.id, type: 'BILLING', entityType: 'BILLING_PAYMENT', entityId: created.id, title: `Поступление от ${client.name}: ${(data.amountKopecks / 100).toFixed(2)} ₽`, details: { periodMonth: data.periodMonth, receivedOn: data.receivedOn } } });
    return created;
  });
  res.status(201).json({ success: true, payment });
}));

router.patch('/payments/:id', wrap(async (req, res) => {
  const id = paymentId(req.params.id);
  const old = await requiredPayment(id);
  const data = paymentData(req.body);
  const payment = await prisma.$transaction(async (tx) => {
    const updated = await tx.billingPayment.update({ where: { id }, data });
    await tx.activity.create({ data: { actorId: req.user.id, type: 'BILLING', entityType: 'BILLING_PAYMENT', entityId: id, title: 'Исправлен платёж', details: { previous: { periodMonth: old.periodMonth, receivedOn: old.receivedOn, amountKopecks: old.amountKopecks }, next: data } } });
    return updated;
  });
  res.json({ success: true, payment });
}));

router.delete('/payments/:id', wrap(async (req, res) => {
  const id = paymentId(req.params.id);
  const old = await requiredPayment(id);
  await prisma.$transaction(async (tx) => {
    await tx.billingPayment.update({ where: { id }, data: { voidedAt: new Date() } });
    await tx.activity.create({ data: { actorId: req.user.id, type: 'BILLING', entityType: 'BILLING_PAYMENT', entityId: id, title: 'Аннулирован ошибочный платёж', details: { clientId: old.clientId, periodMonth: old.periodMonth, receivedOn: old.receivedOn, amountKopecks: old.amountKopecks } } });
  });
  res.json({ success: true });
}));

module.exports = router;
