(() => {
  'use strict';
  let context = null;
  let selectedMonth = '';
  let billingData = null;
  let searchTerm = '';
  let statusFilter = 'ALL';
  const esc = (value = '') => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const money = (kopecks) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 }).format((kopecks || 0) / 100);
  const date = (value) => value ? `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}` : '—';
  const monthName = (value) => new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}-01T12:00:00Z`));
  const shiftMonth = (month, step) => {
    const [year, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(year, m - 1 + step, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const labels = {
    PAID: ['Оплачено', 'paid'], WAITING: ['Ожидаем оплату', 'waiting'], OVERDUE: ['Просрочка', 'overdue'],
    PAUSED: ['На паузе', 'paused'], UPCOMING: ['Предстоящий месяц', 'upcoming'],
    NOT_STARTED: ['Вне периода', 'upcoming'], ONE_TIME: ['Разовый клиент', 'onetime'],
  };
  const statusTag = (code) => {
    const [text, css] = labels[code] || ['—', 'upcoming'];
    return `<span class="billing-status billing-status--${css}">${text}</span>`;
  };
  const ctx = () => context;
  const clientById = (id) => billingData.clients.find((client) => client.id === id);
  const clientName = (client) => esc(client.projectName ? `${client.name} · ${client.projectName}` : client.name);
  const field = (label, control) => `<label class="field"><span>${label}</span>${control}</label>`;
  const footer = (text) => `<button class="button button--ghost" type="button" data-close-modal>Отмена</button><button class="button button--primary" type="submit" form="billing-form">${text}</button>`;

  function formError(error) { ctx().showError(error); }
  async function request(url, options = {}) {
    return ctx().api(`/billing${url}`, options);
  }
  const bodyJson = (body) => JSON.stringify(body);

  function cards() {
    const m = billingData.metrics;
    return `<section class="billing-metrics" aria-label="Статистика за месяц">
      <article class="billing-metric"><span>Получено за месяц</span><strong>${money(m.receivedKopecks)}</strong><small>По дате фактического поступления</small><i class="ti ti-wallet"></i></article>
      <article class="billing-metric"><span>Всего клиентов</span><strong>${m.totalClients}</strong><small>В базе за выбранный месяц</small><i class="ti ti-users"></i></article>
      <article class="billing-metric billing-metric--unpaid"><span>Не оплатили</span><strong>${m.unpaidCount}</strong><small>Ежемесячное обслуживание</small><i class="ti ti-clock-exclamation"></i></article>
      <article class="billing-metric billing-metric--paid"><span>Оплатили</span><strong>${m.paidCount}</strong><small>За выбранный расчётный месяц</small><i class="ti ti-circle-check"></i></article>
    </section>`;
  }

  function clientRows() {
    const relevant = billingData.clients.filter((client) => {
      const haystack = `${client.name} ${client.projectName || ''} ${client.note || ''}`.toLocaleLowerCase('ru-RU');
      if (!haystack.includes(searchTerm)) return false;
      if (statusFilter === 'ALL') return true;
      if (statusFilter === 'UNPAID') return ['WAITING', 'OVERDUE'].includes(client.status.code);
      if (statusFilter === 'PAID') return client.status.code === 'PAID';
      if (statusFilter === 'ARCHIVED') return !!client.archivedFromMonth && client.archivedFromMonth <= selectedMonth;
      if (statusFilter === 'OTHER') return ['PAUSED', 'ONE_TIME', 'UPCOMING', 'NOT_STARTED'].includes(client.status.code);
      return true;
    });
    const weights = { OVERDUE: 0, WAITING: 1, PAID: 2, PAUSED: 3, ONE_TIME: 4, UPCOMING: 5, NOT_STARTED: 6 };
    relevant.sort((a,b) => (weights[a.status.code] ?? 7) - (weights[b.status.code] ?? 7) || a.name.localeCompare(b.name, 'ru'));
    const tbody = document.querySelector('#billing-clients');
    if (!tbody) return;
    tbody.innerHTML = relevant.length ? relevant.map((client) => {
      const paid = client.status.periodTotal;
      const archived = client.archivedFromMonth && client.archivedFromMonth <= selectedMonth;
      return `<tr class="billing-row ${archived ? 'billing-row--archived' : ''}">
        <td><span class="billing-client-name">${esc(client.name)}</span><small>${esc(client.projectName || (client.kind === 'ONE_TIME' ? 'Разовый заказ' : 'Ежемесячное обслуживание'))}</small></td>
        <td>${statusTag(client.status.code)}${archived ? '<span class="billing-archived">Архив</span>' : ''}</td>
        <td><strong>${paid ? money(paid) : '—'}</strong></td>
        <td class="billing-row__actions">
          ${!archived ? `<button class="button button--primary button--sm" type="button" data-billing="pay" data-id="${client.id}"><i class="ti ti-plus"></i> Оплата</button>` : ''}
          <button class="billing-icon-action" type="button" data-billing="history" data-id="${client.id}" title="История платежей" aria-label="История платежей"><i class="ti ti-history"></i></button>
          <button class="billing-icon-action" type="button" data-billing="edit" data-id="${client.id}" title="Редактировать" aria-label="Редактировать клиента"><i class="ti ti-pencil"></i></button>
        </td>
      </tr>`;
    }).join('') : '<tr><td colspan="4"><div class="billing-empty">Нет клиентов по выбранным параметрам.</div></td></tr>';
    const count = document.querySelector('#billing-visible-count');
    if (count) count.textContent = `${relevant.length} из ${billingData.clients.length}`;
  }

  function receiptsHtml() {
    const receipts = billingData.receipts;
    return `<section class="panel billing-receipts">
      <header class="billing-section-heading"><div><h2>Поступления за ${esc(monthName(selectedMonth))}</h2><p>По фактической дате получения. Оплаты за другие месяцы тоже учитываются.</p></div></header>
      ${receipts.length ? `<div class="billing-receipts-list">${receipts.map((p) => `<div class="billing-receipt"><span class="billing-receipt__icon"><i class="ti ti-arrow-down-left"></i></span><span><strong>${esc(p.client.name)}</strong><small>${date(p.receivedOn)} · за ${esc(monthName(p.periodMonth))}</small></span><b>${money(p.amountKopecks)}</b></div>`).join('')}</div>` : `<div class="billing-empty">В этом месяце поступлений пока нет.</div>`}
      ${receipts.length === 40 ? '<p class="billing-note">Показаны 40 последних платежей. Общая сумма учитывает все поступления.</p>' : ''}
    </section>`;
  }

  function draw() {
    const { main } = ctx();
    main.innerHTML = `<div class="page billing-page">
      <header class="page-header billing-page-header"><div><span class="billing-eyebrow">SHUMDEV / УЧЁТ ПОСТУПЛЕНИЙ</span><h1>Финансы</h1><p>С 1 по 5 число — срок оплаты. С 6-го — просрочка. Суммы фиксируем только по факту.</p></div>
      <div class="page-header__actions"><button class="button button--primary" type="button" data-billing="add-client"><i class="ti ti-user-plus"></i> Добавить клиента</button></div></header>
      <div class="billing-period"><div><span class="billing-period__label">Расчётный период</span><strong>${esc(monthName(selectedMonth))}</strong></div>
        <div class="billing-period__switch"><button type="button" data-billing="prev-month" aria-label="Предыдущий месяц"><i class="ti ti-chevron-left"></i></button>
          <input id="billing-month" type="month" min="2020-01" max="2099-12" value="${selectedMonth}" aria-label="Выбрать месяц">
          <button type="button" data-billing="next-month" aria-label="Следующий месяц"><i class="ti ti-chevron-right"></i></button></div>
      </div>
      ${cards()}
      <section class="panel billing-clients-panel"><header class="billing-section-heading"><div><h2>Клиенты и оплаты</h2><p>Статус определяется месяцем, за который внесён платёж.</p></div><span class="billing-counter" id="billing-visible-count"></span></header>
      <div class="billing-controls"><label class="billing-search"><i class="ti ti-search"></i><input type="search" id="billing-search" placeholder="Найти клиента или проект" value="${esc(searchTerm)}"></label>
        <div class="billing-filters" role="group" aria-label="Фильтр клиентов">${[['ALL','Все'],['UNPAID','Не оплатили'],['PAID','Оплатили'],['OTHER','Прочие'],['ARCHIVED','Архив']].map(([id,label]) => `<button type="button" class="${statusFilter === id ? 'is-active' : ''}" data-billing-filter="${id}">${label}</button>`).join('')}</div></div>
      <div class="billing-table-wrap"><table class="billing-table"><thead><tr><th>Клиент / проект</th><th>Статус</th><th>За расчётный месяц</th><th>Действия</th></tr></thead><tbody id="billing-clients"></tbody></table></div></section>
      ${receiptsHtml()}<div class="billing-note">«Получено за месяц» — деньги по дате поступления. «Оплатили» — клиенты с оплатой за расчётный месяц. Разовые и приостановленные клиенты без платежа не считаются должниками. Время: Красноярск (UTC+7).</div>
    </div>`;
    clientRows();
    const search = document.querySelector('#billing-search');
    search.addEventListener('input', () => { searchTerm = search.value.toLocaleLowerCase('ru-RU').trim(); clientRows(); });
    document.querySelector('#billing-month').addEventListener('change', (event) => {
      if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(event.target.value)) { selectedMonth = event.target.value; reload().catch(formError); }
    });
    main.querySelectorAll('[data-billing-filter]').forEach((button) => button.addEventListener('click', () => { statusFilter = button.dataset.billingFilter; main.querySelectorAll('[data-billing-filter]').forEach((b) => b.classList.toggle('is-active', b === button)); clientRows(); }));
    main.querySelectorAll('[data-billing]').forEach((button) => button.addEventListener('click', () => onAction(button.dataset.billing, Number(button.dataset.id))));
  }

  async function reload() {
    const data = await request(`?month=${encodeURIComponent(selectedMonth)}`);
    billingData = data;
    draw();
  }

  async function render(options) {
    context = options;
    if (!selectedMonth) {
      // Дату и расчетный месяц отдаёт сервер, по часовому поясу компании.
      billingData = await request('');
      selectedMonth = billingData.month;
      draw();
    } else await reload();
  }

  function prepareForm(title, body, saveLabel, submit) {
    const { modal, closeModal } = ctx();
    modal(title, `<form id="billing-form" class="billing-form"><div class="form-grid">${body}</div></form>`, footer(saveLabel));
    const form = document.querySelector('#billing-form');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = document.querySelector('[form="billing-form"][type="submit"]');
      if (button.disabled) return;
      button.disabled = true;
      try {
        await submit(Object.fromEntries(new FormData(form)));
        closeModal();
        ctx().toast('Сохранено');
        await reload();
      } catch (error) { formError(error); }
      finally { if (button.isConnected) button.disabled = false; }
    });
  }

  function openClientForm(client = null) {
    const month = client?.startMonth || billingData.month;
    const body = field('Клиент / компания *', `<input name="name" required maxlength="150" value="${esc(client?.name || '')}" placeholder="Название или ФИО">`)
      + field('Проект / сайт', `<input name="projectName" maxlength="200" value="${esc(client?.projectName || '')}" placeholder="Например, сайт ИДЕАЛ">`)
      + field('Тип клиента', `<select name="kind"><option value="MONTHLY" ${client?.kind !== 'ONE_TIME' ? 'selected' : ''}>Ежемесячное обслуживание</option><option value="ONE_TIME" ${client?.kind === 'ONE_TIME' ? 'selected' : ''}>Разовый заказ</option></select>`)
      + field('С какого месяца обслуживаем', `<input name="startMonth" type="month" required min="2020-01" max="2099-12" value="${month}">`)
      + `<div class="field field--wide">${field('Заметка (необязательно)', `<textarea name="note" maxlength="1000" placeholder="Договорённости по проекту">${esc(client?.note || '')}</textarea>`)}</div>`;
    prepareForm(client ? 'Редактировать клиента' : 'Новый клиент', body, client ? 'Сохранить изменения' : 'Добавить клиента', async (data) => {
      if (client) await request(`/clients/${client.id}`, { method: 'PATCH', body: bodyJson(data) });
      else await request('/clients', { method: 'POST', body: bodyJson(data) });
    });
    if (client) {
      const footerNode = document.querySelector('.modal__footer');
      const archived = !!client.archivedFromMonth;
      footerNode.insertAdjacentHTML('afterbegin', `<button type="button" class="button button--ghost billing-danger-action" id="billing-archive">${archived ? 'Вернуть из архива' : 'В архив'}</button>${client.kind === 'MONTHLY' && !archived ? `<button type="button" class="button button--ghost" id="billing-pause">${client.pauses.some((p) => !p.toMonth) ? 'Возобновить' : 'Приостановить'}</button>` : ''}`);
      document.querySelector('#billing-archive').addEventListener('click', async () => {
        if (!window.confirm(archived ? 'Восстановить клиента?' : 'Архивировать клиента? Платежи останутся в истории.')) return;
        try { await request(`/clients/${client.id}/archive`, { method: 'POST', body: bodyJson({ archived: !archived }) }); ctx().closeModal(); await reload(); } catch (error) { formError(error); }
      });
      document.querySelector('#billing-pause')?.addEventListener('click', async () => {
        const paused = client.pauses.some((p) => !p.toMonth);
        if (!window.confirm(paused ? 'Возобновить обслуживание с текущего месяца?' : 'Приостановить обслуживание с текущего месяца?')) return;
        try { await request(`/clients/${client.id}/pause`, { method: 'POST', body: bodyJson({ paused: !paused }) }); ctx().closeModal(); await reload(); } catch (error) { formError(error); }
      });
    }
  }

  function openPaymentForm(client, payment = null) {
    const receivedOn = payment?.receivedOn || billingData.today;
    const periodMonth = payment?.periodMonth || selectedMonth;
    const amount = payment ? (payment.amountKopecks / 100).toFixed(2) : '';
    const body = `<div class="field field--wide"><div class="billing-form-client">${clientName(client)}</div></div>`
      + field('Получено, ₽ *', `<input name="amount" type="text" inputmode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" required placeholder="8000" value="${esc(amount)}">`)
      + field('За какой месяц *', `<input name="periodMonth" type="month" required min="2020-01" max="2099-12" value="${periodMonth}">`)
      + field('Дата фактического поступления *', `<input name="receivedOn" type="date" required max="${billingData.today}" value="${receivedOn}">`)
      + `<div class="field field--wide">${field('Комментарий (необязательно)', `<textarea name="note" maxlength="500" placeholder="Например, сопровождение сайта">${esc(payment?.note || '')}</textarea>`)}</div>`;
    const requestKey = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    prepareForm(payment ? 'Исправить платёж' : 'Внести оплату', body, payment ? 'Сохранить платёж' : 'Записать поступление', async (data) => {
      if (payment) await request(`/payments/${payment.id}`, { method: 'PATCH', body: bodyJson(data) });
      else await request(`/clients/${client.id}/payments`, { method: 'POST', body: bodyJson({ ...data, requestKey }) });
    });
  }

  async function history(id) {
    const client = clientById(id);
    if (!client) return;
    const data = await request(`/clients/${id}/payments`);
    const payments = data.payments;
    ctx().modal(`Платежи: ${client.name}`, `<div class="billing-history-head"><span>${esc(client.projectName || 'История поступлений')}</span><strong>${payments.length} платежей</strong></div>
      ${payments.length ? `<div class="billing-history-list">${payments.map((p) => `<article class="billing-history-row"><div><b>${money(p.amountKopecks)}</b><small>Поступило ${date(p.receivedOn)} · за ${esc(monthName(p.periodMonth))}</small>${p.note ? `<p>${esc(p.note)}</p>` : ''}</div><div><button type="button" class="billing-icon-action" data-history-edit="${p.id}" aria-label="Редактировать платёж" title="Редактировать"><i class="ti ti-pencil"></i></button><button type="button" class="billing-icon-action billing-icon-action--danger" data-history-void="${p.id}" aria-label="Аннулировать платёж" title="Аннулировать"><i class="ti ti-trash"></i></button></div></article>`).join('')}</div>` : '<div class="billing-empty">Платежей пока нет.</div>'}
      <div class="billing-history-bottom"><button type="button" class="button button--primary" id="billing-history-add"><i class="ti ti-plus"></i> Внести оплату</button></div>`);
    document.querySelector('#billing-history-add').addEventListener('click', () => openPaymentForm(client));
    document.querySelectorAll('[data-history-edit]').forEach((button) => button.addEventListener('click', () => openPaymentForm(client, payments.find((p) => p.id === Number(button.dataset.historyEdit)))));
    document.querySelectorAll('[data-history-void]').forEach((button) => button.addEventListener('click', async () => {
      if (!window.confirm('Аннулировать этот платёж? Он исчезнет из сумм, но действие сохранится в журнале.')) return;
      button.disabled = true;
      try { await request(`/payments/${button.dataset.historyVoid}`, { method: 'DELETE' }); await reload(); await history(id); ctx().toast('Платёж аннулирован'); }
      catch (error) { button.disabled = false; formError(error); }
    }));
  }

  function onAction(action, id) {
    if (action === 'prev-month' || action === 'next-month') {
      selectedMonth = shiftMonth(selectedMonth, action === 'prev-month' ? -1 : 1);
      if (selectedMonth < '2020-01' || selectedMonth > '2099-12') return;
      return reload().catch(formError);
    }
    if (action === 'add-client') return openClientForm();
    const client = clientById(id);
    if (!client) return;
    if (action === 'edit') openClientForm(client);
    if (action === 'pay') openPaymentForm(client);
    if (action === 'history') history(id).catch(formError);
  }

  window.ShumDevBilling = { render };
})();
