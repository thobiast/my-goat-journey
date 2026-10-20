export function createTour(getCopy, getXP) {
  let view = 'progress';
  let selectedDay = 26;
  let selectedLevel = 1;
  const views = ['today', 'progress', 'journey'];
  const controls = [...document.querySelectorAll('[data-view]')];
  const calendar = document.querySelector('#progress-view');
  const journey = document.querySelector('#journey-view');
  const missed = new Set([8, 13, 21]);
  const status = day => day < 5 ? 'before' : missed.has(day) ? 'missed' : 'complete';
  const trackedDays = Array.from({ length: 22 }, (_, i) => i + 5);
  const completedCount = trackedDays.filter(day => status(day) === 'complete').length;
  let currentStreak = 0;
  let bestStreak = 0;
  for (const day of trackedDays) {
    currentStreak = status(day) === 'complete' ? currentStreak + 1 : 0;
    bestStreak = Math.max(bestStreak, currentStreak);
  }
  calendar.innerHTML = '<div class="app-preview calendar-preview"><div class="calendar-heading"><h4></h4><span class="month"></span></div><p class="history-note"></p><div class="calendar-weekdays" aria-hidden="true"></div><div class="calendar-grid" role="group"></div><div class="calendar-legend"></div><p id="calendar-detail" role="status" aria-live="polite"></p><dl class="calendar-metrics"></dl></div>';
  const weekdayRow = calendar.querySelector('.calendar-weekdays');
  for (let i = 0; i < 7; i++) {
    const day = document.createElement('span');
    day.innerHTML = '<span class="weekday-name"></span><span class="weekday-initial"></span>';
    weekdayRow.append(day);
  }
  const grid = calendar.querySelector('.calendar-grid');
  // October 2026 begins on Thursday in this Monday-first calendar.
  for (let i = 0; i < 3; i++) grid.append(document.createElement('span'));
  for (let day = 1; day <= 31; day++) {
    const cell = document.createElement(day > 26 ? 'span' : 'button');
    cell.textContent = day;
    cell.dataset.day = day;
    cell.className = `calendar-cell ${day > 26 ? 'future' : status(day)}`;
    if (day <= 26) {
      cell.type = 'button';
      // Before-tracking dates are explanatory/inert, not editable history.
      cell.disabled = day < 5;
      cell.addEventListener('click', () => { selectedDay = day; update(); });
    }
    grid.append(cell);
  }
  calendar.querySelector('.calendar-legend').innerHTML = ['complete', 'missed', 'before'].map(state => `<span><i class="${state}" aria-hidden="true"></i><span data-state="${state}"></span></span>`).join('');
  calendar.querySelector('.calendar-metrics').innerHTML = [
    ['completionRate', `${Math.round(completedCount / trackedDays.length * 100)}%`],
    ['currentStreak', currentStreak], ['bestStreak', bestStreak],
  ].map(([key, value]) => `<div><dt data-metric="${key}"></dt><dd data-value="${value}"></dd></div>`).join('');

  journey.innerHTML = `<div class="app-preview journey-preview"><div class="calendar-heading"><h4></h4><span class="journey-xp"></span></div><p class="trail-caption"></p>
    <div class="journey-range"><strong></strong><span></span></div><progress max="100" value="60"></progress><p class="journey-remaining"></p>
    <svg class="trail-drawing" viewBox="0 0 300 165" aria-hidden="true" focusable="false">
      <path class="trail-base" d="M20 140C40 140 20 90 90 90S150 70 150 65S220 65 235 30S265 20 280 20"/>
      <path class="trail-traveled" pathLength="200" d="M20 140C40 140 20 90 90 90S150 70 150 65S220 65 235 30S265 20 280 20"/>
      <circle cx="20" cy="140" r="6"/><circle cx="150" cy="65" r="6"/><circle cx="280" cy="20" r="6"/>
      <circle class="trail-position" r="7"/>
    </svg><div class="level-choices" role="group"></div><p id="level-detail" role="status" aria-live="polite"></p></div>`;
  for (let level = 1; level <= 3; level++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.level = level;
    button.addEventListener('click', () => { selectedLevel = level; update(); });
    journey.querySelector('.level-choices').append(button);
  }
  controls.forEach(button => button.addEventListener('click', () => {
    view = button.dataset.view;
    update();
  }));

  function update() {
    const t = getCopy();
    controls.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
    views.forEach(key => { document.querySelector(`#${key}-view`).hidden = key !== view; });
    document.querySelector('#tour-number').textContent = `0${views.indexOf(view) + 1} / 03`;
    document.querySelector('#tour-subheading').textContent = t[`${view}Heading`];
    document.querySelector('#tour-description').textContent = t[`${view}Copy`];
    calendar.querySelector('h4').textContent = t.progress;
    calendar.querySelector('.month').textContent = t.month;
    calendar.querySelector('.history-note').textContent = t.readingHistory;
    [...weekdayRow.children].forEach((node, i) => {
      node.querySelector('.weekday-name').textContent = t.weekdays[i];
      node.querySelector('.weekday-initial').textContent = t.weekdaysNarrow[i];
      node.title = t.weekdays[i];
    });
    grid.setAttribute('aria-label', t.calendar);
    const date = day => new Intl.DateTimeFormat(document.documentElement.lang, { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(2026, 9, day, 12));
    grid.querySelectorAll('button').forEach(button => {
      const day = Number(button.dataset.day);
      button.setAttribute('aria-label', `${date(day)}: ${t.dayStates[status(day)]}`);
      if (day >= 5) button.setAttribute('aria-pressed', String(day === selectedDay));
    });
    calendar.querySelectorAll('[data-state]').forEach(node => { node.textContent = t.dayStates[node.dataset.state]; });
    calendar.querySelector('#calendar-detail').textContent = `${date(selectedDay)} · ${t.dayStates[status(selectedDay)]}`;
    calendar.querySelectorAll('[data-metric]').forEach(node => {
      node.textContent = t[node.dataset.metric];
      const value = node.nextElementSibling.dataset.value;
      node.nextElementSibling.textContent = node.dataset.metric === 'completionRate' ? value : `${value} ${t.days}`;
    });
    const xp = getXP();
    journey.querySelector('h4').textContent = t.journey;
    journey.querySelector('.journey-xp').textContent = `${xp} XP`;
    journey.querySelector('.trail-caption').textContent = t.trail;
    journey.querySelector('.journey-range strong').textContent = `${t.level} 1 · 0 XP`;
    journey.querySelector('.journey-range span').textContent = `${t.level} 2 · 100 XP`;
    journey.querySelector('progress').value = xp;
    journey.querySelector('progress').setAttribute('aria-label', t.journey);
    journey.querySelector('.journey-remaining').textContent = `${100 - xp} ${t.remaining}`;
    journey.querySelectorAll('[data-level]').forEach(button => {
      button.textContent = `${t.level} ${button.dataset.level}`;
      button.setAttribute('aria-pressed', String(Number(button.dataset.level) === selectedLevel));
    });
    journey.querySelector('.level-choices').setAttribute('aria-label', t.trail);
    journey.querySelector('#level-detail').textContent = `${t.level} ${selectedLevel} · ${selectedLevel === 1 ? t.current : t.ahead} · ${(selectedLevel - 1) * 100} XP`;
    const path = journey.querySelector('.trail-traveled');
    path.setAttribute('stroke-dasharray', `${xp} 200`);
    // Route, traveled stroke, and position use one geometry, not independent estimates.
    if (view === 'journey') {
      const point = path.getPointAtLength(path.getTotalLength() * xp / 200);
      const marker = journey.querySelector('.trail-position');
      marker.setAttribute('cx', point.x);
      marker.setAttribute('cy', point.y);
    }
  }
  return { update };
}
