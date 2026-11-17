(() => {
  'use strict';

  // ---------- Config ----------
  const GENS = [
    { n: 1, roman: 'I',    region: 'Kanto',  start: 1,   end: 151,  icon: 1 },
    { n: 2, roman: 'II',   region: 'Johto',  start: 152, end: 251,  icon: 152 },
    { n: 3, roman: 'III',  region: 'Hoenn',  start: 252, end: 386,  icon: 252 },
    { n: 4, roman: 'IV',   region: 'Sinnoh', start: 387, end: 493,  icon: 387 },
    { n: 5, roman: 'V',    region: 'Unova',  start: 494, end: 649,  icon: 495 },
    { n: 6, roman: 'VI',   region: 'Kalos',  start: 650, end: 721,  icon: 650 },
    { n: 7, roman: 'VII',  region: 'Alola',  start: 722, end: 809,  icon: 722 },
    { n: 8, roman: 'VIII', region: 'Galar',  start: 810, end: 905,  icon: 810 },
    { n: 9, roman: 'IX',   region: 'Paldea', start: 906, end: 1025, icon: 906 },
  ];
  const TOTAL = 1025;
  const NUM_OPTIONS = 6;
  const NEXT_DELAY = 1300;   // ms após acerto
  const OVER_DELAY = 1600;   // ms após erro

  const ART = id =>
    `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;

  const LS = { gens: 'qep.gens', best: 'qep.best', names: 'qep.names.v1' };

  // Nomes que não seguem a regra "troca hífen por espaço e capitaliza"
  const SPECIAL_NAMES = {
    'nidoran-f': 'Nidoran♀', 'nidoran-m': 'Nidoran♂',
    'mr-mime': 'Mr. Mime', 'mime-jr': 'Mime Jr.', 'mr-rime': 'Mr. Rime',
    'farfetchd': "Farfetch'd", 'sirfetchd': "Sirfetch'd",
    'type-null': 'Type: Null', 'flabebe': 'Flabébé',
    'ho-oh': 'Ho-Oh', 'porygon-z': 'Porygon-Z',
    'jangmo-o': 'Jangmo-o', 'hakamo-o': 'Hakamo-o', 'kommo-o': 'Kommo-o',
    'wo-chien': 'Wo-Chien', 'chien-pao': 'Chien-Pao', 'ting-lu': 'Ting-Lu', 'chi-yu': 'Chi-Yu',
  };

  // ---------- Storage (só local, nada de nuvem) ----------
  const store = {
    get(k, fallback) {
      try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignora */ } },
  };

  // ---------- Estado ----------
  let names = null;                       // { id: "Nome" }
  let selected = new Set(
    (store.get(LS.gens, [1]) || []).filter(n => GENS.some(g => g.n === n))
  );
  let best = Number(store.get(LS.best, 0)) || 0;
  let bestAtStart = 0;
  let score = 0;
  let answered = true;
  let current = null;                     // rodada atual
  let queued = null;                      // próxima rodada (pré-carregada)
  let recent = [];                        // evita repetir pokémon seguidos
  let token = 0;                          // invalida rodadas antigas
  let timer = null;
  let failures = 0;

  const $ = id => document.getElementById(id);
  const el = {
    menu: $('menu'), game: $('game'), overlay: $('overlay'),
    genGrid: $('genGrid'), poolCount: $('poolCount'), startBtn: $('startBtn'),
    menuStatus: $('menuStatus'), menuBest: $('menuBest'),
    score: $('score'), best: $('best'), scoreBall: $('scoreBall'),
    mon: $('mon'), loader: $('loader'), revealName: $('revealName'), options: $('options'),
    goName: $('goName'), goScore: $('goScore'), goRecord: $('goRecord'),
  };

  // ---------- Utilidades ----------
  const rand = n => Math.floor(Math.random() * n);
  const shuffle = arr => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  const formatName = raw =>
    SPECIAL_NAMES[raw] ||
    raw.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');

  function preload(url, timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const t = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      img.onload = () => { clearTimeout(t); resolve(url); };
      img.onerror = () => { clearTimeout(t); reject(new Error('erro ao carregar imagem')); };
      img.src = url;
    });
  }

  function showScreen(name) {
    el.menu.classList.toggle('active', name === 'menu');
    el.game.classList.toggle('active', name === 'game');
  }

  // ---------- Nomes (PokeAPI) ----------
  async function loadNames() {
    if (names) return;
    const cached = store.get(LS.names, null);
    if (cached && Object.keys(cached).length >= TOTAL) { names = cached; return; }

    const res = await fetch(`https://pokeapi.co/api/v2/pokemon-species?limit=${TOTAL}`);
    if (!res.ok) throw new Error(`PokeAPI respondeu ${res.status}`);
    const data = await res.json();
    const map = {};
    for (const s of data.results) {
      const id = Number(s.url.split('/').filter(Boolean).pop());
      if (id >= 1 && id <= TOTAL) map[id] = formatName(s.name);
    }
    names = map;
    store.set(LS.names, map);
  }

  // ---------- Menu ----------
  function buildGenGrid() {
    el.genGrid.innerHTML = '';
    for (const g of GENS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gen-card';
      b.dataset.gen = g.n;
      b.innerHTML = `
        <img src="${ART(g.icon)}" alt="" loading="lazy" draggable="false">
        <span class="gen-num">Gen ${g.roman}</span>
        <span class="gen-region">${g.region}</span>
        <span class="gen-range">#${g.start}–${g.end}</span>`;
      b.addEventListener('click', () => {
        selected.has(g.n) ? selected.delete(g.n) : selected.add(g.n);
        saveAndRefreshMenu();
      });
      el.genGrid.appendChild(b);
    }
  }

  function saveAndRefreshMenu() {
    store.set(LS.gens, [...selected].sort((a, b) => a - b));
    refreshMenu();
  }

  function refreshMenu() {
    for (const card of el.genGrid.children) {
      const on = selected.has(Number(card.dataset.gen));
      card.classList.toggle('on', on);
      card.setAttribute('aria-pressed', String(on));
    }
    const count = pool().length;
    el.poolCount.textContent = count
      ? `${count} Pokémon na brincadeira`
      : 'Escolha pelo menos uma geração';
    el.startBtn.disabled = count === 0;
    el.menuBest.textContent = best;
  }

  function pool() {
    const ids = [];
    for (const g of GENS) {
      if (!selected.has(g.n)) continue;
      for (let i = g.start; i <= g.end; i++) ids.push(i);
    }
    return ids;
  }

  // ---------- Jogo ----------
  function buildRound() {
    const p = pool();
    let id, tries = 0;
    do { id = p[rand(p.length)]; } while (recent.includes(id) && ++tries < 60);
    recent.push(id);
    if (recent.length > Math.min(60, Math.floor(p.length / 2))) recent.shift();

    const opts = new Set([id]);
    while (opts.size < NUM_OPTIONS) opts.add(p[rand(p.length)]);

    const round = { id, options: shuffle([...opts]), ready: preload(ART(id)) };
    round.ready.catch(() => {}); // evita "unhandled rejection" se nunca for usada
    return round;
  }

  async function startGame() {
    el.startBtn.disabled = true;
    el.menuStatus.classList.remove('error');
    el.menuStatus.textContent = names ? '' : 'Carregando Pokédex…';
    try {
      await loadNames();
    } catch (err) {
      console.error(err);
      el.menuStatus.classList.add('error');
      el.menuStatus.textContent = 'Não consegui falar com a PokeAPI. Confere a internet e tenta de novo.';
      el.startBtn.disabled = false;
      return;
    }
    el.menuStatus.textContent = '';
    el.startBtn.disabled = false;

    score = 0;
    bestAtStart = best;
    queued = null;
    failures = 0;
    updateHud();
    hideOverlay();
    showScreen('game');
    nextRound();
  }

  async function nextRound() {
    clearTimeout(timer);
    const myToken = ++token;
    answered = true;

    const round = queued || buildRound();
    queued = null;
    current = round;

    // reseta o palco
    el.mon.className = '';
    el.mon.removeAttribute('src');
    el.revealName.classList.remove('show');
    el.loader.classList.add('show');
    renderOptions(round, true);

    try {
      await round.ready;
    } catch {
      if (myToken !== token) return;
      if (++failures >= 4) {
        el.loader.classList.remove('show');
        el.revealName.textContent = 'Sem conexão 😵';
        el.revealName.classList.add('show');
        return;
      }
      return nextRound(); // tenta outro pokémon
    }
    if (myToken !== token) return; // usuário saiu ou mudou de rodada

    failures = 0;
    el.loader.classList.remove('show');
    el.mon.src = ART(round.id);
    el.mon.className = 'silhouette show';
    renderOptions(round, false);
    answered = false;

    queued = buildRound(); // já pré-carrega a próxima
  }

  function renderOptions(round, disabled) {
    el.options.innerHTML = '';
    round.options.forEach((id, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt';
      b.dataset.id = id;
      b.disabled = disabled;
      b.innerHTML = `<span class="key">${i + 1}</span><span class="label"></span>`;
      b.querySelector('.label').textContent = names[id] || `#${id}`;
      b.addEventListener('click', () => answer(id, b));
      el.options.appendChild(b);
    });
  }

  function answer(id, btn) {
    if (answered || !current) return;
    answered = true;
    const ok = id === current.id;

    for (const b of el.options.children) {
      b.disabled = true;
      if (Number(b.dataset.id) === current.id) b.classList.add('correct');
    }
    if (!ok) btn.classList.add('wrong');

    // revela
    el.mon.classList.remove('silhouette');
    el.mon.classList.add('revealed');
    el.revealName.textContent = `É o ${names[current.id]}!`;
    el.revealName.classList.add('show');

    if (ok) {
      score++;
      if (score > best) { best = score; store.set(LS.best, best); }
      updateHud();
      animateBall('bump');
      timer = setTimeout(nextRound, NEXT_DELAY);
    } else {
      animateBall('shake');
      timer = setTimeout(gameOver, OVER_DELAY);
    }
  }

  function updateHud() {
    el.score.textContent = score;
    el.best.textContent = best;
  }

  function animateBall(cls) {
    el.scoreBall.classList.remove('bump', 'shake');
    void el.scoreBall.offsetWidth; // reinicia animação
    el.scoreBall.classList.add(cls);
  }

  function gameOver() {
    el.goName.textContent = names[current.id];
    el.goScore.textContent = score;
    const isNew = score > bestAtStart && score > 0;
    el.goRecord.textContent = isNew ? '🏆 Novo recorde!' : `Recorde: ${best}`;
    el.goRecord.classList.toggle('new', isNew);
    el.overlay.hidden = false;
    $('againBtn').focus();
  }

  function hideOverlay() { el.overlay.hidden = true; }

  function backToMenu() {
    clearTimeout(timer);
    token++;
    current = null;
    queued = null;
    answered = true;
    hideOverlay();
    refreshMenu();
    showScreen('menu');
  }

  // ---------- Eventos ----------
  el.startBtn.addEventListener('click', startGame);
  $('selAll').addEventListener('click', () => { GENS.forEach(g => selected.add(g.n)); saveAndRefreshMenu(); });
  $('selNone').addEventListener('click', () => { selected.clear(); saveAndRefreshMenu(); });
  $('backBtn').addEventListener('click', backToMenu);
  $('menuBtn').addEventListener('click', backToMenu);
  $('againBtn').addEventListener('click', () => {
    hideOverlay();
    score = 0;
    bestAtStart = best;
    updateHud();
    nextRound();
  });

  document.addEventListener('keydown', e => {
    if (!el.game.classList.contains('active')) return;
    if (!el.overlay.hidden) {
      if (e.key === 'Escape') backToMenu();
      return;
    }
    const n = Number(e.key);
    if (n >= 1 && n <= NUM_OPTIONS) {
      const b = el.options.children[n - 1];
      if (b && !b.disabled) b.click();
    }
  });

  // ---------- Init ----------
  buildGenGrid();
  refreshMenu();
  loadNames().catch(() => { /* tenta de novo ao clicar em Jogar */ });
})();
