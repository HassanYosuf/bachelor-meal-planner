export function populateDropdown(id, meals, onSelect) {
  const list = document.getElementById(id + '-list');
  const btn = document.getElementById(id + '-btn');
  btn.textContent = 'Choose a meal...';
  btn.dataset.value = '';

  const groups = {};
  meals.forEach(m => {
    if (!groups[m.category]) groups[m.category] = [];
    groups[m.category].push(m);
  });

  list.innerHTML = '';
  Object.keys(groups).sort().forEach(cat => {
    const grp = document.createElement('div');
    grp.className = 'dd-group';
    grp.textContent = cat;
    list.appendChild(grp);
    groups[cat].forEach(m => {
      const item = document.createElement('div');
      item.className = 'dd-item';
      item.dataset.value = m.id;
      item.textContent = m.name + (m.soak_mins ? ' ⏱' : '');
      item.addEventListener('click', () => {
        btn.textContent = item.textContent;
        btn.dataset.value = m.id;
        list.classList.remove('open');
        if (onSelect) onSelect(m.id);
      });
      list.appendChild(item);
    });
  });
}

export function toggleDropdown(id) {
  const list = document.getElementById(id + '-list');
  const isOpen = list.classList.contains('open');
  document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('open'));
  if (!isOpen) list.classList.add('open');
}
