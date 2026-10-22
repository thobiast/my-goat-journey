// Deliberately standalone: no imports from the app, database, or PWA modules.
const pillars = ['mind', 'body', 'nutrition', 'hygiene', 'body', 'body', 'mind', 'mind', 'body', 'mind', 'mind', 'mind'];
const colors = { mind: '#574776', body: '#8a3e4b', nutrition: '#77502f', hygiene: '#245a78' };
const shapes = {
  mind: 'M12 5C10 2 5 3 5 7C1 8 2 13 5 14C3 19 8 22 12 19M12 5C14 2 19 3 19 7C23 8 22 13 19 14C21 19 16 22 12 19M12 5V19M5 7L8 9L7 12M19 7L16 9L17 12M5 14L9 15M19 14L15 15',
  body: [
    'M12.409 13.017A5 5 0 0 1 22 15c0 3.866-4 7-9 7-4.077 0-8.153-.82-10.371-2.462-.426-.316-.631-.832-.62-1.362C2.118 12.723 2.627 2 10 2a3 3 0 0 1 3 3 2 2 0 0 1-2 2c-1.105 0-1.64-.444-2-1',
    'M15 14a5 5 0 0 0-7.584 2',
    'M9.964 6.825C8.019 7.977 9.5 13 8 15',
  ],
  nutrition: 'M17 12A5 5 0 1 1 7 12A5 5 0 1 1 17 12M2 3V10L4 12L6 10V3M4 3V21M21 3C18 5 18 9 21 11V21M21 3V11',
  hygiene: 'M12 2C10 6 4 11 4 15A8 8 0 0 0 20 15C20 11 14 6 12 2ZM8 15C8 17 9 18 11 18',
};
// Canonical pillar geometry mirrors PillarIcon.tsx / BicepsFlexed.tsx without mounting the app.
// Biceps and Sparkles retain the existing pinned Lucide ISC notice linked in the footer.
const sparkles = '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4M22 5h-4M4 17v2M5 18H3"/>';
function svg(geometry) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${geometry}</svg>`;
}
const icon = kind => svg([shapes[kind]].flat().map(d => `<path d="${d}"/>`).join(''));
const put = (root, selector, value) => { root.querySelector(selector).textContent = value; };

export function createDemonstrations(getCopy, onChange) {
  let selected = 0;
  const completed = new Set([2]);
  let feedback = false;
  let expiry;
  const demos = [document.querySelector('#hero-demo'), document.querySelector('#tour-today')];
  const strip = document.querySelector('#journey-strip');
  const ideas = [];
  let ids;

  document.querySelectorAll('.pillar-summaries [data-pillar]').forEach(item => {
    const kind = item.dataset.pillar;
    item.style.setProperty('--pillar', colors[kind]);
    item.querySelector('.pillar-symbol').innerHTML = icon(kind);
  });

  for (let id = 0; id < 12; id++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'idea';
    button.innerHTML = `<span class="idea-icon">${icon(pillars[id])}</span><span><strong></strong><span class="goal"></span><span class="frequency"></span></span>`;
    button.addEventListener('click', () => {
      selected = id;
      feedback = false;
      clearTimeout(expiry);
      buildRows();
      update();
    });
    document.querySelector(id < 4 ? '#initial-ideas' : '#additional-ideas').append(button);
    ideas.push(button);
  }

  demos.forEach((demo, index) => {
    const titleTag = index === 0 ? 'h3' : 'h4';
    demo.innerHTML = `<div class="demo-header"><div><${titleTag} class="demo-title"></${titleTag}><p class="demo-date"></p></div><span class="xp-badge">${svg(sparkles)}<strong></strong> XP</span></div>
      <p class="demo-intro"></p><div class="completion-summary"><span></span><strong></strong></div><progress max="4" value="1"></progress>
      <div class="demo-groups"></div><p class="demo-feedback" role="status" aria-live="polite" aria-atomic="true"></p>`;
  });
  strip.innerHTML = '<div class="strip-top"><strong></strong><span></span></div><progress max="100" value="60"></progress><div class="strip-bottom"><span></span><span></span></div>';

  function buildRows() {
    ids = [selected, ...[0, 1, 2, 3].filter(id => id !== selected)].slice(0, 4);
    demos.forEach((demo, demoIndex) => {
      const groups = demo.querySelector('.demo-groups');
      groups.replaceChildren();
      [...new Set(ids.map(id => pillars[id]))].forEach(kind => {
        const group = document.createElement('div');
        group.className = 'demo-group';
        group.style.setProperty('--pillar', colors[kind]);
        group.dataset.pillar = kind;
        group.innerHTML = `<div class="group-heading"><span class="group-title"><span class="pillar-icon">${icon(kind)}</span><strong></strong></span><span class="group-count"></span></div>`;
        ids.filter(id => pillars[id] === kind).forEach(id => {
          const row = document.createElement('div');
          row.className = 'habit-row';
          row.dataset.habit = id;
          row.innerHTML = `<div><span class="habit-name" id="habit-${demoIndex}-${id}"></span><span class="habit-detail"></span></div><label class="check-target"><input type="checkbox"></label>`;
          row.querySelector('input').addEventListener('change', event => {
            if (event.target.checked) completed.add(id);
            else completed.delete(id);
            feedback = event.target.checked;
            clearTimeout(expiry);
            if (feedback) expiry = setTimeout(() => { feedback = false; update(); }, 1600);
            update();
          });
          group.append(row);
        });
        groups.append(group);
      });
    });
  }

  function update() {
    const t = getCopy();
    const count = ids.filter(id => completed.has(id)).length;
    // Fictional prior XP + visible first/non-milestone completions. Undo never multiplies XP.
    const xp = 50 + count * 10;
    ideas.forEach((button, id) => {
      const [action, goal, frequency] = t.ideas[id];
      put(button, 'strong', action);
      put(button, '.goal', goal);
      put(button, '.frequency', frequency);
      button.setAttribute('aria-pressed', String(id === selected));
    });
    demos.forEach(demo => {
      put(demo, '.demo-title', t.today);
      put(demo, '.demo-date', t.sampleDate);
      put(demo, '.xp-badge strong', xp);
      demo.querySelector('.xp-badge').setAttribute('aria-label', `${t.total}: ${xp}`);
      put(demo, '.demo-intro', t.demoIntro);
      put(demo, '.completion-summary span', t.daily);
      put(demo, '.completion-summary strong', `${count}/4 ${t.completed}`);
      const progress = demo.querySelector('progress');
      progress.value = count;
      progress.setAttribute('aria-label', t.daily);
      demo.querySelectorAll('.demo-group').forEach(group => {
        const kind = group.dataset.pillar;
        const groupIds = ids.filter(id => pillars[id] === kind);
        put(group, '.group-heading strong', t[kind]);
        put(group, '.group-count', `${groupIds.filter(id => completed.has(id)).length}/${groupIds.length} ${t.completed}`);
      });
      demo.querySelectorAll('.habit-row').forEach(row => {
        const id = Number(row.dataset.habit);
        const [action, goal, frequency] = t.ideas[id];
        put(row, '.habit-name', action);
        put(row, '.habit-detail', `${goal} · ${frequency}`);
        row.classList.toggle('is-done', completed.has(id));
        const checkbox = row.querySelector('input');
        checkbox.checked = completed.has(id);
        checkbox.setAttribute('aria-label', `${t.check}: ${action} — ${goal}`);
      });
      put(demo, '.demo-feedback', count === 4 ? t.allDone : feedback ? '+10 XP' : '');
    });
    put(strip, '.strip-top strong', `${t.journey} · ${t.level} 1`);
    put(strip, '.strip-top span', `${xp} / 100 XP`);
    strip.querySelector('progress').value = xp;
    strip.querySelector('progress').setAttribute('aria-label', t.journey);
    put(strip, '.strip-bottom span:first-child', `${100 - xp} ${t.remaining}`);
    put(strip, '.strip-bottom span:last-child', `${t.level} 2`);
    onChange();
  }
  buildRows();
  update();
  return { update, getXP: () => 50 + ids.filter(id => completed.has(id)).length * 10 };
}
