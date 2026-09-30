/* ==========================================================================
   Aion 2 - Progress Tracker
   Client-side only. All data lives in this browser's localStorage.

   Contents:
   1. Constants and defaults
   2. Helpers
   3. State: load, normalize (migrations), save
   4. Time zones and reset schedule
   5. Progress, resets and weekly history
   6. Stats and gear calculations
   7. Rendering: shell, tabs, overview, character detail
   8. Modals: character, gear, settings, history, confirmations
   9. Events
  10. Live updates (reload when the app's files change)
  11. Start-up
   ========================================================================== */
'use strict';
(function () {

  // Live updates only apply when app.js is loaded as a file from server/server.py or serve.ps1,
  // not when the app is bundled into one HTML page (tools/build-single-file.ps1).
  const SERVED_BY_APP_SERVER = !!(document.currentScript && /\/js\/app\.js/.test(document.currentScript.src));

  /* ---------- 1. Constants and defaults ---------- */

  const STORE_KEY = 'aion2-progress-tracker';
  const SCHEMA = 2; // 2: main/alt roles, Aion 2 task lists, task details (description, location, info)
  const HISTORY_LIMIT = 156; // about three years of weeks
  const HEAT_RANGES = [1, 2, 3]; // months shown in the completion history heatmap
  // Spacetime Rift alert options (minutes before a portal opens; sounds are synthesised).
  const RIFT_LEADS = [0, 1, 2, 5, 10];
  const RIFT_SOUNDS = [['chime', 'Chime'], ['bell', 'Bell'], ['arcane', 'Arcane'], ['horn', 'War horn'], ['ping', 'Ping'], ['none', 'No sound']];
  const SIDE_TABS = [['roadmap', 'Roadmap'], ['history', 'History'], ['notes', 'Notes'], ['stats', 'Stats'], ['gear', 'Gear'], ['calc', 'Calculations']];
  // Personal notes. Limits keep the synced save well inside the storage's document size.
  const NOTES_MAX = 100;
  const NOTE_LEN = 1000;
  const KINDS = ['daily', 'weekly', 'static'];
  const KIND_LABEL = { daily: 'Daily', weekly: 'Weekly', static: 'One-time' };

  // Aion 2 classes (Spiritmaster was renamed Elementalist). Descriptions follow the Fextralife wiki.
  const CLASSES = ['Gladiator', 'Templar', 'Assassin', 'Ranger', 'Sorcerer', 'Elementalist', 'Cleric', 'Chanter'];
  const CLASS_ALIASES = { spiritmaster: 'Elementalist' };
  const CLASS_COLORS = {
    Gladiator: '#f97316', Templar: '#fbbf24', Assassin: '#a78bfa', Ranger: '#34d399',
    Sorcerer: '#60a5fa', Elementalist: '#22d3ee', Cleric: '#f0abfc', Chanter: '#fb7185',
  };
  const CLASS_INFO = {
    Gladiator: 'Melee fighter using heavy weapons and AoE strikes.',
    Templar: 'Frontline tank with strong defense and crowd control.',
    Assassin: 'Stealthy melee DPS with burst damage.',
    Ranger: 'Ranged attacker using bows and traps.',
    Sorcerer: 'Master of elemental magic and ranged damage.',
    Elementalist: 'Summoner who commands elemental spirits.',
    Cleric: 'Healer with strong recovery and protective magic.',
    Chanter: 'Hybrid support with buffs and healing.',
  };
  // Class emblems drawn for this app (48×48, stroked in the current colour).
  const CLASS_EMBLEMS = {
    Gladiator: '<path d="M24 3l3 6v21h-6V9z"/><path d="M15 30h18M24 33v8M21 44h6"/><path d="M17 8c-5 5-6 13-1 19M31 8c5 5 6 13 1 19"/><path d="M12 13c-3 3-4 8-2 12M36 13c3 3 4 8 2 12"/>',
    Templar: '<path d="M24 4l15 5v12c0 10-6 17-15 23C15 38 9 31 9 21V9z"/><path d="M24 11l6 9-6 13-6-13z"/><path d="M15 12l9 4 9-4"/>',
    Assassin: '<path d="M10 7l20 27M38 7L18 34"/><path d="M13 31l6-3M35 31l-6-3"/><path d="M16 36l-4 5M32 36l4 5"/><path d="M24 17l3 4-3 4-3-4z"/><path d="M24 30l4 6-4 7-4-7z"/>',
    Ranger: '<path d="M33 5c-13 5-19 13-19 19s6 14 19 19"/><path d="M33 5v38"/><path d="M8 24h30"/><path d="M34 20l6 4-6 4"/><path d="M8 21l-3 3 3 3"/>',
    Sorcerer: '<path d="M24 7l10 15-10 15-10-15z"/><path d="M24 16l4 6-4 6-4-6z"/><path d="M9 30a16 16 0 0 0 30 0"/><path d="M24 2v4M13 9l1.5 2M35 9l-1.5 2"/><path d="M24 42v4"/>',
    Elementalist: '<circle cx="24" cy="24" r="17"/><path d="M24 4l4 15 15 5-15 5-4 15-4-15-15-5 15-5z"/><circle cx="24" cy="24" r="3"/>',
    Cleric: '<path d="M16 10c-7 5-7 18 1 24h14c8-6 8-19 1-24"/><path d="M21 13v19M24 11v21M27 13v19"/><path d="M19 34l5 9 5-9"/><path d="M24 3l2 4-2 3-2-3z"/>',
    Chanter: '<path d="M24 4c4 5 4 9 0 13-4-4-4-8 0-13z"/><path d="M8 22c0-7 7-10 16-10s16 3 16 10"/><circle cx="24" cy="28" r="8"/><path d="M11 30c1 7 6 12 13 13 7-1 12-6 13-13"/><path d="M24 36v8"/>',
  };
  const canonClass = cls => CLASS_ALIASES[String(cls || '').trim().toLowerCase()] || String(cls || '').trim();
  const classEmblem = cls => (CLASS_EMBLEMS[cls]
    ? `<svg class="emblem" viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${CLASS_EMBLEMS[cls]}</svg>`
    : '');
  const RACES = ['Elyos', 'Asmodian'];
  // Aion 2 Europe servers by faction (paired: Siel ↔ Israphel, Nezekan ↔ Zikel, Vaizel ↔ Triniel, Kaisinel ↔ Lumiel).
  const SERVER_REGION = 'Europe';
  const SERVERS = {
    Elyos: ['Siel', 'Nezekan', 'Vaizel', 'Kaisinel'],
    Asmodian: ['Israphel', 'Zikel', 'Triniel', 'Lumiel'],
  };
  const factionOfServer = s => RACES.find(r => SERVERS[r].includes(s)) || '';

  // <option>s for the server picklist; keeps a saved value that isn't in the list so it isn't lost.
  function serverOptions(faction, selected) {
    const opt = s => `<option value="${esc(s)}" ${s === selected ? 'selected' : ''}>${esc(s)}</option>`;
    const groups = (faction ? [faction] : RACES)
      .map(r => `<optgroup label="${r}">${SERVERS[r].map(opt).join('')}</optgroup>`).join('');
    const known = RACES.some(r => SERVERS[r].includes(selected));
    return `<option value="">Choose a server</option>${groups}${selected && !known ? `<option value="${esc(selected)}" selected>${esc(selected)} (not a Europe server)</option>` : ''}`;
  }
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const RARITIES = [
    { key: 'Common', color: '#cbd5e1', mult: 1 },
    { key: 'Superior', color: '#4ade80', mult: 1.1 },
    { key: 'Heroic', color: '#60a5fa', mult: 1.25 },
    { key: 'Fabled', color: '#fbbf24', mult: 1.45 },
    { key: 'Eternal', color: '#fb923c', mult: 1.7 },
    { key: 'Mythic', color: '#c084fc', mult: 2 },
  ];

  const GEAR_SLOTS = [
    ['main', 'Main Hand'], ['off', 'Off Hand'], ['helm', 'Helmet'], ['shoulders', 'Shoulders'],
    ['chest', 'Chest'], ['gloves', 'Gloves'], ['pants', 'Pants'], ['boots', 'Boots'], ['wings', 'Wings'],
    ['necklace', 'Necklace'], ['earring1', 'Earring I'], ['earring2', 'Earring II'],
    ['ring1', 'Ring I'], ['ring2', 'Ring II'], ['belt', 'Belt'],
  ].map(([key, label]) => ({ key, label }));

  const STAT_DEFS = [
    { key: 'hp', label: 'HP', w: 0.02 },
    { key: 'attack', label: 'Attack', w: 1.5 },
    { key: 'defense', label: 'Defense', w: 0.8 },
    { key: 'accuracy', label: 'Accuracy', w: 0.4 },
    { key: 'crit', label: 'Crit Strike', w: 0.5 },
    { key: 'critDmg', label: 'Crit Damage %', w: 2 },
    { key: 'evasion', label: 'Evasion', w: 0.4 },
    { key: 'parry', label: 'Parry', w: 0.3 },
    { key: 'block', label: 'Block', w: 0.3 },
    { key: 'magicBoost', label: 'Magic Boost', w: 0.6 },
    { key: 'magicAcc', label: 'Magic Accuracy', w: 0.4 },
    { key: 'magicResist', label: 'Magic Resist', w: 0.4 },
  ];

  const TZ_SUGGEST = ['Asia/Qatar', 'UTC', 'Asia/Seoul', 'Asia/Taipei', 'Asia/Tokyo', 'Europe/London',
    'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney'];

  const USER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  /* Official Aion 2 activity list, shared by everyone. Each entry has a permanent key.
     To change everyone's lists, edit this list and publish:
       - New activity:      add an entry with a new key.
       - Changed activity:  edit its fields and raise its rev (e.g. rev: 2). Each person gets the new
                            values for every field they haven't changed themselves.
       - Removed from game: add retired: true and raise rev. It's hidden (not deleted) for everyone.
     People's own activities, renames, hidden or deleted activities, and progress are always kept. */
  const CATALOG = [
    { kind: 'daily', key: 'daily.duty-missions', rev: 1, name: 'Duty Missions', count: 5, desc: 'Server daily completions',
      location: 'Journal → Duty', mainOnly: true,
      info: 'Duty Missions can only be completed once per server each day. You can\'t do them on your alts, only on your main character.' },
    { kind: 'daily', key: 'daily.supply-requests', rev: 1, name: 'Daily Supply Requests', count: 1, desc: 'Complete the daily Supply Request' },
    { kind: 'daily', key: 'daily.expedition-conquest', rev: 1, name: 'Expedition Conquest', count: 1, desc: 'Daily Expedition Conquest' },
    { kind: 'daily', key: 'daily.transcendence', rev: 1, name: 'Transcendence', count: 1, desc: 'Arcana + Stigma' },
    { kind: 'daily', key: 'daily.nightmares', rev: 1, name: 'Nightmares', count: 2, desc: 'Daily Nightmare entries' },

    { kind: 'weekly', key: 'weekly.dungeons', rev: 1, name: 'Weekly Dungeons', count: 14, desc: '14 dungeon entries, track each run' },
    { kind: 'weekly', key: 'weekly.sanctuary', rev: 1, name: 'Sanctuary', count: 1, desc: '10-player weekly raid' },
    { kind: 'weekly', key: 'weekly.ascension-trials', rev: 1, name: 'Ascension Trials', count: 3, desc: 'Stigma Shards + Daevanion Ariel rewards' },
    { kind: 'weekly', key: 'weekly.nightmares', rev: 1, name: 'Nightmares', count: 14, desc: '14 weekly Nightmare entries' },
    { kind: 'weekly', key: 'weekly.command-missions', rev: 1, name: 'Command Mission / Weekly Contracts', count: 12, desc: '12 missions per week' },
    { kind: 'weekly', key: 'weekly.abyss-commands', rev: 1, name: 'Abyss Commands', count: 20, desc: '20 weekly Abyss Command entries' },
    { kind: 'weekly', key: 'weekly.shop', rev: 1, name: 'Weekly Shop', count: 1, desc: 'Odyle Energy and other weekly shop rewards' },
    { kind: 'weekly', key: 'weekly.shugo-festival', rev: 1, name: 'Shugo Festival', count: 14, desc: 'Weekly Shugo Festival entries' },
    { kind: 'weekly', key: 'weekly.abyss-points-cap', rev: 1, name: 'Weekly Abyss Points Cap', count: 1, desc: 'Track whether the weekly Abyss Points cap has been reached' },
    { kind: 'weekly', key: 'weekly.battlefield-pvp', rev: 1, name: 'Battlefield PvP', count: 3, desc: 'Weekly Battlefield PvP entries' },
    { kind: 'weekly', key: 'weekly.abyss-corridors', rev: 1, name: 'Abyss Corridors', count: 3, desc: 'Weekly Abyss Corridor entries' },
    { kind: 'weekly', key: 'weekly.dimensional-invasion', rev: 1, name: 'Dimensional Invasion', count: 14, desc: 'Weekly Dimensional Invasion rewards' },

    { kind: 'static', key: 'static.regional-quests', rev: 1, name: 'Regional Quests' },
    { kind: 'static', key: 'static.sealed-dungeons', rev: 1, name: 'Sealed Dungeons' },
    { kind: 'static', key: 'static.strongholds', rev: 1, name: 'Strongholds' },
    { kind: 'static', key: 'static.empyrean-trace', rev: 1, name: 'Empyrean Trace Collection' },
    { kind: 'static', key: 'static.region-completion', rev: 1, name: 'Region Completion' },
    { kind: 'static', key: 'static.abyss-progression', rev: 1, name: 'Abyss Progression' },
    { kind: 'static', key: 'static.one-time-rewards', rev: 1, name: 'Important One-Time Rewards' },
    { kind: 'static', key: 'static.collection-objectives', rev: 1, name: 'Collection Objectives' },
  ];
  const CATALOG_FIELDS = ['name', 'count', 'desc', 'location', 'info', 'mainOnly'];

  /* Leveling roadmap: phases by character level, each with tasks to tick (per character) and
     guidance. Task keys are permanent; progress is stored as c.roadmap.done[key]. `guide` links
     a guidance line to a Guide card. */
  const ROADMAP = [
    { key: 'p1', min: 1, max: 10, levels: 'Level 1–10', name: 'Ishalgen',
      tasks: [['p1.main-story', 'Main Story'], ['p1.ascension', 'Ascension'], ['p1.start-gathering', 'Start Gathering'],
        ['p1.hideouts', 'Early Hideouts (as encountered)'], ['p1.stronghold', 'Early Stronghold']],
      guidance: [['Main Story drives progression.'], ['Gather nodes you pass — don\'t go out of your way, but don\'t ignore them.', 'gathering'],
        ['Gathering Essentials quest unlocks after Level 10.'], ['Do Hideouts as you find them; they give good rewards.'],
        ['Early Stronghold: do as encountered.'], ['Pet/Mount Soul collection happens naturally while questing.', 'pet']] },
    { key: 'p2', min: 10, max: 25, levels: 'Level 10–25', name: 'Early Game',
      tasks: [['p2.main-story', 'Main Story'], ['p2.krao-easy', 'Krao Cave — Easy (200 GS)'], ['p2.hideouts', 'Hideouts (as encountered)'],
        ['p2.strongholds', 'Strongholds (as available)'], ['p2.gathering', 'Gathering (maintain naturally)']],
      guidance: [['Main Story + natural side activities.'], ['Strongholds: do them as they unlock — good XP and rewards.'],
        ['Gathering: maintain naturally; Gathering Essentials unlocks after Level 10.', 'gathering'],
        ['Pet/Mount Soul collection happens naturally while questing.', 'pet'],
        ['Side Quests before Level 30: do not prioritize for Accessories/Jewelry.', 'sidequests']] },
    { key: 'p3', min: 25, max: 40, levels: 'Level 25–40', name: 'Midgame',
      tasks: [['p3.main-story', 'Main Story'], ['p3.urugugu-easy', 'Urugugu Canyon — Easy (300 GS)'], ['p3.fire-temple-easy', 'Fire Temple — Easy (500 GS)'],
        ['p3.hideouts', 'Hideouts (as encountered)'], ['p3.strongholds', 'Strongholds (as available)'], ['p3.gathering', 'Gathering (maintain naturally)'],
        ['p3.side-accessories', 'Check Side Quests for Accessories'], ['p3.daevanion', 'Daevanion Board (Stat Tree)'], ['p3.stigma', 'Stigma']],
      guidance: [['Main Story + steady side progression.'], ['Gathering: maintain naturally; Odellium becomes important.', 'gathering'],
        ['Daevanion/Stigma: keep them current with your level.'], ['After Level 30: Side Quest Jewelry/Accessories can be considered.', 'sidequests']] },
    { key: 'p4', min: 40, max: 45, levels: 'Level 40–45', name: 'Pre-Cap', desc: 'Prepare for the Level 45 cap and Gear Score requirements.',
      tasks: [['p4.finish-main-story', 'Finish Main Story'], ['p4.strongholds', 'Strongholds'], ['p4.gathering', 'Gathering (maintain naturally)'],
        ['p4.side-accessories', 'Check Side Quests for Accessories'], ['p4.stigma', 'Stigma'], ['p4.daevanion', 'Daevanion Board (Stat Tree)'],
        ['p4.hideouts', 'Hideouts (as you encounter)'], ['p4.krao-conquest', 'Krao Cave — Conquest (700 GS)']],
      guidance: [['Finish Main Story, then gear up for cap.'], ['Enchanting: active priority — Weapon → Armor → Belt → Accessories.', 'enchanting'],
        ['Gathering: maintain naturally for Odellium access.', 'gathering'], ['Strongholds: continue as available.'],
        ['Hideouts: do as you encounter them.'], ['Krao Cave — Conquest (700 GS): clear it as a milestone.']] },
    { key: 'p5', min: 45, max: Infinity, levels: 'Level 45', name: 'Level 45 Cap',
      desc: 'The current progression cap. Progression changes from leveling to optimization and completion.',
      tasks: [['p5.draupnir-easy', 'Draupnir — Easy (700 GS)'], ['p5.vakron-easy', 'Vakron Sky Island — Easy (1400 GS)'], ['p5.dungeons', 'Available Dungeons'],
        ['p5.expeditions', 'Expeditions'], ['p5.abyss', 'Abyss'], ['p5.gear', 'Gear optimization'], ['p5.stigma', 'Stigma optimization'],
        ['p5.daevanion', 'Daevanion Board (Stat Tree)'], ['p5.gathering', 'Gathering (maintain naturally)'], ['p5.stronghold', 'Stronghold'],
        ['p5.hideouts', 'Hideouts'], ['p5.nightmare', 'Nightmare'], ['p5.feathers', 'Feather collection'], ['p5.spacetime-rift', 'Spacetime Rift'],
        ['p5.rift-strongholds', 'Rift Strongholds / Hideouts']],
      guidance: [['Optimize gear, stigma, daevanion for your build.'], ['Run dungeons/expeditions for gear progression.'],
        ['Abyss for AP/gear if interested in PvP.'], ['Gathering: maintain naturally for Odellium access.', 'gathering'],
        ['Strongholds, Hideouts, Nightmare, Feather collection, Spacetime Rift, Rift Strongholds/Hideouts: endgame progression.']] },
  ];
  const ROADMAP_TOTAL = ROADMAP.reduce((n, p) => n + p.tasks.length, 0);

  /* Important Progression Rules (information only). Lines with warn: true are highlighted. */
  const GUIDE = [
    { key: 'pet', icon: 'paw', title: 'Pet / Mount',
      tagline: 'Account-wide progression — collect once, benefit all characters. Unlocks after the Level 10 "Gathering Essentials" quest.',
      lines: ['Kill monsters → obtain Soul Shards → collect 10 → unlock Pet/Mount.', 'Pets become Mounts.',
        'Pet/Mount stats and buffs are account-wide and shared between characters.',
        'Pet/Mount progression becomes available after completing the Level 10 "Gathering Essentials" quest.',
        'Pet/Mount collection is a parallel progression system.', 'Early priority should be collection rather than heavily farming one creature.',
        { warn: true, text: 'Do not stop leveling to farm Souls. Kill monsters naturally while passing through areas during quests and collect Soul Shards as you progress.' }] },
    { key: 'enchanting', icon: 'sparkle', title: 'Enchanting', tagline: 'Conserve resources for Level 45 gear.',
      lines: ['Try not to heavily enchant gear before Level 45 — leveling gear is disposable and gets replaced quickly.',
        'Weapon: a few upgrades are okay if you are struggling.', 'Avoid heavily enchanting temporary armor/accessories.',
        'Do not waste enhancement materials on gear that will soon be replaced.',
        { warn: true, text: 'Rune warning: do not recklessly break/use your runes. If an enhancement fails and the rune breaks, you will need to wait until you obtain more later.' }] },
    { key: 'manastones', icon: 'gem', title: 'Manastones', tagline: 'Use wisely on leveling gear — save for Level 45.',
      lines: ['Manastones can be used on leveling gear if needed.', 'You can use a Manastone once if needed.',
        'Do not keep rerolling or repeatedly replacing Manastones on temporary leveling gear.', 'You will need Manastones later for better gear.',
        'Avoid spending too many resources on gear that will soon be replaced.',
        'Use resources when they give a meaningful benefit, but avoid heavily investing in temporary gear before Level 45.',
        { warn: true, text: 'Manastones are limited. Do not waste them on gear you will replace at Level 45.' }] },
    { key: 'kinah', icon: 'coin', title: 'Kinah', tagline: 'The most important resource — save it.',
      lines: ['Kinah is needed for crafting, enchanting, buying items and other progression expenses.',
        { warn: true, text: 'Do not waste your Kinah. Save Kinah while leveling.' }] },
    { key: 'sidequests', icon: 'note', title: 'Side Quests', tagline: 'Check for valuable rewards — don\'t do all of them.',
      lines: ['Check side quests for useful rewards, especially while leveling toward Level 45 through the Main Quest.',
        'Do not complete every side quest automatically.', 'Prioritize side quests that give useful gear, important items or valuable rewards.',
        { warn: true, text: 'Jewelry rule: before Level 30, don\'t prioritize Jewelry/Accessories from side quests. After Level 30 they can become useful.' }] },
    { key: 'gathering', icon: 'leaf', title: 'Gathering', tagline: 'Level naturally while questing — avoid dedicated sessions later.',
      lines: ['Gather naturally while questing — nodes you pass; don\'t go out of your way.',
        'Top gear needs rare Odellium; gathering occasionally while questing prevents a long 1–2 hour gathering session later.',
        'Other players also compete for gathering nodes.', 'Gathering should generally be leveled naturally while progressing.',
        'Do not necessarily stop leveling for long dedicated gathering sessions.',
        'Gathering levels are recommended targets, not hard requirements. You decide how much you want to gather.'] },
  ];

  // The official values of one catalog entry, in the same shape as a task.
  function officialOf(e) {
    return { name: e.name, count: e.count || 1, desc: e.desc || '', location: e.location || '', info: e.info || '', mainOnly: !!e.mainOnly };
  }

  // A task made from a catalog entry. Its id comes from the key, so every device creates the same one.
  function catalogTask(e) {
    return normTask({ id: 'cat-' + e.key, ...officialOf(e), key: e.key, rev: e.rev, official: officialOf(e), off: !!e.retired });
  }

  function defaultTasks() {
    const tasks = { daily: [], weekly: [], static: [] };
    for (const e of CATALOG) if (!e.retired) tasks[e.kind].push(catalogTask(e));
    return tasks;
  }

  // Brings a saved task list up to date with the official list (see CATALOG). Returns the names of
  // activities that were added, so the person can be told. Runs whenever data is loaded.
  const lower = s => String(s || '').trim().toLowerCase();
  function applyCatalog(s) {
    const added = [];
    if (!s.catalog) {
      // First run for data saved before the official list existed: link tasks to it by name, and
      // treat everything in today's list as already offered (so deleted ones don't come back).
      for (const e of CATALOG) {
        const t = s.tasks[e.kind].find(x => !x.key && lower(x.name) === lower(e.name));
        if (t) Object.assign(t, { key: e.key, rev: e.rev, official: officialOf(e) });
      }
      s.catalog = { seen: CATALOG.map(e => e.key) };
      return added;
    }
    const seen = new Set(s.catalog.seen);
    for (const e of CATALOG) {
      const list = s.tasks[e.kind];
      const t = list.find(x => x.key === e.key);
      if (!seen.has(e.key)) {           // new in the official list
        seen.add(e.key);
        if (!t && !e.retired) { list.push(catalogTask(e)); added.push(e.name); }
        continue;
      }
      if (!t || num(t.rev) >= e.rev) continue; // deleted by the person, or already up to date
      const was = t.official || {};
      const now = officialOf(e);
      for (const f of CATALOG_FIELDS) {
        if (was[f] === undefined || t[f] === was[f]) t[f] = now[f]; // only fields they haven't changed
      }
      if (e.retired) t.off = true;
      t.official = now;
      t.rev = e.rev;
    }
    s.catalog.seen = Array.from(seen);
    return added;
  }
  let catalogAdded = []; // names added on this load, announced once the page is up

  function announceCatalog() {
    if (!catalogAdded.length) return;
    const names = catalogAdded.slice(0, 3).join(', ') + (catalogAdded.length > 3 ? ` and ${catalogAdded.length - 3} more` : '');
    toast(`New Aion 2 ${catalogAdded.length === 1 ? 'activity' : 'activities'} added: ${names}. Hide any you don't need in Settings → Tasks.`, { type: 'ok', timeout: 9000 });
    catalogAdded = [];
  }

  function defaultScoring() {
    return {
      ilvlWeight: 1,
      enchantWeight: 12,
      rarity: Object.fromEntries(RARITIES.map(r => [r.key, r.mult])),
      stats: Object.fromEntries(STAT_DEFS.map(s => [s.key, s.w])),
    };
  }

  // Aion 2 weekly reset: Wednesday 09:00 server time = 16:00 Qatar time (AST, UTC+3).
  function defaultSchedule() {
    return { tz: 'Asia/Qatar', daily: { hour: 16, minute: 0 }, weekly: { weekday: 3, hour: 16, minute: 0 } };
  }

  function defaultState() {
    return {
      schema: SCHEMA,
      settings: { ...defaultSchedule(), theme: 'dark', riftAlert: normRiftAlert(), scoring: defaultScoring() },
      tasks: defaultTasks(),
      catalog: { seen: CATALOG.map(e => e.key) },
      characters: [],
      history: [],
      ui: { active: 'overview' },
    };
  }

  /* ---------- 2. Helpers ---------- */

  function uid() {
    return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  }
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const num = (v, d = 0) => { const n = Number(v); return v !== '' && v !== null && Number.isFinite(n) ? n : d; };
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const clone = v => JSON.parse(JSON.stringify(v));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const fmtInt = n => Math.round(num(n)).toLocaleString();
  const fmtNum = (n, d = 1) => num(n).toLocaleString(undefined, { maximumFractionDigits: d });
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const pad2 = n => String(n).padStart(2, '0');

  const fmtWhen = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtDayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  const fmtTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

  function fmtDur(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (d) return `${d}d ${h}h ${m}m`;
    if (h) return `${h}h ${pad2(m)}m ${pad2(sec)}s`;
    return `${m}m ${pad2(sec)}s`;
  }

  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    checkAll: '<path d="M2 12.5l4.5 4.5L15 8"/><path d="M10.5 16.5l.5.5L21.5 7"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7M8 11h7"/>',
    rift: '<circle cx="12" cy="12" r="9"/><path d="M12 3c-3 3-3 15 0 18M12 3c3 3 3 15 0 18"/><circle cx="12" cy="12" r="2.2"/>',
    bell: '<path d="M6 16v-5a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    play: '<path d="M8 5v14l11-7z"/>',
    mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 5M22 9l-5 5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    paw: '<circle cx="7" cy="9" r="1.8"/><circle cx="12" cy="6.5" r="1.8"/><circle cx="17" cy="9" r="1.8"/><path d="M12 12c-3 0-5 3-5 5a2 2 0 0 0 2 2c1.2 0 1.8-.6 3-.6s1.8.6 3 .6a2 2 0 0 0 2-2c0-2-2-5-5-5z"/>',
    sparkle: '<path d="M12 3l2 5.5L19.5 10 14 12l-2 6-2-6-5.5-2L10 8.5z"/>',
    gem: '<path d="M6 3h12l3 6-9 12L3 9z"/><path d="M3 9h18M9 3l3 18M15 3l-3 18"/>',
    coin: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4"/>',
    leaf: '<path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15z"/><path d="M5 19l8-8"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    history: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.2 6.2C3.6 7.9 2 12 2 12s3.6 7 10 7c1.6 0 3-.3 4.2-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    up: '<path d="M6 15l6-6 6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M5 21h14"/>',
    alert: '<path d="M12 3.5l9.5 17h-19z"/><path d="M12 10v4.5M12 17.5v.01"/>',
    sword: '<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    infinity: '<path d="M7 8.5c-2 0-3.5 1.6-3.5 3.5S5 15.5 7 15.5c3.5 0 6.5-7 10-7 2 0 3.5 1.6 3.5 3.5s-1.5 3.5-3.5 3.5c-3.5 0-6.5-7-10-7z"/>',
    crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
    pin: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.01"/>',
    infoMark: '<path d="M12 10.5v7M12 6.5v.01"/>', // just the "i", for use inside a round button
    note: '<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4M8 12h8M8 16h6"/>',
    pin: '<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/>',
    news: '<path d="M4 5h13v14H6a2 2 0 0 1-2-2z"/><path d="M17 8h3v9a2 2 0 0 1-2 2"/><path d="M7 9h7M7 12h7M7 15h4"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  };
  const icon = name => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;

  const LOGO = `<svg class="logo" viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="lg-logo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9fb4ff"/><stop offset="1" stop-color="#c084fc"/></linearGradient></defs><path d="M24 6l7 18-7 18-7-18z" fill="url(#lg-logo)"/><path d="M17 24C12 15 6 13 2 13c4 4 6 10 7 16 3-3 6-4 8-5zM31 24c5-9 11-11 15-11-4 4-6 10-7 16-3-3-6-4-8-5z" fill="url(#lg-logo)" opacity=".6"/></svg>`;

  /* ---------- 3. State ---------- */

  function normTask(t) {
    return {
      id: String((t && t.id) || uid()),
      name: String(t && t.name != null ? t.name : 'Task').slice(0, 80) || 'Untitled task',
      count: clamp(Math.round(num(t && t.count, 1)), 1, 99),
      desc: String((t && t.desc) || '').slice(0, 120),
      location: String((t && t.location) || '').slice(0, 60),
      info: String((t && t.info) || '').slice(0, 400),
      mainOnly: !!(t && t.mainOnly),
      off: !!(t && t.off), // hidden in Settings: shown to no one and not counted until shown again
      // Link to the official list (CATALOG); empty for activities people add themselves.
      key: t && t.key ? String(t.key) : '',
      rev: num(t && t.rev),
      official: t && isObj(t.official) ? { ...t.official } : null,
    };
  }

  function normTime(t, d) {
    return {
      hour: clamp(Math.round(num(t && t.hour, d.hour)), 0, 23),
      minute: clamp(Math.round(num(t && t.minute, d.minute)), 0, 59),
    };
  }

  function normNote(n) {
    return {
      id: String(n.id || uid()),
      text: String(n.text || '').slice(0, NOTE_LEN).trim(),
      charId: n.charId ? String(n.charId) : '', // '' = General note
      pinned: !!n.pinned,
      created: num(n.created, Date.now()),
      updated: num(n.updated, num(n.created, Date.now())),
    };
  }

  function normChar(c) {
    c = isObj(c) ? c : {};
    const period = x => ({ period: num(x && x.period), prog: isObj(x && x.prog) ? x.prog : {} });
    return {
      id: String(c.id || uid()),
      name: String(c.name || 'Unnamed').slice(0, 40),
      role: c.role === 'main' ? 'main' : 'alt',
      cls: canonClass(c.cls).slice(0, 30), // e.g. Spiritmaster → Elementalist
      race: String(c.race || '').slice(0, 30),
      level: clamp(Math.round(num(c.level, 1)), 1, 999),
      server: String(c.server || '').slice(0, 40),
      notes: String(c.notes || '').slice(0, 500),
      gameCp: clamp(Math.round(num(c.gameCp)), 0, 999999), // in-game Combat Power, entered by the player
      // 'auto' = calculated from stats and gear, 'manual' = gameCp. Older saves with a typed CP stay manual.
      cpMode: c.cpMode === 'manual' || c.cpMode === 'auto' ? c.cpMode : (num(c.gameCp) > 0 ? 'manual' : 'auto'),
      created: num(c.created, Date.now()),
      hidden: isObj(c.hidden) ? c.hidden : {},
      stats: isObj(c.stats) ? c.stats : {},
      gear: isObj(c.gear) ? c.gear : {},
      daily: period(c.daily),
      weekly: { ...period(c.weekly), log: Array.isArray(c.weekly && c.weekly.log) ? c.weekly.log : [] },
      static: { prog: isObj(c.static && c.static.prog) ? c.static.prog : {} }, // one-time: never resets
      roadmap: { done: isObj(c.roadmap && c.roadmap.done) ? c.roadmap.done : {} }, // leveling roadmap ticks
    };
  }

  // Fills in anything missing so that data saved by older versions of the app keeps working.
  function normalize(raw) {
    const d = defaultState();
    if (!isObj(raw)) return d;
    const rs = isObj(raw.settings) ? raw.settings : {};
    const sc = isObj(rs.scoring) ? rs.scoring : {};
    const rt = isObj(raw.tasks) ? raw.tasks : {};
    const oldSchema = num(raw.schema, 0);
    const characters = Array.isArray(raw.characters) ? raw.characters.map(normChar) : [];
    // Exactly one main at most. Data from before roles existed: the first character becomes the main.
    const firstMain = characters.find(c => c.role === 'main') || (oldSchema < 2 ? characters[0] : null);
    for (const c of characters) c.role = c === firstMain ? 'main' : 'alt';
    // Version 2 replaced the placeholder task lists with the Aion 2 activities.
    const useSavedTasks = oldSchema >= 2;
    const s = {
      schema: SCHEMA,
      settings: {
        tz: validTz(rs.tz) ? rs.tz : d.settings.tz,
        theme: rs.theme === 'light' ? 'light' : 'dark', // dark is the default look
        riftAlert: normRiftAlert(rs.riftAlert),
        daily: normTime(rs.daily, d.settings.daily),
        weekly: {
          weekday: clamp(Math.round(num(rs.weekly && rs.weekly.weekday, 3)), 0, 6),
          ...normTime(rs.weekly, d.settings.weekly),
        },
        scoring: {
          ilvlWeight: num(sc.ilvlWeight, 1),
          enchantWeight: num(sc.enchantWeight, 12),
          rarity: { ...d.settings.scoring.rarity, ...(isObj(sc.rarity) ? sc.rarity : {}) },
          stats: { ...d.settings.scoring.stats, ...(isObj(sc.stats) ? sc.stats : {}) },
        },
      },
      tasks: {
        daily: useSavedTasks && Array.isArray(rt.daily) ? rt.daily.map(normTask) : d.tasks.daily,
        weekly: useSavedTasks && Array.isArray(rt.weekly) ? rt.weekly.map(normTask) : d.tasks.weekly,
        static: useSavedTasks && Array.isArray(rt.static) ? rt.static.map(normTask) : d.tasks.static,
      },
      characters,
      notes: (Array.isArray(raw.notes) ? raw.notes : []).filter(isObj).map(normNote).filter(n => n.text).slice(0, NOTES_MAX),
      history: Array.isArray(raw.history)
        ? raw.history.filter(h => isObj(h) && num(h.start) && Array.isArray(h.chars)).sort((a, b) => b.start - a.start)
        : [],
      ui: {
        active: isObj(raw.ui) && typeof raw.ui.active === 'string' ? raw.ui.active : 'overview',
        heatMonths: HEAT_RANGES.includes(num(isObj(raw.ui) && raw.ui.heatMonths)) ? num(raw.ui.heatMonths) : 1,
        newsSeenAt: num(isObj(raw.ui) && raw.ui.newsSeenAt, 0), // newest announcement this device has seen
        sideTab: SIDE_TABS.some(([k]) => isObj(raw.ui) && raw.ui.sideTab === k) ? raw.ui.sideTab : 'history',
      },
      updatedAt: num(raw.updatedAt, 0), // last change made by the person; decides which copy wins when syncing
      // Which official activities this person has already been offered (see CATALOG).
      catalog: !useSavedTasks ? d.catalog
        : isObj(raw.catalog) && Array.isArray(raw.catalog.seen) ? { seen: raw.catalog.seen.map(String) } : null,
    };
    const added = applyCatalog(s);
    for (const name of added) if (!catalogAdded.includes(name)) catalogAdded.push(name);
    return s;
  }

  function load() {
    try {
      return normalize(JSON.parse(localStorage.getItem(STORE_KEY)));
    } catch (e) {
      return defaultState();
    }
  }

  // Saves to this browser, and (for changes the person made) queues a cloud sync.
  // Pass {sync: false} for device-only changes: the open tab, and automatic resets
  // (every device runs those itself, so they never need to be uploaded on their own).
  let saveWarned = false;
  function save(opts = {}) {
    const sync = opts.sync !== false;
    if (sync) state.updatedAt = Date.now();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      saveWarned = false;
    } catch (e) {
      if (!saveWarned) toast('Could not save in this browser: storage is full or blocked.', { type: 'bad', timeout: 8000 });
      saveWarned = true;
    }
    if (sync) scheduleSync();
  }

  let state = load();
  const statsDrafts = {};      // charId -> unsaved stat values
  const manageMode = new Set(); // "charId:kind" lists showing show/hide toggles

  const getChar = id => state.characters.find(c => c.id === id);

  /* ---------- 4. Time zones and reset schedule ---------- */

  const dtfCache = new Map();
  function dtf(tz) {
    let f = dtfCache.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
      });
      dtfCache.set(tz, f);
    }
    return f;
  }

  function validTz(tz) {
    if (typeof tz !== 'string' || !tz.trim()) return false;
    try { dtf(tz); return true; } catch (e) { return false; }
  }

  // Wall-clock parts of instant t in zone tz.
  function wall(tz, t) {
    const p = {};
    for (const part of dtf(tz).formatToParts(new Date(t))) p[part.type] = part.value;
    const y = +p.year, m = +p.month - 1, d = +p.day;
    return { y, m, d, h: (+p.hour) % 24, mi: +p.minute, s: +p.second, wd: new Date(Date.UTC(y, m, d)).getUTCDay() };
  }

  function offsetMs(tz, t) {
    const w = wall(tz, t);
    return Date.UTC(w.y, w.m, w.d, w.h, w.mi, w.s) - Math.floor(t / 1000) * 1000;
  }

  // Instant for a wall-clock time in zone tz (day may overflow; Date.UTC normalizes it).
  function zoned(tz, y, m, d, h, mi) {
    const guess = Date.UTC(y, m, d, h, mi);
    const first = guess - offsetMs(tz, guess);
    return guess - offsetMs(tz, first);
  }

  function lastReset(now, tz, hour, minute, weekday) {
    const w = wall(tz, now);
    const weekly = weekday != null;
    const back = weekly ? (w.wd - weekday + 7) % 7 : 0;
    let t = zoned(tz, w.y, w.m, w.d - back, hour, minute);
    if (t > now) t = zoned(tz, w.y, w.m, w.d - back - (weekly ? 7 : 1), hour, minute);
    return t;
  }

  function nextReset(now, tz, hour, minute, weekday) {
    const last = lastReset(now, tz, hour, minute, weekday);
    const w = wall(tz, last);
    return zoned(tz, w.y, w.m, w.d + (weekday != null ? 7 : 1), hour, minute);
  }

  function schedule(settings = state.settings, now = Date.now()) {
    const { tz, daily: d, weekly: w } = settings;
    return {
      dailyStart: lastReset(now, tz, d.hour, d.minute, null),
      dailyNext: nextReset(now, tz, d.hour, d.minute, null),
      weeklyStart: lastReset(now, tz, w.hour, w.minute, w.weekday),
      weeklyNext: nextReset(now, tz, w.hour, w.minute, w.weekday),
    };
  }

  /* ---------- 5. Progress, resets and weekly history ---------- */

  // Tasks that apply to this character: hidden-in-Settings tasks are left out for everyone,
  // main-only tasks (e.g. Duty Missions) for alts.
  const applicableTasks = (c, kind) => state.tasks[kind].filter(t => !t.off && (!t.mainOnly || c.role === 'main'));
  const visibleTasks = (c, kind) => applicableTasks(c, kind).filter(t => !c.hidden[t.id]);
  const orderedChars = () => state.characters.slice().sort((a, b) => (b.role === 'main') - (a.role === 'main'));
  const mainChar = () => state.characters.find(c => c.role === 'main');
  const progOf = (c, kind, t) => clamp(Math.round(num(c[kind].prog[t.id])), 0, t.count);

  function summary(c, kind) {
    const ts = visibleTasks(c, kind);
    const done = ts.filter(t => progOf(c, kind, t) >= t.count).length;
    return { done, total: ts.length, pct: ts.length ? Math.round((done / ts.length) * 100) : 0 };
  }

  function snapshotChar(c, includeToday) {
    const k = calc(c);
    const days = c.weekly.log.slice();
    if (includeToday) {
      const s = summary(c, 'daily');
      days.push({ start: c.daily.period, done: s.done, total: s.total, live: true });
    }
    return {
      id: c.id, name: c.name, cls: c.cls, level: c.level,
      weekly: visibleTasks(c, 'weekly').map(t => ({ name: t.name, count: t.count, prog: progOf(c, 'weekly', t) })),
      days, gearScore: k.gearScore, cp: k.cp, gameCp: effectiveCp(c),
    };
  }

  function archiveWeek(c) {
    const start = c.weekly.period;
    let entry = state.history.find(h => h.start === start);
    if (!entry) {
      const s = state.settings;
      entry = { start, end: nextReset(start, s.tz, s.weekly.hour, s.weekly.minute, s.weekly.weekday), archivedAt: Date.now(), chars: [] };
      state.history.push(entry);
    }
    entry.chars = entry.chars.filter(x => x.id !== c.id).concat(snapshotChar(c, false));
    state.history.sort((a, b) => b.start - a.start);
    if (state.history.length > HISTORY_LIMIT) state.history.length = HISTORY_LIMIT;
  }

  // Rolls every character into the current daily/weekly period.
  // The finished day is logged into its week; a finished week is archived to history.
  function processResets(now = Date.now()) {
    const sch = schedule(state.settings, now);
    let daily = false, weekly = false;
    for (const c of state.characters) {
      if (c.daily.period !== sch.dailyStart) {
        if (c.daily.period) {
          const s = summary(c, 'daily');
          c.weekly.log.push({ start: c.daily.period, done: s.done, total: s.total });
        }
        c.daily = { period: sch.dailyStart, prog: {} };
        daily = true;
      }
      if (c.weekly.period !== sch.weeklyStart) {
        if (c.weekly.period) archiveWeek(c);
        c.weekly = { period: sch.weeklyStart, prog: {}, log: [] };
        weekly = true;
      }
    }
    if (daily || weekly) save({ sync: false });
    return { daily, weekly, sch };
  }

  /* ---------- 6. Stats and gear calculations ---------- */

  const rarityColor = key => (RARITIES.find(r => r.key === key) || RARITIES[0]).color;
  const isEquipped = g => !!g && (String(g.name || '').trim() !== '' || num(g.ilvl) > 0 || num(g.enchant) > 0);

  function itemScore(g, sc = state.settings.scoring) {
    if (!isEquipped(g)) return 0;
    const mult = num(sc.rarity[g.rarity], 1);
    return num(g.ilvl) * num(sc.ilvlWeight) * mult + num(g.enchant) * num(sc.enchantWeight);
  }

  function calc(c, stats = c.stats, gear = c.gear) {
    const sc = state.settings.scoring;
    let gs = 0, ilvl = 0, ench = 0, n = 0;
    const items = GEAR_SLOTS.map(slot => {
      const g = gear[slot.key];
      const on = isEquipped(g);
      const score = on ? itemScore(g, sc) : 0;
      if (on) { gs += score; ilvl += num(g.ilvl); ench += num(g.enchant); n++; }
      return { slot, g: on ? g : null, score };
    });
    let statScore = 0;
    for (const d of STAT_DEFS) statScore += num(stats[d.key]) * num(sc.stats[d.key]);
    const emptySlot = items.find(i => !i.g);
    const weakest = emptySlot || items.slice().sort((a, b) => a.score - b.score)[0];
    return {
      gearScore: Math.round(gs), statScore: Math.round(statScore), cp: Math.round(gs + statScore),
      avgIlvl: n ? ilvl / n : 0, avgEnchant: n ? ench / n : 0, equipped: n, items, weakest,
    };
  }

  function lastWeekSnapshot(c) {
    for (const h of state.history) {
      const x = h.chars.find(y => y.id === c.id);
      if (x) return x;
    }
    return null;
  }

  /* ---------- 7. Rendering ---------- */

  const classColor = c => CLASS_COLORS[canonClass(c.cls)] || '#8aa4ff';
  const initials = name => (String(name).trim().match(/[\p{L}\p{N}]/gu) || ['?']).slice(0, 2).join('').toUpperCase();
  // Class emblem on the class colour; initials when no (known) class is set.
  const avatar = (c, size = '') => {
    const em = classEmblem(canonClass(c.cls));
    return `<span class="avatar ${size} ${em ? 'has-emblem' : ''}" style="--cc:${classColor(c)}" aria-hidden="true"
      ${em ? `title="${esc(canonClass(c.cls))}"` : ''}>${em || esc(initials(c.name))}</span>`;
  };
  const metaLine = c => [`Lv ${c.level}`, c.cls, c.race, c.server].filter(Boolean).map(esc).join(' <i>·</i> ');

  function renderShell() {
    $('#app').innerHTML = `
      <header class="topbar">
        <div class="brand">
          ${LOGO}
          <div>
            <h1>Aion 2 <span>Progress Tracker</span></h1>
            <p>Times shown in your time zone: <b>${esc(USER_TZ)}</b></p>
            <p class="sync-chip" id="sync-status" data-state="off" role="status" hidden></p>
          </div>
        </div>
        <div class="resets">
          <div class="reset-chip daily">
            <span class="rc-label">${icon('clock')} Daily reset</span>
            <span class="rc-when" data-when="daily"></span>
            <span class="rc-in">in <b data-countdown="daily"></b></span>
          </div>
          <div class="reset-chip weekly">
            <span class="rc-label">${icon('clock')} Weekly reset</span>
            <span class="rc-when" data-when="weekly"></span>
            <span class="rc-in">in <b data-countdown="weekly"></b></span>
          </div>
          <button class="reset-chip rift-chip" id="rift-chip" data-action="open-rift" title="Spacetime Rift portal schedule">
            <span class="rc-label">${icon('rift')} <span data-rift="label">Next portal</span><span class="rift-bell" data-rift="bell" title="Portal alert is on" hidden>${icon('bell')}</span></span>
            <span class="rc-when" data-rift="when"></span>
            <span class="rc-in"><span data-rift="prefix">in</span> <b data-rift="in"></b></span>
          </button>
        </div>
        <div class="top-actions">
          <button class="btn ghost news-btn" id="news-btn" data-action="open-news" title="Official AION 2 announcements" hidden>${icon('news')}<span>News</span><b class="news-badge" id="news-badge" hidden></b></button>
          <button class="btn ghost" data-action="open-guide" title="Important Progression Rules">${icon('book')}<span>Guide</span></button>
          <button class="btn ghost" data-action="open-history" title="Weekly history">${icon('history')}<span>History</span></button>
          <button class="btn ghost" data-action="open-settings" title="Tasks, resets and scoring">${icon('sliders')}<span>Settings</span></button>
          <button class="btn ghost theme-btn" id="theme-btn" data-action="toggle-theme"></button>
          <div id="account-slot" class="account-slot"></div>
        </div>
      </header>
      <div class="update-banner" id="update-banner" hidden>
        ${icon('refresh')}<span>A new version of the tracker is available. Your data is saved.</span>
        <button class="btn primary sm" data-action="reload-now">Reload now</button>
      </div>
      <nav class="tabs" id="tabs" aria-label="Characters"></nav>
      <main class="view" id="view"></main>
      <footer class="app-foot" id="app-foot">${storageSummary()} Back it up from Settings &rarr; Data.</footer>`;
  }

  function renderTabs() {
    const active = state.ui.active;
    const tabs = [`<button class="tab ${active === 'overview' ? 'is-active' : ''}" data-action="tab" data-id="overview" ${active === 'overview' ? 'aria-current="page"' : ''}>${icon('grid')}<span class="tab-name">Overview</span></button>`];
    for (const c of orderedChars()) {
      const d = summary(c, 'daily'), w = summary(c, 'weekly');
      const on = active === c.id;
      tabs.push(`<button class="tab ${on ? 'is-active' : ''} ${c.role === 'main' ? 'is-main' : ''}" data-action="tab" data-id="${esc(c.id)}" style="--cc:${classColor(c)}" ${on ? 'aria-current="page"' : ''}>
        ${c.role === 'main' ? `<span class="tab-crown" title="Main character">${icon('crown')}</span>` : '<span class="tab-dot"></span>'}<span class="tab-name">${esc(c.name)}</span>
        <span class="tab-meta" title="Daily ${d.done}/${d.total} · Weekly ${w.done}/${w.total}">${d.done}/${d.total} · ${w.done}/${w.total}</span>
      </button>`);
    }
    tabs.push(`<button class="tab tab-add" data-action="add-char" aria-label="Add character">${icon('plus')}</button>`);
    $('#tabs').innerHTML = tabs.join('');
  }

  function renderView() {
    if (state.ui.active !== 'overview' && !getChar(state.ui.active)) state.ui.active = 'overview';
    const c = getChar(state.ui.active);
    $('#view').innerHTML = c ? detailHTML(c) : overviewHTML();
    updateClocks();
    animateCp();
  }

  function render() {
    applyTheme();
    renderTabs();
    renderView();
  }

  // Light or dark look, saved with the person's settings (and synced with them).
  function applyTheme() {
    const light = state.settings.theme === 'light';
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', light ? '#f3f5fa' : '#0a0d17');
    const btn = $('#theme-btn');
    if (btn) {
      btn.innerHTML = icon(light ? 'moon' : 'sun');
      btn.title = light ? 'Switch to dark mode' : 'Switch to light mode';
      btn.setAttribute('aria-label', btn.title);
    }
  }

  // Re-renders and puts keyboard focus back on the control that was used.
  function rerender(el) {
    let sel = null;
    if (el && el.dataset && el.dataset.action) {
      const d = el.dataset;
      sel = `[data-action="${d.action}"]` + ['char', 'kind', 'task', 'value'].map(k => (d[k] ? `[data-${k}="${d[k]}"]` : '')).join('');
    }
    render();
    if (sel) {
      const target = $(sel, $('#view'));
      if (target) target.focus({ preventScroll: true });
    }
  }

  function bar(pct, label) {
    return `<div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(label)}"><span style="width:${pct}%"></span></div>`;
  }

  function overviewHTML() {
    if (!state.characters.length) {
      return `<section class="empty">
        ${LOGO}
        <h2>Track your first character</h2>
        <p>Add a character to get daily and weekly checklists that reset on their own, plus a stats and gear panel for each one.</p>
        <button class="btn primary lg" data-action="add-char">${icon('plus')} Add character</button>
        <p class="fine">Start with your main, then add your alts. Activity lists and reset times are in Settings.</p>
      </section>`;
    }
    let dd = 0, dt = 0, wd = 0, wt = 0;
    for (const c of state.characters) {
      const d = summary(c, 'daily'), w = summary(c, 'weekly');
      dd += d.done; dt += d.total; wd += w.done; wt += w.total;
    }
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    const alts = state.characters.filter(c => c.role !== 'main').length;
    const hasMain = !!mainChar();
    const ringTile = (kind, label, done, total) => {
      const p = pct(done, total);
      return `<div class="stat-tile ${kind} ${total && done >= total ? 'is-complete' : ''}" style="--p:${p}%">
        <span class="st-ring" role="img" aria-label="${p}% of ${label.toLowerCase()}"><i>${p}%</i></span>
        <div class="st-body">
          <small>${label}</small>
          <b>${done}<i>/${total}</i></b>
          <span class="st-sub">${icon('clock')}resets in <span data-countdown="${kind}"></span></span>
        </div>
      </div>`;
    };
    return `
      <section class="stats-strip">
        <div class="stat-tile chars">
          <span class="st-icon">${icon('grid')}</span>
          <div class="st-body">
            <small>Characters</small>
            <b>${state.characters.length}</b>
            <span class="st-sub">${hasMain ? `${icon('crown')}1 main · ` : ''}${alts} alt${alts === 1 ? '' : 's'} · ${state.history.length} week${state.history.length === 1 ? '' : 's'} archived</span>
          </div>
        </div>
        ${ringTile('daily', 'Dailies done', dd, dt)}
        ${ringTile('weekly', 'Weeklies done', wd, wt)}
      </section>
      ${mainChar() ? '' : `<p class="notice">${icon('crown')}<span>No main character is set. Server-wide dailies such as Duty Missions only show on your main. Open a character and choose <b>Make main</b>.</span></p>`}
      <section class="card-grid">${orderedChars().map(charCardHTML).join('')}</section>`;
  }

  const roleBadge = c => (c.role === 'main'
    ? `<span class="role-badge main">${icon('crown')}Main</span>`
    : '<span class="role-badge alt">Alt</span>');

  function charCardHTML(c) {
    const k = calc(c);
    return `<article class="char-card ${c.role === 'main' ? 'is-main' : ''}" style="--cc:${classColor(c)}">
      <header class="char-head">
        ${avatar(c)}
        <div class="char-id"><h3>${esc(c.name)} ${roleBadge(c)}</h3><p>${metaLine(c)}</p></div>
        ${(() => {
          const game = effectiveCp(c);
          if (!game) return `<div class="cp-pill" title="No Combat Power yet: add stats and gear, or switch to Manual on the character page."><small>CP</small><b>—</b></div>`;
          const t = cpTier(game);
          return `<div class="cp-pill tiered tier-${t.key}" style="--tc:${t.color}" title="Combat Power (${c.cpMode === 'manual' ? 'manual' : 'auto'}) · ${esc(t.name)}"><small>CP</small><b>${fmtInt(game)}</b></div>`;
        })()}
      </header>
      ${checklistHTML(c, 'daily')}
      ${checklistHTML(c, 'weekly')}
      ${(() => {
        const s = summary(c, 'static');
        return s.total ? `<div class="static-line ${s.done === s.total ? 'is-complete' : ''}" title="One-time content">
          ${icon('infinity')}<span>One-time</span>${bar(s.pct, `One-time progress for ${c.name}`)}<b>${s.done}<i>/${s.total}</i></b>
        </div>` : '';
      })()}
      ${(() => {
        const done = ROADMAP.reduce((n, p) => n + p.tasks.filter(([k]) => c.roadmap.done[k]).length, 0);
        const cur = ROADMAP.find(p => c.level >= p.min && c.level < p.max) || ROADMAP[ROADMAP.length - 1];
        return `<div class="static-line rm-line ${done === ROADMAP_TOTAL ? 'is-complete' : ''}" title="Leveling roadmap · ${esc(cur.levels)} ${esc(cur.name)}">
          ${icon('flag')}<span>Roadmap</span>${bar(Math.round((done / ROADMAP_TOTAL) * 100), `Leveling roadmap for ${c.name}`)}<b>${done}<i>/${ROADMAP_TOTAL}</i></b>
        </div>`;
      })()}
    </article>`;
  }

  /* Compact checklist on the overview cards. Rows fill up as runs are logged. */
  function checklistHTML(c, kind) {
    const list = visibleTasks(c, kind);
    const s = summary(c, kind);
    const label = kind === 'daily' ? 'Daily' : 'Weekly';
    const rows = list.map(t => taskRowHTML(c, kind, t)).join('') || `<li class="task-empty">No ${kind} tasks.</li>`;
    return `<section class="checklist ${kind} is-compact ${s.total && s.done === s.total ? 'is-complete' : ''}">
      <header class="cl-head">
        <div class="cl-title"><h4>${label}</h4><span class="cl-reset">resets in <span data-countdown="${kind}"></span></span></div>
        <div class="cl-count"><b>${s.done}</b>/${s.total}</div>
      </header>
      ${bar(s.pct, `${label} progress for ${c.name}`)}
      <ul class="tasks">${rows}</ul>
    </section>`;
  }

  function taskRowHTML(c, kind, t) {
    const ds = `data-char="${esc(c.id)}" data-kind="${kind}" data-task="${esc(t.id)}"`;
    const p = progOf(c, kind, t);
    const done = p >= t.count;
    const multi = t.count > 1;
    // Several runs: the checkbox completes (or clears) all of them; the rest of the row adds one run.
    // One run: a click anywhere on the row ticks it.
    return `<li class="task ${done ? 'is-done' : ''} ${multi && p > 0 && !done ? 'is-partial' : ''} ${multi ? 'is-multi' : ''}" style="--p:${Math.round((p / t.count) * 100)}%">
      <button class="task-main" data-action="toggle" ${ds} aria-pressed="${done}"
        title="${esc(t.desc || t.name)}${multi ? (done ? ' (click to start again)' : ' (click to add one run)') : ''}">
        <span class="check">${icon('check')}</span>
        <span class="task-name">${esc(t.name)}${t.mainOnly ? ` <span class="mini-crown" title="Main only">${icon('crown')}</span>` : ''}</span>
        ${multi ? `<span class="task-count">${p}/${t.count}</span>` : ''}
      </button>
      ${multi ? `<button class="task-check" data-action="all-or-none" ${ds} aria-pressed="${done}"
        aria-label="${done ? `Clear ${esc(t.name)}` : `Mark all ${t.count} ${esc(t.name)} done`}" title="${done ? 'Clear all' : `Mark all ${t.count} done`}">${icon('check')}</button>` : ''}
    </li>`;
  }

  /* Leveling roadmap (character page): a timeline of level phases. The phase matching the
     character's level is "Active" and opens by default; the others can be opened as needed. */
  const rmOpen = new Map(); // charId -> Set of open phase keys (kept while the page is open)

  function phaseInfo(c, p) {
    const done = p.tasks.filter(([k]) => c.roadmap.done[k]).length;
    const total = p.tasks.length;
    const inRange = c.level >= p.min && c.level < p.max;
    const status = done >= total ? 'complete' : inRange ? 'active' : c.level < p.min ? 'upcoming' : 'unfinished';
    const nextTask = p.tasks.find(([k]) => !c.roadmap.done[k]);
    return { done, total, pct: Math.round((done / total) * 100), status, inRange, next: nextTask ? nextTask[1] : '' };
  }

  const PHASE_LABEL = { complete: 'Complete', active: 'Active', upcoming: 'Upcoming', unfinished: 'Unfinished' };

  function roadmapHTML(c) {
    const infos = ROADMAP.map(p => ({ p, ...phaseInfo(c, p) }));
    const current = infos.find(i => i.inRange) || infos[infos.length - 1];
    if (!rmOpen.has(c.id)) rmOpen.set(c.id, new Set([current.p.key]));
    const open = rmOpen.get(c.id);
    const done = infos.reduce((n, i) => n + i.done, 0);
    const pct = Math.round((done / ROADMAP_TOTAL) * 100);
    const ds = `data-char="${esc(c.id)}"`;
    const phases = infos.map((i, idx) => {
      const p = i.p;
      return `<details class="rm-phase is-${i.status}" data-phase="${p.key}" data-char="${esc(c.id)}" ${open.has(p.key) ? 'open' : ''} style="--p:${i.pct}%">
        <summary>
          <span class="rm-node">${i.status === 'complete' ? icon('check') : idx + 1}</span>
          <span class="rm-title"><small>${esc(p.levels)}</small><b>${esc(p.name)}</b></span>
          <span class="rm-status">${PHASE_LABEL[i.status]}</span>
          <span class="rm-count"><b>${i.done}</b>/${i.total}</span>
          <span class="rm-bar"><i></i></span>
          <span class="rm-chev">${icon('down')}</span>
        </summary>
        <div class="rm-body">
          ${p.desc ? `<p class="rm-desc">${esc(p.desc)}</p>` : ''}
          <div class="rm-grid">
            <ul class="rm-tasks">
              ${p.tasks.map(([k, name]) => {
                const on = !!c.roadmap.done[k];
                return `<li><button class="rm-task ${on ? 'is-done' : ''}" data-action="rm-toggle" ${ds} data-task="${k}" aria-pressed="${on}">
                  <span class="check">${icon('check')}</span><span>${esc(name)}</span></button></li>`;
              }).join('')}
            </ul>
            <aside class="rm-guide">
              <h5>${icon('flag')}Casual focus · ${esc(p.levels)}</h5>
              <ul>${p.guidance.map(([text, g]) => `<li>${esc(text)}${g ? ` <button class="rm-link" data-action="open-guide" data-value="${g}">Guide ${icon('arrow')}</button>` : ''}</li>`).join('')}</ul>
              <p class="rm-next">${i.next ? `Next objective: <b>${esc(i.next)}</b>` : `${icon('check')}Everything in this phase is done`}</p>
            </aside>
          </div>
        </div>
      </details>`;
    }).join('');
    return `<section class="board roadmap">
      <header class="board-head">
        <div class="ring" style="--p:${pct}%" role="img" aria-label="${done} of ${ROADMAP_TOTAL} roadmap tasks done">
          <span><b>${pct}</b><small>%</small></span>
        </div>
        <div class="board-title">
          <h3>Leveling roadmap</h3>
          <p>Level ${c.level} · <b>${esc(current.p.levels)} ${esc(current.p.name)}</b> · ${done}/${ROADMAP_TOTAL} tasks</p>
          <p class="board-reset">${icon('flag')}${current.next ? `Next: <b>${esc(current.next)}</b>` : 'This phase is complete'}</p>
        </div>
        <div class="board-tools">
          <button class="btn ghost xs" data-action="open-guide">${icon('book')}Guide</button>
          <button class="btn ghost xs" data-action="rm-expand" ${ds}>${icon('down')}${open.size === ROADMAP.length ? 'Collapse all' : 'Expand all'}</button>
        </div>
      </header>
      <div class="rm-timeline">${phases}</div>
    </section>`;
  }

  // Remember which phases are open when someone opens/closes them ("toggle" doesn't bubble).
  document.addEventListener('toggle', e => {
    const d = e.target;
    if (!d.matches || !d.matches('.rm-phase')) return;
    const set = rmOpen.get(d.dataset.char) || new Set();
    if (d.open) set.add(d.dataset.phase); else set.delete(d.dataset.phase);
    rmOpen.set(d.dataset.char, set);
    const btn = $(`[data-action="rm-expand"][data-char="${d.dataset.char}"]`);
    if (btn) btn.innerHTML = `${icon('down')}${set.size === ROADMAP.length ? 'Collapse all' : 'Expand all'}`;
  }, true);

  function openGuide(focusKey) {
    const m = openModal({
      title: 'Important Progression Rules',
      size: 'wide',
      body: `<p class="guide-intro">${icon('info')}These rules apply regardless of your chosen path. They're for information only, not tasks to tick.</p>
        <div class="guide-grid">
          ${GUIDE.map(g => `<article class="guide-card" id="guide-${g.key}">
            <header><span class="gc-ico">${icon(g.icon)}</span><div><h4>${esc(g.title)}</h4><p>${esc(g.tagline)}</p></div></header>
            <ul>${g.lines.map(l => (typeof l === 'string'
              ? `<li>${esc(l)}</li>`
              : `<li class="is-warn">${icon('alert')}<span>${esc(l.text)}</span></li>`)).join('')}</ul>
          </article>`).join('')}
        </div>`,
      footer: '<button class="btn primary" data-m="close">Done</button>',
    });
    if (focusKey) {
      const card = $(`#guide-${focusKey}`, m);
      if (card) {
        card.classList.add('is-focus');
        setTimeout(() => card.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
      }
    }
  }

  /* Full board on the character page: a progress ring header and one tile per activity. */
  function boardHTML(c, kind) {
    const manage = manageMode.has(c.id + ':' + kind);
    const list = manage ? applicableTasks(c, kind) : visibleTasks(c, kind);
    const s = summary(c, kind);
    const ds = `data-char="${esc(c.id)}" data-kind="${kind}"`;
    const title = `${KIND_LABEL[kind]} content`;
    const lead = {
      daily: 'Resets every day. Tracked separately from weekly progress.',
      weekly: 'Resets every week. Finished weeks are archived to History.',
      static: 'Done once per character. Never resets and is tracked separately.',
    }[kind];
    const tiles = list.map(t => tileHTML(c, kind, t, manage)).join('') ||
      `<p class="task-empty">No ${kind} activities. Add some in Settings &rarr; Tasks.</p>`;
    return `<section class="board ${kind} ${s.total && s.done === s.total ? 'is-complete' : ''}">
      <header class="board-head">
        <div class="ring" style="--p:${s.pct}%" role="img" aria-label="${s.done} of ${s.total} ${kind} activities done">
          <span><b>${s.done}</b><small>/${s.total}</small></span>
        </div>
        <div class="board-title">
          <h3>${title}</h3>
          <p>${lead}</p>
          ${kind === 'static'
            ? `<p class="board-reset">${icon('infinity')}No reset</p>`
            : `<p class="board-reset">${icon('clock')}Resets <span data-when="${kind}"></span> <b>in <span data-countdown="${kind}"></span></b></p>`}
        </div>
        <div class="board-tools">
          <button class="tool-icon" data-action="check-all" ${ds} title="Mark everything done" aria-label="Mark all ${kind === 'static' ? 'one-time' : kind} activities done">${icon('checkAll')}</button>
          <button class="tool-icon" data-action="clear-list" ${ds} title="Reset all" aria-label="Reset all ${kind === 'static' ? 'one-time' : kind} activities">${icon('refresh')}</button>
        </div>
      </header>
      ${manage ? '<p class="fine board-note">Hidden activities don\'t count toward this character\'s progress.</p>' : ''}
      <div class="qt-grid">${tiles}</div>
    </section>`;
  }

  function tileHTML(c, kind, t, manage) {
    const ds = `data-char="${esc(c.id)}" data-kind="${kind}" data-task="${esc(t.id)}"`;
    const p = progOf(c, kind, t);
    const done = p >= t.count;
    const hidden = !!c.hidden[t.id];
    const pct = Math.round((p / t.count) * 100);
    const state_ = done ? 'is-done' : p > 0 ? 'is-partial' : '';

    let controls;
    if (manage) {
      controls = `<button class="btn ghost sm block" data-action="hide-task" ${ds} aria-pressed="${!hidden}">
        ${icon(hidden ? 'eyeOff' : 'eye')}${hidden ? 'Hidden for this character' : 'Shown'}</button>`;
    } else if (t.count === 1) {
      controls = `<div class="stepper">
          <button class="step complete-all ${done ? 'is-done' : ''}" data-action="toggle" ${ds} aria-pressed="${done}"
            title="${done ? 'Mark as not done' : 'Mark as done'}" aria-label="${done ? `Mark ${esc(t.name)} as not done` : `Mark ${esc(t.name)} as done`}">${icon('check')}</button>
        </div>`;
    } else {
      const meter = t.count <= 20
        ? `<div class="pips" role="group" aria-label="${esc(t.name)}: ${p} of ${t.count}" style="--n:${t.count}">
            ${Array.from({ length: t.count }, (_, i) => `<button class="pip ${i < p ? 'is-on' : ''}" data-action="set-prog" ${ds} data-value="${i + 1}" aria-label="Set to ${i + 1} of ${t.count}" title="${i + 1}/${t.count}"></button>`).join('')}
          </div>`
        : `<input type="range" class="range" min="0" max="${t.count}" value="${p}" data-range ${ds} aria-label="${esc(t.name)} progress">`;
      controls = `${meter}
        <div class="stepper">
          <button class="step" data-action="dec" ${ds} ${p === 0 ? 'disabled' : ''} aria-label="Remove one">${icon('minus')}</button>
          <button class="step" data-action="inc" ${ds} ${done ? 'disabled' : ''} aria-label="Add one">${icon('plus')}</button>
          <button class="step complete-all ${done ? 'is-done' : ''}" data-action="all-or-none" ${ds} aria-pressed="${done}"
            title="${done ? 'Clear all runs' : `Mark all ${t.count} done`}" aria-label="${done ? `Clear ${esc(t.name)}` : `Mark all ${t.count} ${esc(t.name)} done`}">${icon(done ? 'check' : 'checkAll')}</button>
        </div>`;
    }

    return `<article class="qt ${state_} ${manage && hidden ? 'is-hidden' : ''}" style="--p:${pct}%">
      <header class="qt-head">
        <h4>${esc(t.name)}</h4>
        <span class="qt-count"><b>${p}</b>/${t.count}</span>
      </header>
      ${t.desc ? `<p class="qt-desc">${esc(t.desc)}</p>` : ''}
      ${t.location || t.info || t.mainOnly ? `<div class="qt-meta">
        ${t.mainOnly ? `<span class="tag main icon-only" title="Main character only" aria-label="Main character only">${icon('crown')}</span>` : ''}
        ${t.location ? `<span class="tag loc">${icon('pin')}${esc(t.location)}</span>` : ''}
        ${t.info ? `<span class="info-wrap">
          <button class="info-btn" data-action="info" aria-expanded="false" aria-label="About ${esc(t.name)}">${icon('infoMark')}</button>
          <span class="info-pop" role="tooltip" hidden>${esc(t.info)}</span>
        </span>` : ''}
      </div>` : ''}
      <footer class="qt-foot">${controls}</footer>
    </article>`;
  }

  function dayDot(d) {
    const pct = d.total ? Math.round((d.done / d.total) * 100) : 0;
    return `<span class="day ${d.live ? 'is-live' : ''} ${pct >= 100 ? 'is-full' : ''}" style="--p:${pct}%" title="${esc(fmtDay.format(d.start))}: ${d.done}/${d.total}${d.live ? ' (current)' : ''}">
      <i></i><small>${esc(fmtDayShort.format(d.start))}</small>
    </span>`;
  }

  function detailHTML(c) {
    const draft = statsDrafts[c.id];
    const stats = draft || c.stats;
    const k = calc(c);
    const side = state.ui.sideTab;
    return `<div class="detail" style="--cc:${classColor(c)}">
      <section class="detail-main">
        <article class="panel hero">
          ${avatar(c, 'lg')}
          <div class="hero-id">
            <h2>${esc(c.name)} ${roleBadge(c)}</h2>
            <p class="hero-meta">
              <span class="lvl-edit" title="Character level (the roadmap follows it)">
                <button type="button" class="lvl-step" data-action="lvl-step" data-char="${esc(c.id)}" data-value="-1" aria-label="Level down" ${c.level <= 1 ? 'disabled' : ''}>${icon('minus')}</button>
                <label><span>Lv</span><input type="number" class="lvl-input" data-level="${esc(c.id)}" min="1" max="999" value="${c.level}" aria-label="Level of ${esc(c.name)}"></label>
                <button type="button" class="lvl-step" data-action="lvl-step" data-char="${esc(c.id)}" data-value="1" aria-label="Level up">${icon('plus')}</button>
              </span>
              ${[c.cls, c.race, c.server].filter(Boolean).map(esc).join(' <i>·</i> ')}
            </p>
            ${c.notes ? `<p class="notes">${esc(c.notes)}</p>` : ''}
          </div>
          <div class="hero-actions">
            ${c.role === 'main' ? '' : `<button class="btn ghost sm" data-action="make-main" data-char="${esc(c.id)}">${icon('crown')}Make main</button>`}
            <button class="hero-icon" data-action="edit-char" data-char="${esc(c.id)}" title="Edit character" aria-label="Edit ${esc(c.name)}">${icon('edit')}</button>
            <button class="hero-icon danger" data-action="delete-char" data-char="${esc(c.id)}" title="Delete character" aria-label="Delete ${esc(c.name)}">${icon('trash')}</button>
          </div>
        </article>
        ${boardHTML(c, 'daily')}
        ${boardHTML(c, 'weekly')}
        ${boardHTML(c, 'static')}
      </section>

      <aside class="detail-side">
        <div class="cp-strip" id="cp-strip">${cpStripHTML(c)}</div>
        <div class="seg side-tabs" role="tablist" aria-label="Character details">
          ${SIDE_TABS.map(([key, label]) => `<button class="seg-btn ${side === key ? 'is-active' : ''}" role="tab" aria-selected="${side === key}"
            data-action="side-tab" data-value="${key}" data-char="${esc(c.id)}">${label}${key === 'stats' && draft ? ' <i class="dot-warn" title="Unsaved changes"></i>' : ''}${key === 'notes' && notesFor(c.id).length ? ` <span class="tab-count">${notesFor(c.id).length}</span>` : ''}</button>`).join('')}
        </div>
        ${side === 'history' ? `<article class="panel heat">${heatmapHTML(c)}</article>` : ''}
        ${side === 'calc' ? `<article class="panel" id="calc-panel">${calcHTML(c)}</article>` : ''}
        ${side === 'roadmap' ? `<article class="panel rm-panel">${roadmapHTML(c)}</article>` : ''}
        ${side === 'notes' ? `<article class="panel">
          <header class="panel-head"><h3>Notes for ${esc(c.name)}</h3>
            <button class="btn ghost xs" data-action="open-notes" title="See notes for every character and general notes">${icon('note')}All notes</button></header>
          <div class="notes-ui" data-scope="${esc(c.id)}">${notesUIHTML(c.id)}</div>
        </article>` : ''}
        ${side === 'stats' ? `<article class="panel">
          <header class="panel-head">
            <h3>Stats</h3>
            <span class="badge warn" id="stats-dirty" ${draft ? '' : 'hidden'}>Unsaved</span>
          </header>
          <form class="stats-form" id="stats-form" data-char="${esc(c.id)}" autocomplete="off">
            ${STAT_DEFS.map(d => `<label class="stat"><span>${esc(d.label)}</span>
              <input type="number" inputmode="decimal" step="any" min="0" data-stat="${d.key}" data-char="${esc(c.id)}" value="${esc(stats[d.key] != null ? stats[d.key] : '')}" placeholder="0"></label>`).join('')}
          </form>
          <div class="panel-actions">
            <button class="btn ghost sm" data-action="revert-stats" data-char="${esc(c.id)}">Revert</button>
            <button class="btn primary sm" data-action="save-stats" data-char="${esc(c.id)}">Save stats</button>
          </div>
        </article>` : ''}
        ${side === 'gear' ? `<article class="panel">
          <header class="panel-head">
            <h3>Gear</h3>
            <span class="gs-badge">GS <b>${fmtInt(k.gearScore)}</b></span>
          </header>
          <ul class="gear-list">
            ${k.items.map(it => `<li class="${it.g ? '' : 'is-empty'}">
              <span class="slot">${esc(it.slot.label)}</span>
              <span class="item" style="--rc:${it.g ? rarityColor(it.g.rarity) : 'var(--faint)'}">${it.g
                ? `${esc(String(it.g.name || '').trim() || it.g.rarity || 'Item')}${num(it.g.enchant) ? ` <em>+${fmtInt(it.g.enchant)}</em>` : ''}${num(it.g.ilvl) ? ` <small>iL ${fmtInt(it.g.ilvl)}</small>` : ''}`
                : 'Empty'}</span>
              <span class="score">${it.g ? fmtInt(it.score) : ''}</span>
            </li>`).join('')}
          </ul>
          <button class="btn ghost sm block" data-action="edit-gear" data-char="${esc(c.id)}">${icon('sword')}Edit gear</button>
        </article>` : ''}
      </aside>
    </div>`;
  }

  // Always-visible Combat Power card above the side tabs: the in-game CP, its progression tier,
  // a track across all tiers, and what to focus on next. Refreshed live while stats are typed.
  // The Combat Power a character is judged by: the calculated score (Auto) or the number
  // the player typed in from the game (Manual). Chosen per character with the switch on the card.
  function effectiveCp(c, stats) {
    return c.cpMode === 'manual' ? num(c.gameCp) : calc(c, stats || c.stats).cp;
  }

  function cpStripHTML(c) {
    const draft = statsDrafts[c.id];
    const k = calc(c, draft || c.stats);
    const auto = c.cpMode !== 'manual';
    const game = auto ? k.cp : num(c.gameCp);
    const ds = `data-char="${esc(c.id)}"`;
    const modeSwitch = `<div class="cp-mode" role="radiogroup" aria-label="How Combat Power is set">
        <button type="button" role="radio" aria-checked="${auto}" class="${auto ? 'is-active' : ''}" data-action="cp-mode" data-value="auto" ${ds}
          title="Use the calculated score from Stats and Gear">Auto</button>
        <button type="button" role="radio" aria-checked="${!auto}" class="${auto ? '' : 'is-active'}" data-action="cp-mode" data-value="manual" ${ds}
          title="Type in the Combat Power shown in the game">Manual</button>
      </div>`;
    const sub = `<p class="cps-sub">${auto ? 'From' : 'Calculated score'} ${auto ? '' : `<b>${fmtInt(k.cp)}</b> · `}GS <b>${fmtInt(k.gearScore)}</b> + Stats <b>${fmtInt(k.statScore)}</b>${draft ? ' (unsaved preview)' : ''}</p>`;
    if (!game) {
      return `<div class="cp-hero is-unset">
          <div class="cph-top">
            <div class="cph-val"><small>Combat Power · ${auto ? 'Auto' : 'Manual'}</small><b>—</b></div>
            ${modeSwitch}
          </div>
          ${auto
            ? `<p class="cph-next">Auto uses your Stats and Gear. Fill them in to calculate your Combat Power.</p>
               <button class="btn primary sm" data-action="side-tab" data-value="stats" ${ds}>${icon('edit')}Enter stats</button>`
            : `<p class="cph-next">Enter the Combat Power shown in the game to see your progression tier.</p>
               <button class="btn primary sm" data-action="edit-cp" ${ds}>${icon('sword')}Set Combat Power</button>`}
        </div>${sub}`;
    }
    const t = cpTier(game);
    const prev = lastWeekSnapshot(c);
    const prevCp = prev ? num(prev.gameCp) : 0;
    const diff = prevCp ? game - prevCp : null;
    let next;
    if (t.peak) next = 'Past 2,500: the top of the progression chart.';
    else if (t.next) next = `<b>${fmtInt(t.max - game)}</b> CP to <b>${esc(t.next.name)}</b>`;
    else next = `<b>${fmtInt(t.max - game)}</b> CP to 2,500`;
    if (c.level < 45 && game >= 1000) next += `<span class="cph-hint">Endgame tiers usually start at level 45 (level ${c.level} now; change it with Edit).</span>`;
    return `<div class="cp-hero tier-${t.key} ${t.peak ? 'is-peak' : ''}" style="--tc:${t.color}">
        <div class="cph-top">
          <div class="cph-val"><small>Combat Power · ${auto ? 'Auto' : 'Manual'}</small><b data-cp-count ${ds} data-to="${game}">${fmtInt(game)}</b></div>
          <div class="cph-tools">
            ${modeSwitch}
            ${auto ? '' : `<button class="icon-btn xs" data-action="edit-cp" ${ds} aria-label="Update Combat Power" title="Update Combat Power">${icon('edit')}</button>`}
          </div>
        </div>
        <div class="cph-tier">
          <span class="tier-badge">${esc(t.name)}</span>
          ${diff !== null ? `<span class="delta ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${diff > 0 ? '+' : ''}${fmtInt(diff)} vs last week</span>` : ''}
        </div>
        <div class="tier-track" style="--pos:${(t.pos * 100).toFixed(1)}%" role="img" aria-label="${esc(t.name)}, ${Math.round(t.frac * 100)}% of the way through this tier">
          ${CP_TIERS.map((x, i) => `<span class="tt-seg" style="--sc:${x.color}" title="${esc(x.name)}: ${fmtInt(x.min)}–${fmtInt(x.max)}${i === CP_TIERS.length - 1 ? '+' : ''}">
            <i style="width:${i < t.index ? 100 : i === t.index ? Math.round(t.frac * 100) : 0}%"></i></span>`).join('')}
          <span class="tt-marker"></span>
        </div>
        <div class="tt-labels"><span>0</span>${CP_TIERS.map((x, i) => `<span>${fmtInt(x.max)}${i === CP_TIERS.length - 1 ? '+' : ''}</span>`).join('')}</div>
        <p class="cph-next">${next}</p>
        <p class="cph-focus"><b>Focus:</b> ${esc(t.focus)}</p>
      </div>${sub}`;
  }

  // Aion 2 progression tiers by in-game Combat Power.
  const CP_TIERS = [
    { key: 'leveling', name: 'Leveling Phase', min: 0, max: 1000, color: '#8aa4ff',
      focus: 'Yellow main story quests and green regional missions to unlock core features and build a baseline.' },
    { key: 'early', name: 'Early Endgame', min: 1000, max: 1300, color: '#2dd4bf',
      focus: 'Upgrade growth gear evenly, open basic Arcana boxes for item level, and run early Sealed Dungeons.' },
    { key: 'mid', name: 'Mid-Tier Power', min: 1300, max: 1600, color: '#c084fc',
      focus: 'Enhance unique weapons and bracers, slot lesser manastones, and start the Daevanion skill boards.' },
    { key: 'advanced', name: 'Advanced Progression', min: 1600, max: 2500, color: '#f5c96a',
      focus: 'High-level Stigma upgrades, advanced Daevanion nodes, and gear from high-star Expedition Conquest.' },
  ];

  function cpTier(cp) {
    let i = CP_TIERS.findIndex(t => cp < t.max);
    if (i < 0) i = CP_TIERS.length - 1;
    const t = CP_TIERS[i];
    const frac = clamp((cp - t.min) / (t.max - t.min), 0, 1);
    return { ...t, index: i, frac, pos: (i + frac) / CP_TIERS.length, next: CP_TIERS[i + 1], peak: cp >= 2500 };
  }

  // Counts the Combat Power number up when it first shows or changes.
  const shownCp = {};
  function animateCp() {
    const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const el of $$('[data-cp-count]')) {
      const id = el.dataset.char, to = num(el.dataset.to);
      const from = shownCp[id] == null ? Math.round(to * 0.6) : shownCp[id];
      shownCp[id] = to;
      if (from === to || still) { el.textContent = fmtInt(to); continue; }
      const hero = el.closest('.cp-hero');
      if (hero && to > from) {
        hero.classList.remove('is-rising');
        void hero.offsetWidth; // restart the flash animation
        hero.classList.add('is-rising');
      }
      const t0 = performance.now(), dur = 1100;
      const step = now => {
        const p = Math.min(1, (now - t0) / dur);
        el.textContent = fmtInt(from + (to - from) * (1 - Math.pow(1 - p, 3)));
        if (p < 1 && el.isConnected) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }

  function openCpModal(c) {
    const before = num(c.gameCp) ? cpTier(num(c.gameCp)) : null;
    const m = openModal({
      title: `Combat Power — ${c.name}`,
      size: 'sm',
      body: `<form id="cp-form" novalidate>
          <label class="field"><span>In-game Combat Power</span>
            <input name="cp" type="number" min="0" max="999999" inputmode="numeric" value="${num(c.gameCp) || ''}" placeholder="e.g. 1,250" autofocus></label>
        </form>
        <p class="fine">Copy it from your character screen in Aion 2. Tiers: under 1,000 Leveling · 1,000 Early Endgame · 1,300 Mid-Tier · 1,600 Advanced.</p>`,
      footer: `<button type="button" class="btn ghost" data-m="cancel">Cancel</button>
               <button type="submit" form="cp-form" class="btn primary">Save</button>`,
      actions: {
        submit(form) {
          const v = clamp(Math.round(num(form.elements.cp.value)), 0, 999999);
          c.gameCp = v;
          save();
          closeModal(m);
          render();
          const after = v ? cpTier(v) : null;
          if (after && before && after.index > before.index) toast(`Tier up! ${c.name} reached ${after.name}.`, { type: 'ok', timeout: 6000 });
          else toast(v ? 'Combat Power updated.' : 'Combat Power cleared.', { type: 'ok' });
        },
      },
    });
  }

  /* Personal notes: shown in the header's Notes dialog (all notes, with filters) and in each
     character's Notes tab (that character's notes). Pinned first, then newest first. */
  let editingNote = null;       // id of the note being edited
  const noteDraft = {};         // unsent composer text per panel scope, kept across re-renders

  const notesFor = charId => state.notes.filter(n => n.charId === charId);
  const noteLabel = n => {
    const c = n.charId && getChar(n.charId);
    return c ? c.name : 'General';
  };

  function notesUIHTML(scope, filter = 'all') {
    let list = state.notes;
    if (scope !== 'all') list = list.filter(n => n.charId === scope);
    else if (filter === 'general') list = list.filter(n => !n.charId || !getChar(n.charId));
    else if (filter !== 'all') list = list.filter(n => n.charId === filter);
    list = list.slice().sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated));

    const chars = orderedChars();
    const forPicker = scope === 'all'
      ? `<label class="note-for-wrap"><span>For</span><select class="note-for" aria-label="Note is for">
          <option value="">General</option>
          ${chars.map(c => `<option value="${esc(c.id)}" ${filter === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select></label>`
      : '';
    const filters = scope === 'all'
      ? `<div class="range-pills note-filters" role="radiogroup" aria-label="Show notes for">
          ${[['all', 'All'], ['general', 'General'], ...chars.map(c => [c.id, c.name])].map(([v, l]) =>
            `<button type="button" role="radio" class="range-pill ${filter === v ? 'is-active' : ''}" aria-checked="${filter === v}" data-action="note-filter" data-value="${esc(v)}">${esc(l)}</button>`).join('')}
        </div>`
      : '';
    const items = list.map(n => {
      const editing = editingNote === n.id;
      const ds = `data-note="${esc(n.id)}"`;
      return `<li class="note ${n.pinned ? 'is-pinned' : ''}">
        ${editing
          ? `<textarea class="note-edit-input" rows="4" maxlength="${NOTE_LEN}" aria-label="Edit note">${esc(n.text)}</textarea>
             <div class="note-actions">
               <button class="btn ghost xs" data-action="note-cancel">Cancel</button>
               <button class="btn primary xs" data-action="note-save" ${ds}>Save</button>
             </div>`
          : `<p class="note-text">${esc(n.text)}</p>
             <div class="note-foot">
               <span class="note-meta">${scope === 'all' ? `<span class="note-tag">${esc(noteLabel(n))}</span>` : ''}${esc(fmtAgo(n.updated))}${n.updated - n.created > 60e3 ? ' · edited' : ''}</span>
               <span class="note-actions">
                 <button class="icon-btn xs ${n.pinned ? 'is-on' : ''}" data-action="note-pin" ${ds} aria-pressed="${n.pinned}" aria-label="${n.pinned ? 'Unpin' : 'Pin to top'}" title="${n.pinned ? 'Unpin' : 'Pin to top'}">${icon('pin')}</button>
                 <button class="icon-btn xs" data-action="note-edit" ${ds} aria-label="Edit note" title="Edit">${icon('edit')}</button>
                 <button class="icon-btn xs danger-text" data-action="note-del" ${ds} aria-label="Delete note" title="Delete">${icon('trash')}</button>
               </span>
             </div>`}
      </li>`;
    }).join('');
    return `${filters}
      <div class="note-composer">
        <textarea class="note-input" rows="3" maxlength="${NOTE_LEN}" placeholder="Write a note… (Ctrl+Enter to add)" aria-label="New note">${esc(noteDraft[scope] || '')}</textarea>
        <div class="note-composer-bar">${forPicker}<span class="fine note-count">${state.notes.length}/${NOTES_MAX} notes</span>
          <button class="btn primary sm" data-action="note-add">${icon('plus')}Add note</button></div>
      </div>
      <ul class="notes-list">${items || `<li class="note-empty">${scope === 'all' && filter === 'all' ? 'No notes yet. Jot down goals, boss timers, gear plans, anything.' : 'No notes here yet.'}</li>`}</ul>`;
  }

  // Redraws every open notes panel (the dialog and the character tab) after a change.
  function refreshNotes() {
    for (const box of $$('.notes-ui')) {
      if (!$('#app').contains(box)) box.innerHTML = notesUIHTML(box.dataset.scope, box.dataset.filter || 'all');
    }
    if ($('#app .notes-ui') || $('.side-tabs')) renderView();
    const ta = $('.note-edit-input');
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }

  /* Completion history: every logged game day for this character, from archived weeks,
     this week's log and today. Keyed by the daily reset that started the day. */
  function completionData(c) {
    const days = new Map(), weeks = new Map();
    for (const h of state.history) {
      const x = h.chars.find(y => y.id === c.id);
      if (!x) continue;
      for (const d of x.days || []) days.set(d.start, d);
      weeks.set(h.start, { done: x.weekly.filter(t => t.prog >= t.count).length, total: x.weekly.length });
    }
    for (const d of c.weekly.log) days.set(d.start, d);
    const s = summary(c, 'daily'), w = summary(c, 'weekly');
    days.set(c.daily.period, { start: c.daily.period, done: s.done, total: s.total, live: true });
    weeks.set(c.weekly.period, { done: w.done, total: w.total, live: true });
    return { days: Array.from(days.values()).filter(d => num(d.start)).sort((a, b) => a.start - b.start), weeks };
  }

  const isFullDay = d => d.total > 0 && d.done >= d.total;

  // Current streak counts back from the latest finished day; today only counts once it's complete.
  function streaks(days) {
    const GAP = 1.5 * 864e5; // a missing day (more than ~36 h between resets) breaks a streak
    let best = 0, run = 0, prev = null;
    for (const d of days) {
      if (d.live && !isFullDay(d)) continue;
      run = isFullDay(d) && prev !== null && d.start - prev <= GAP && run > 0 ? run + 1 : isFullDay(d) ? 1 : 0;
      prev = d.start;
      best = Math.max(best, run);
    }
    let current = 0, last = null;
    for (let i = days.length - 1; i >= 0; i--) {
      const d = days[i];
      if (d.live && !isFullDay(d)) { last = d.start; continue; }
      if (!isFullDay(d) || (last !== null && last - d.start > GAP)) break;
      current++;
      last = d.start;
    }
    return { current, best };
  }

  function heatmapHTML(c) {
    const S = state.settings;
    const months = state.ui.heatMonths || 1;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months); // show every game week that ends after this date
    const { days, weeks } = completionData(c);
    const st = streaks(days);
    const now = Date.now();
    const findDay = slot => days.find(d => d.start >= slot - 2 * 3600e3 && d.start < slot + 22 * 3600e3);
    const level = d => {
      if (!d || !d.total) return 0;
      const r = d.done / d.total;
      return r >= 1 ? 4 : r >= 0.6 ? 3 : r >= 0.3 ? 2 : r > 0 ? 1 : 0;
    };
    const fmtMonth = new Intl.DateTimeFormat(undefined, { month: 'short' });
    const fmtRow = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

    // One row per game week, newest first; one slot per daily reset inside it.
    const rows = [];
    let ws = c.weekly.period || schedule().weeklyStart;
    for (let i = 0; i < 16; i++) {
      const we = nextReset(ws, S.tz, S.weekly.hour, S.weekly.minute, S.weekly.weekday);
      if (i > 0 && we <= cutoff.getTime()) break;
      let d = lastReset(ws, S.tz, S.daily.hour, S.daily.minute, null);
      if (d < ws) d = nextReset(d, S.tz, S.daily.hour, S.daily.minute, null);
      const slots = [];
      while (d < we && slots.length < 7) {
        slots.push(d);
        d = nextReset(d, S.tz, S.daily.hour, S.daily.minute, null);
      }
      rows.push({ start: ws, slots });
      ws = lastReset(ws - 1, S.tz, S.weekly.hour, S.weekly.minute, S.weekly.weekday);
    }

    let fullDays = 0, fullWeeks = 0, prevMonth = '';
    const body = rows.map((row, i) => {
      const month = fmtMonth.format(row.start);
      const label = i === 0 || month !== prevMonth ? month : '';
      prevMonth = month;
      const cells = row.slots.map(slot => {
        const d = findDay(slot);
        if (slot > now) return `<span class="hc is-future" title="${esc(fmtDay.format(slot))}: upcoming"></span>`;
        if (!d) return `<span class="hc is-empty" title="${esc(fmtDay.format(slot))}: no data"></span>`;
        if (isFullDay(d)) fullDays++;
        return `<span class="hc l${level(d)} ${d.live ? 'is-live' : ''}" title="${esc(fmtDay.format(slot))}: ${d.done}/${d.total} dailies${d.live ? ' (today)' : ''}"></span>`;
      }).join('');
      const wk = weeks.get(row.start);
      const wpct = wk && wk.total ? Math.round((wk.done / wk.total) * 100) : 0;
      if (wk && wk.total && wk.done >= wk.total) fullWeeks++;
      return `<div class="hm-row">
        <span class="hm-label" title="Week of ${esc(fmtRow.format(row.start))}">${esc(label)}</span>
        <div class="hm-cells">${cells}</div>
        <span class="hm-week ${wk ? '' : 'is-empty'} ${wpct >= 100 ? 'is-full' : ''} ${wk && wk.live ? 'is-live' : ''}" style="--p:${wpct}%"
          title="Week of ${esc(fmtRow.format(row.start))}: ${wk ? `${wk.done}/${wk.total} weeklies${wk.live ? ' (this week)' : ''}` : 'no data'}"><i></i><b>${wk ? `${wk.done}/${wk.total}` : '–'}</b></span>
      </div>`;
    }).join('');
    const letters = (rows[0] ? rows[0].slots : []).map(s => `<span>${esc(new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(s))}</span>`).join('');

    return `<header class="panel-head">
        <h3>Completion history</h3>
        <span class="fine">${rows.length} week${rows.length === 1 ? '' : 's'}</span>
      </header>
      <div class="range-pills" role="radiogroup" aria-label="Period shown">
        ${HEAT_RANGES.map(mo => `<button type="button" role="radio" class="range-pill ${mo === months ? 'is-active' : ''}" aria-checked="${mo === months}"
          data-action="heat-range" data-value="${mo}">Last ${mo === 1 ? 'month' : `${mo} months`}</button>`).join('')}
      </div>
      <div class="streaks">
        <div class="streak-ring ${st.current ? 'is-hot' : ''}"><b>${st.current}</b><small>Day streak</small></div>
        <dl class="kv streak-kv">
          <div><dt>Best streak</dt><dd>${st.best} day${st.best === 1 ? '' : 's'}</dd></div>
          <div><dt>Full days</dt><dd>${fullDays}</dd></div>
          <div><dt>Full weeks</dt><dd>${fullWeeks}</dd></div>
        </dl>
      </div>
      <div class="hm" role="img" aria-label="Daily and weekly completion over the last ${months === 1 ? 'month' : `${months} months`}. Current streak ${st.current} days, best ${st.best}.">
        <div class="hm-row hm-head"><span class="hm-label"></span><div class="hm-cells">${letters}</div><span class="hm-week-h">Weekly</span></div>
        ${body}
      </div>
`;
  }

  function calcHTML(c) {
    const draft = statsDrafts[c.id];
    const k = calc(c, draft || c.stats);
    const prev = lastWeekSnapshot(c);
    let delta = '';
    if (prev) {
      const diff = k.cp - num(prev.cp);
      delta = `<span class="delta ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${diff > 0 ? '+' : ''}${fmtInt(diff)} vs last week</span>`;
    }
    const weak = k.weakest
      ? (k.weakest.g ? `${esc(k.weakest.slot.label)} (${fmtInt(k.weakest.score)})` : `${esc(k.weakest.slot.label)} (empty)`)
      : '—';
    return `<header class="panel-head">
        <h3>Calculations</h3>
        ${draft ? '<span class="badge warn">Preview</span>' : ''}
      </header>
      <div class="cp-big"><small>Calculated score</small><b>${fmtInt(k.cp)}</b>${delta}</div>
      <dl class="kv">
        <div><dt>Gear Score</dt><dd>${fmtInt(k.gearScore)}</dd></div>
        <div><dt>Stat Score</dt><dd>${fmtInt(k.statScore)}</dd></div>
        <div><dt>Avg item level</dt><dd>${k.equipped ? fmtNum(k.avgIlvl) : '—'}</dd></div>
        <div><dt>Avg enchant</dt><dd>${k.equipped ? '+' + fmtNum(k.avgEnchant) : '—'}</dd></div>
        <div><dt>Slots equipped</dt><dd>${k.equipped}/${GEAR_SLOTS.length}</dd></div>
        <div><dt>Upgrade next</dt><dd>${weak}</dd></div>
      </dl>
      <p class="fine">Calculated score = Gear Score + Stat Score, for comparing your own characters. Change the weights in Settings &rarr; Scoring. Your in-game Combat Power is set above.</p>`;
  }

  function updateClocks() {
    const now = Date.now();
    const sch = schedule(state.settings, now);
    const next = { daily: sch.dailyNext, weekly: sch.weeklyNext };
    for (const el of $$('[data-countdown]')) el.textContent = fmtDur(next[el.dataset.countdown] - now);
    for (const el of $$('[data-when]')) el.textContent = fmtWhen.format(next[el.dataset.when]);
    updateRift(now);
  }

  /* Spacetime Rift: portals open every 3 hours on the hour (GMT+3 server time) and can only be
     entered during the first 5 minutes; the rift then stays active for the rest of that hour. */
  const RIFT_HOURS = [2, 5, 8, 11, 14, 17, 20, 23]; // GMT+3
  const RIFT_ENTRY_MS = 5 * 60e3;
  const RIFT_EVENT_MS = 60 * 60e3;
  const GMT3 = 3 * 36e5;
  const fmtClock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

  // Portal opening times (ms) from yesterday to tomorrow, in order.
  function riftSlots(now = Date.now()) {
    const dayStart = Math.floor((now + GMT3) / 864e5) * 864e5 - GMT3; // midnight GMT+3, as a UTC instant
    const out = [];
    for (let d = -1; d <= 1; d++) for (const h of RIFT_HOURS) out.push(dayStart + d * 864e5 + h * 36e5);
    return out;
  }

  function riftState(now = Date.now()) {
    const slots = riftSlots(now);
    return {
      slots,
      open: slots.find(s => now >= s && now < s + RIFT_ENTRY_MS) || null,   // enterable right now
      active: slots.find(s => now >= s && now < s + RIFT_EVENT_MS) || null, // running (entry may be closed)
      next: slots.find(s => s > now),
    };
  }

  const hhmmss = ms => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(pad2).join(':');
  };

  function updateRift(now) {
    const r = riftState(now);
    for (const chip of $$('.rift-chip')) {
      chip.classList.toggle('is-open', !!r.open);
      $('[data-rift="label"]', chip).textContent = r.open ? 'Portal open' : 'Next portal';
      $('[data-rift="when"]', chip).textContent = r.open ? 'Enter now' : fmtClock.format(r.next);
      $('[data-rift="prefix"]', chip).textContent = r.open ? 'closes in' : 'in';
      $('[data-rift="in"]', chip).textContent = fmtDur((r.open ? r.open + RIFT_ENTRY_MS : r.next) - now);
      $('[data-rift="bell"]', chip).hidden = !state.settings.riftAlert.on;
    }
    const box = $('#rift-live');
    if (box) paintRift(box, r, now);
    checkRiftAlert(r, now);
  }

  /* Portal alerts: a sound, an in-page message, a flashing tab title and (optionally) a desktop
     notification, on time or a few minutes before a portal opens. Works while the page is open in
     a tab, even in the background. Sounds are synthesised, so there are no audio files. */
  const RIFT_ALERTED_KEY = 'aion2-rift-alerted'; // last portal alerted for, shared by open tabs

  function normRiftAlert(a) {
    a = isObj(a) ? a : {};
    return {
      on: !!a.on,
      lead: RIFT_LEADS.includes(num(a.lead, 2)) ? num(a.lead, 2) : 2,
      sound: RIFT_SOUNDS.some(([k]) => k === a.sound) ? a.sound : 'chime',
      volume: clamp(num(a.volume, 0.7), 0, 1),
      desktop: !!a.desktop,
    };
  }

  let audioCtx = null;
  function getAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }
  // Browsers only allow sound after the person has interacted with the page once; unlock early.
  document.addEventListener('pointerdown', () => { if (state.settings.riftAlert.on) getAudio(); }, { passive: true });

  function tone(ac, out, { type = 'sine', freq, freqEnd, start, dur, gain = 0.3, attack = 0.01, lowpass }) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    let node = o;
    if (lowpass) {
      const f = ac.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      o.connect(f);
      node = f;
    }
    node.connect(g).connect(out);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  function playRiftSound(name, volume) {
    if (name === 'none') return;
    const ac = getAudio();
    if (!ac) return;
    const out = ac.createGain();
    out.gain.value = volume;
    out.connect(ac.destination);
    const t = ac.currentTime + 0.03;
    const T = o => tone(ac, out, o);
    if (name === 'chime') {
      [1046.5, 1318.5, 1568, 2093].forEach((f, i) => T({ freq: f, start: t + i * 0.15, dur: 1.1, gain: 0.28 }));
    } else if (name === 'bell') {
      [[880, 0.35], [1760, 0.1], [2637, 0.05], [1318.5, 0.08]].forEach(([f, g]) => T({ freq: f, start: t, dur: 2.4, gain: g, attack: 0.004 }));
      [[880, 0.28], [1760, 0.08]].forEach(([f, g]) => T({ freq: f, start: t + 0.7, dur: 2.2, gain: g, attack: 0.004 }));
    } else if (name === 'arcane') {
      T({ type: 'triangle', freq: 294, freqEnd: 880, start: t, dur: 1, gain: 0.22, attack: 0.08 });
      T({ type: 'sine', freq: 587, freqEnd: 1760, start: t + 0.1, dur: 1.1, gain: 0.12, attack: 0.1 });
      [1568, 2093, 2637, 3136].forEach((f, i) => T({ freq: f, start: t + 0.55 + i * 0.08, dur: 0.7, gain: 0.07 }));
    } else if (name === 'horn') {
      T({ type: 'sawtooth', freq: 196, start: t, dur: 0.75, gain: 0.2, attack: 0.09, lowpass: 900 });
      T({ type: 'sawtooth', freq: 261.6, start: t + 0.6, dur: 1.3, gain: 0.22, attack: 0.09, lowpass: 1200 });
      T({ type: 'sawtooth', freq: 130.8, start: t + 0.6, dur: 1.3, gain: 0.1, attack: 0.09, lowpass: 700 });
    } else if (name === 'ping') {
      T({ freq: 1760, start: t, dur: 0.3, gain: 0.3 });
      T({ freq: 2349, start: t + 0.2, dur: 0.45, gain: 0.3 });
    }
  }

  function checkRiftAlert(r, now) {
    const a = state.settings.riftAlert;
    if (!a.on) return;
    let last = 0;
    try { last = num(localStorage.getItem(RIFT_ALERTED_KEY)); } catch (e) { /* storage blocked */ }
    for (const s of [r.open, r.next]) {
      if (!s || s <= last) continue;
      if (now >= s - a.lead * 60e3 && now < s + RIFT_ENTRY_MS) {
        try { localStorage.setItem(RIFT_ALERTED_KEY, String(s)); } catch (e) { /* ignore */ }
        fireRiftAlert(s, now, a);
        return;
      }
    }
  }

  let titleTimer = 0;
  function fireRiftAlert(s, now, a, isTest) {
    const mins = Math.ceil((s - now) / 60e3);
    const msg = s > now
      ? `Spacetime Rift opens in ${mins} minute${mins === 1 ? '' : 's'} (${fmtClock.format(s)}).`
      : 'Spacetime Rift portal is OPEN. Enter within 5 minutes!';
    playRiftSound(a.sound, a.volume);
    toast(`${isTest ? 'Test: ' : ''}${msg}`, { type: 'ok', timeout: 20000, action: { label: 'Open', fn: openRift } });
    if (a.desktop && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const n = new Notification(isTest ? 'Spacetime Rift (test)' : 'Spacetime Rift', { body: msg, tag: 'aion2-rift', icon: 'assets/logo.svg' });
        n.onclick = () => { window.focus(); n.close(); openRift(); };
      } catch (e) { /* some browsers only allow notifications from a service worker */ }
    }
    if (!isTest) {
      const base = document.title.replace(/^\(!\) .*? · /, '');
      document.title = `(!) ${s > now ? 'Rift opening soon' : 'Rift is open'} · ${base}`;
      clearTimeout(titleTimer);
      titleTimer = setTimeout(() => { document.title = base; }, 5 * 60e3);
    }
  }

  function riftAlertHTML() {
    const a = state.settings.riftAlert;
    return `<header class="ra-head">
        <span class="ra-title">${icon('bell')}${a.on ? 'Alert is on' : 'Alert is off'}</span>
        <label class="switch" title="${a.on ? 'Turn alerts off' : 'Turn alerts on'}">
          <input type="checkbox" id="ra-on" ${a.on ? 'checked' : ''} aria-label="Portal alert"><span></span>
        </label>
      </header>
      <div class="ra-body">
        <div class="ra-row"><span class="ra-label">Before</span>
          <div class="range-pills ra-lead" role="radiogroup" aria-label="When to alert">
            ${RIFT_LEADS.map(l => `<button type="button" role="radio" class="range-pill ${l === a.lead ? 'is-active' : ''}" aria-checked="${l === a.lead}" data-m="ra-lead" data-value="${l}"
              title="${l === 0 ? 'When the portal opens' : `${l} minute${l === 1 ? '' : 's'} before it opens`}">${l === 0 ? 'On time' : `${l} min`}</button>`).join('')}
          </div>
        </div>
        <div class="ra-row"><span class="ra-label">Sound</span>
          <div class="ra-sounds" role="radiogroup" aria-label="Alert sound">
            ${RIFT_SOUNDS.map(([k, l]) => `<button type="button" role="radio" class="ra-sound ${k === a.sound ? 'is-active' : ''}" aria-checked="${k === a.sound}" data-m="ra-sound" data-value="${k}"
              title="${k === 'none' ? 'No sound' : `Select and preview ${l}`}">${icon(k === 'none' ? 'mute' : 'play')}${l}</button>`).join('')}
          </div>
        </div>
        <div class="ra-row"><span class="ra-label">Volume</span>
          <input type="range" id="ra-vol" class="range ra-vol" min="0" max="1" step="0.05" value="${a.volume}" aria-label="Alert volume" ${a.sound === 'none' ? 'disabled' : ''}>
        </div>
        <label class="check-row ra-desktop"><input type="checkbox" id="ra-desktop" ${a.desktop ? 'checked' : ''}> Also show a desktop notification</label>
        <div class="ra-foot">
          <button type="button" class="btn ghost sm" data-m="ra-test">${icon('bell')}Test alert</button>
          <span class="fine">Alerts work while this page is open in a tab (it can be in the background).</span>
        </div>
      </div>`;
  }

  function paintRift(box, r, now) {
    const status = $('.rift-status', box);
    status.classList.toggle('is-open', !!r.open);
    $('.rs-title', box).textContent = r.open ? 'Portal OPEN — enter now!' : 'Next portal opening';
    $('.rs-sub', box).textContent = r.open
      ? `Entry closes at ${fmtClock.format(r.open + RIFT_ENTRY_MS)} (your time)`
      : `Opens at ${fmtClock.format(r.next)} your time · ${pad2(new Date(r.next + GMT3).getUTCHours())}:00 GMT+3`;
    $('.rs-timer', box).textContent = hhmmss((r.open ? r.open + RIFT_ENTRY_MS : r.next) - now);
    $('.rs-timer-label', box).textContent = r.open ? 'Closes in' : 'Opens in';
    const bell = $('.rs-bell', box), a = state.settings.riftAlert;
    if (bell) {
      bell.classList.toggle('is-on', a.on);
      bell.title = a.on
        ? `Alert on · ${a.lead ? `${a.lead} min before` : 'on time'} · ${(RIFT_SOUNDS.find(([k]) => k === a.sound) || [, 'Chime'])[1]}`
        : 'Set up a portal alert';
      bell.setAttribute('aria-label', bell.title);
    }
    // The next 8 portals, starting with the one running now (if any).
    const from = r.active || r.next;
    const list = r.slots.filter(s => s >= from).slice(0, 8);
    $('.rift-list', box).innerHTML = list.map(s => {
      const st = now >= s && now < s + RIFT_ENTRY_MS ? 'open'
        : now >= s && now < s + RIFT_EVENT_MS ? 'active'
          : s === r.next ? 'next' : 'later';
      const label = { open: 'Open now', active: 'Active · entry closed', next: 'Next', later: '' }[st];
      const sameDay = new Date(s).toDateString() === new Date(now).toDateString();
      return `<li class="rift-row is-${st}">
        <span class="rr-local"><b>${esc(fmtClock.format(s))}</b><small>${sameDay ? 'Today' : esc(fmtDayShort.format(s))} · your time</small></span>
        <span class="rr-server">${pad2(new Date(s + GMT3).getUTCHours())}:00 GMT+3</span>
        ${label ? `<span class="rr-pill">${label}</span>` : `<span class="rr-in">in ${esc(fmtDur(s - now))}</span>`}
      </li>`;
    }).join('');
  }

  function openRift() {
    openModal({
      title: 'Spacetime Rift',
      body: `<div id="rift-live">
          <div class="rift-status">
            <span class="rs-ico">${icon('rift')}</span>
            <div class="rs-text"><b class="rs-title"></b><small class="rs-sub"></small></div>
            <div class="rs-count"><small class="rs-timer-label"></small><b class="rs-timer"></b></div>
            <button type="button" class="rs-bell" data-m="alerts" aria-haspopup="dialog">${icon('bell')}<i></i></button>
          </div>
          <p class="fine rift-note">Portals open every 3 hours at 02:00, 05:00, 08:00, 11:00, 14:00, 17:00, 20:00 and 23:00 (GMT+3 server time),
            shown below in your own time. You can only enter during the <b>first 5 minutes</b>; the rift then stays active for the rest of the hour.</p>
          <ul class="rift-list"></ul>
        </div>`,
      footer: '<button class="btn primary" data-m="close">Done</button>',
      actions: { alerts() { openRiftAlerts(); } },
    });
    updateRift(Date.now());
  }

  // Portal alert setup, opened from the bell on the rift window.
  function openRiftAlerts() {
    const saveAlert = patch => {
      Object.assign(state.settings.riftAlert, patch);
      save();
      const box = $('#rift-alerts', m);
      if (box) { box.className = `rift-alerts ${state.settings.riftAlert.on ? 'is-on' : ''}`; box.innerHTML = riftAlertHTML(); }
      updateRift(Date.now());
    };
    const m = openModal({
      title: 'Portal alert',
      body: `<section class="rift-alerts ${state.settings.riftAlert.on ? 'is-on' : ''}" id="rift-alerts">${riftAlertHTML()}</section>`,
      footer: '<button class="btn primary" data-m="close">Done</button>',
      onChange(e) {
        const t = e.target;
        if (t.id === 'ra-on') {
          if (t.checked) getAudio(); // this click lets the browser play the alert sound later
          saveAlert({ on: t.checked });
          if (t.checked) toast(`Portal alert on: ${state.settings.riftAlert.lead ? `${state.settings.riftAlert.lead} min before` : 'on time'}.`, { type: 'ok' });
        } else if (t.id === 'ra-vol') {
          saveAlert({ volume: num(t.value, 0.7) });
          playRiftSound(state.settings.riftAlert.sound, state.settings.riftAlert.volume);
        } else if (t.id === 'ra-desktop') {
          if (!t.checked) { saveAlert({ desktop: false }); return; }
          if (!('Notification' in window)) {
            t.checked = false;
            toast('This browser doesn\'t support desktop notifications.', { type: 'bad' });
            return;
          }
          Notification.requestPermission().then(p => {
            if (p === 'granted') saveAlert({ desktop: true });
            else {
              saveAlert({ desktop: false });
              toast('Desktop notifications are blocked for this site. Allow them in your browser\'s site settings, then try again.', { type: 'bad', timeout: 9000 });
            }
          });
        }
      },
      actions: {
        'ra-lead'(b) { saveAlert({ lead: num(b.dataset.value, 2) }); },
        'ra-sound'(b) {
          saveAlert({ sound: b.dataset.value });
          playRiftSound(b.dataset.value, state.settings.riftAlert.volume);
          const again = $(`[data-m="ra-sound"][data-value="${b.dataset.value}"]`, m);
          if (again) again.focus();
        },
        'ra-test'() {
          const r = riftState();
          fireRiftAlert(r.next, Date.now(), state.settings.riftAlert, true);
        },
      },
    });
  }

  /* ---------- 8. Modals ---------- */

  function openModal({ title, body, footer = '', size = '', actions = {}, onInput, onChange, onClose }) {
    const wrap = document.createElement('div');
    const titleId = 'm-' + uid();
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <header class="modal-head">
        <h2 id="${titleId}">${esc(title)}</h2>
        <button class="icon-btn" data-m="close" aria-label="Close">${icon('x')}</button>
      </header>
      <div class="modal-body">${body}</div>
      ${footer ? `<footer class="modal-foot">${footer}</footer>` : ''}
    </div>`;
    wrap._prevFocus = document.activeElement;
    wrap._onClose = onClose;
    let downOnBackdrop = false;
    wrap.addEventListener('mousedown', e => { downOnBackdrop = e.target === wrap; });
    wrap.addEventListener('click', e => {
      if (e.target === wrap && downOnBackdrop) return closeModal(wrap);
      const b = e.target.closest('[data-m]');
      if (!b || b.disabled) return;
      const a = b.dataset.m;
      if (a === 'close' || a === 'cancel') return closeModal(wrap);
      if (actions[a]) actions[a](b, e);
    });
    wrap.addEventListener('submit', e => {
      e.preventDefault();
      e.stopPropagation();
      if (actions.submit) actions.submit(e.target, e);
    });
    if (onInput) wrap.addEventListener('input', onInput);
    if (onChange) wrap.addEventListener('change', onChange);
    $('#modal-root').appendChild(wrap);
    document.body.classList.add('modal-open');
    setTimeout(() => {
      const f = wrap.querySelector('[autofocus]') || wrap.querySelector('.modal-body input, .modal-body select, .modal-body textarea, .modal-foot .btn');
      if (f) f.focus();
    }, 30);
    return wrap;
  }

  function closeModal(wrap) {
    if (!wrap || !wrap.isConnected) return;
    if (wrap._onClose) wrap._onClose();
    wrap.remove();
    const pf = wrap._prevFocus;
    if (pf && pf.isConnected && pf.focus) pf.focus({ preventScroll: true });
    if (!$('#modal-root').children.length) {
      document.body.classList.remove('modal-open');
      applyPendingRemote(); // a change from another device that arrived while a dialog was open
    }
  }

  const closeAllModals = () => $$('.modal-backdrop', $('#modal-root')).forEach(closeModal);

  function confirmModal({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm }) {
    const m = openModal({
      title, size: 'sm',
      body: `<p>${message}</p>`,
      footer: `<button class="btn ghost" data-m="cancel">Cancel</button>
               <button class="btn ${danger ? 'danger' : 'primary'}" data-m="ok" autofocus>${esc(confirmLabel)}</button>`,
      actions: { ok: () => { closeModal(m); onConfirm(); } },
    });
  }

  /* Add / edit character */
  function openCharModal(c) {
    const isNew = !c;
    const currentMain = mainChar();
    const v = c || { name: '', role: currentMain ? 'alt' : 'main', cls: '', race: '', level: 1, server: '', notes: '' };
    const roleNote = role => {
      if (role === 'main' && currentMain && currentMain !== c) return `Saving makes this character your main. <b>${esc(currentMain.name)}</b> becomes an alt.`;
      if (role === 'alt' && c && c.role === 'main') return 'You will have no main until you choose one. Duty Missions only show on your main.';
      return '';
    };
    const m = openModal({
      title: isNew ? 'Add character' : `Edit ${c.name}`,
      body: `<form id="char-form" class="form-grid" novalidate>
        <label class="field span-2"><span>Name <em>*</em></span>
          <input name="name" required maxlength="40" value="${esc(v.name)}" autocomplete="off" autofocus>
          <small class="err" hidden>Please enter a name.</small></label>
        <fieldset class="role-pick span-2">
          <legend>Role</legend>
          <label class="role-opt">
            <input type="radio" name="role" value="main" ${v.role === 'main' ? 'checked' : ''}>
            <span><b>${icon('crown')}Main</b><small>Your one main character. Server-wide dailies like Duty Missions are tracked here.</small></span>
          </label>
          <label class="role-opt">
            <input type="radio" name="role" value="alt" ${v.role !== 'main' ? 'checked' : ''}>
            <span><b>Alt</b><small>Any number of alts. Main-only activities are hidden for them.</small></span>
          </label>
          <p class="fine role-note" ${roleNote(v.role) ? '' : 'hidden'}>${roleNote(v.role)}</p>
        </fieldset>
        <fieldset class="class-pick span-2">
          <legend>Class</legend>
          <div class="class-grid">
            ${CLASSES.map(k => `<label class="class-opt" style="--cc:${CLASS_COLORS[k]}" title="${esc(CLASS_INFO[k])}">
              <input type="radio" name="cls" value="${k}" ${canonClass(v.cls) === k ? 'checked' : ''}>
              <span class="co-card"><span class="co-emblem">${classEmblem(k)}</span><b>${k}</b><small>${esc(CLASS_INFO[k])}</small></span>
            </label>`).join('')}
          </div>
          ${v.cls && !CLASSES.includes(canonClass(v.cls)) ? `<label class="check-row"><input type="radio" name="cls" value="${esc(v.cls)}" checked> Keep "${esc(v.cls)}"</label>` : ''}
        </fieldset>
        <label class="field"><span>Race / faction</span>
          <select name="race" id="char-race">
            <option value="">Choose a faction</option>
            ${RACES.map(r => `<option value="${r}" ${r === v.race ? 'selected' : ''}>${r}</option>`).join('')}
            ${v.race && !RACES.includes(v.race) ? `<option value="${esc(v.race)}" selected>${esc(v.race)}</option>` : ''}
          </select></label>
        <label class="field"><span>Level</span><input name="level" type="number" min="1" max="999" value="${esc(v.level)}"></label>
        <label class="field"><span>Server <small class="region">${SERVER_REGION}</small></span>
          <select name="server" id="char-server">${serverOptions(RACES.includes(v.race) ? v.race : '', v.server)}</select></label>
        <label class="field span-2"><span>Notes</span><textarea name="notes" rows="2" maxlength="500" placeholder="Optional">${esc(v.notes)}</textarea></label>
      </form>`,
      footer: `<button type="button" class="btn ghost" data-m="cancel">Cancel</button>
               <button type="submit" form="char-form" class="btn primary">${isNew ? 'Add character' : 'Save changes'}</button>`,
      onChange(e) {
        const raceSel = $('#char-race', m), serverSel = $('#char-server', m);
        if (e.target === raceSel) {
          // Show only this faction's servers; clear the server if it belongs to the other faction.
          const keep = factionOfServer(serverSel.value) === raceSel.value || !factionOfServer(serverSel.value) ? serverSel.value : '';
          serverSel.innerHTML = serverOptions(RACES.includes(raceSel.value) ? raceSel.value : '', keep);
          return;
        }
        if (e.target === serverSel) {
          const f = factionOfServer(serverSel.value);
          if (f && raceSel.value !== f) {
            raceSel.value = f;
            serverSel.innerHTML = serverOptions(f, serverSel.value);
          }
          return;
        }
        if (e.target.name !== 'role') return;
        const note = $('.role-note', m);
        note.innerHTML = roleNote(e.target.value);
        note.hidden = !note.innerHTML;
      },
      actions: {
        submit(form) {
          const fd = new FormData(form);
          const name = String(fd.get('name') || '').trim();
          if (!name) {
            $('.err', form).hidden = false;
            form.elements.name.focus();
            return;
          }
          const data = {
            name,
            role: fd.get('role') === 'main' ? 'main' : 'alt',
            cls: String(fd.get('cls') || '').trim(),
            race: String(fd.get('race') || '').trim(),
            level: clamp(Math.round(num(fd.get('level'), 1)), 1, 999),
            server: String(fd.get('server') || '').trim(),
            notes: String(fd.get('notes') || '').trim(),
          };
          if (data.role === 'main') for (const other of state.characters) other.role = 'alt';
          if (isNew) {
            const sch = schedule();
            const nc = normChar({ ...data, id: uid(), created: Date.now(), daily: { period: sch.dailyStart }, weekly: { period: sch.weeklyStart } });
            state.characters.push(nc);
            state.ui.active = nc.id;
            toast(`${name} added.`, { type: 'ok' });
          } else {
            Object.assign(c, normChar({ ...c, ...data }));
            toast('Character updated.', { type: 'ok' });
          }
          save();
          closeModal(m);
          render();
        },
      },
    });
  }

  // Deleting needs a deliberate confirmation: the button only works once DELETE has been typed.
  function deleteCharacter(c) {
    const notes = notesFor(c.id).length;
    const m = openModal({
      title: `Delete ${c.name}?`,
      size: 'sm',
      body: `<div class="danger-box">${icon('alert')}
          <div><p><b>This permanently removes ${esc(c.name)}</b>${c.role === 'main' ? ' (your main)' : ''}, including:</p>
          <ul>
            <li>Daily, weekly and one-time progress</li>
            <li>Leveling roadmap progress</li>
            <li>Stats, gear and Combat Power</li>
          </ul>
          <p class="fine">Weeks already archived in History are kept.${notes ? ` ${notes} note${notes === 1 ? '' : 's'} for this character will move to General.` : ''}</p></div>
        </div>
        <label class="field"><span>Type <b>DELETE</b> to confirm</span>
          <input id="delete-confirm" autocomplete="off" spellcheck="false" autofocus></label>`,
      footer: `<button class="btn ghost" data-m="cancel">Cancel</button>
               <button class="btn danger" data-m="confirm" id="delete-go" disabled>${icon('trash')}Delete character</button>`,
      onInput() {
        $('#delete-go', m).disabled = $('#delete-confirm', m).value.trim().toUpperCase() !== 'DELETE';
      },
      actions: {
        submit() { /* Enter in the field shouldn't delete by itself */ },
        confirm() {
          if ($('#delete-confirm', m).value.trim().toUpperCase() !== 'DELETE') return;
          closeModal(m);
          removeCharacter(c);
        },
      },
    });
  }

  function removeCharacter(c) {
    const index = state.characters.indexOf(c);
    const backup = clone(c);
    state.characters.splice(index, 1);
    delete statsDrafts[c.id];
    state.ui.active = 'overview';
    save();
    render();
    toast(`${c.name} deleted.`, {
      timeout: 10000,
      action: {
        label: 'Undo',
        fn() {
          state.characters.splice(Math.min(index, state.characters.length), 0, normChar(backup));
          processResets();
          state.ui.active = backup.id;
          save();
          render();
        },
      },
    });
  }

  /* Gear editor */
  function openGearModal(c) {
    const draft = clone(c.gear);
    const rarityOpts = sel => RARITIES.map(r => `<option value="${r.key}" ${r.key === sel ? 'selected' : ''}>${r.key}</option>`).join('');
    const total = () => fmtInt(GEAR_SLOTS.reduce((a, s) => a + itemScore(draft[s.key]), 0));
    const rows = GEAR_SLOTS.map(s => {
      const g = draft[s.key] || {};
      const rar = g.rarity || 'Common';
      return `<tr data-slot="${s.key}">
        <th scope="row">${esc(s.label)}</th>
        <td><input data-g="name" maxlength="60" value="${esc(g.name || '')}" placeholder="Item name" aria-label="${esc(s.label)} item name"></td>
        <td><select data-g="rarity" style="--rc:${rarityColor(rar)}" aria-label="${esc(s.label)} rarity">${rarityOpts(rar)}</select></td>
        <td><input data-g="ilvl" type="number" min="0" max="9999" value="${esc(g.ilvl != null && g.ilvl !== 0 ? g.ilvl : '')}" placeholder="0" aria-label="${esc(s.label)} item level"></td>
        <td><input data-g="enchant" type="number" min="0" max="99" value="${esc(g.enchant != null && g.enchant !== 0 ? g.enchant : '')}" placeholder="0" aria-label="${esc(s.label)} enchant"></td>
        <td class="num" data-score>${isEquipped(g) ? fmtInt(itemScore(g)) : '—'}</td>
        <td><button type="button" class="icon-btn xs" data-m="clear-slot" aria-label="Clear ${esc(s.label)}">${icon('x')}</button></td>
      </tr>`;
    }).join('');

    const m = openModal({
      title: `Gear — ${c.name}`,
      size: 'wide',
      body: `<p class="fine">Item score = item level &times; ${fmtNum(state.settings.scoring.ilvlWeight, 2)} &times; rarity multiplier + enchant &times; ${fmtNum(state.settings.scoring.enchantWeight, 2)}.</p>
        <div class="table-wrap"><table class="gear-table">
          <thead><tr><th>Slot</th><th>Item</th><th>Rarity</th><th>Item lvl</th><th>Enchant</th><th class="num">Score</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`,
      footer: `<span class="foot-total">Gear Score <b id="gear-total">${total()}</b></span>
               <button class="btn ghost" data-m="cancel">Cancel</button>
               <button class="btn primary" data-m="save">Save gear</button>`,
      onInput: onEdit,
      onChange: onEdit,
      actions: {
        'clear-slot'(b) {
          const tr = b.closest('tr');
          delete draft[tr.dataset.slot];
          $$('input', tr).forEach(i => { i.value = ''; });
          const selEl = $('select', tr);
          selEl.value = 'Common';
          selEl.style.setProperty('--rc', rarityColor('Common'));
          $('[data-score]', tr).textContent = '—';
          $('#gear-total').textContent = total();
        },
        save() {
          const clean = {};
          for (const s of GEAR_SLOTS) {
            const g = draft[s.key];
            if (!isEquipped(g)) continue;
            clean[s.key] = {
              name: String(g.name || '').trim().slice(0, 60),
              rarity: RARITIES.some(r => r.key === g.rarity) ? g.rarity : 'Common',
              ilvl: clamp(num(g.ilvl), 0, 9999),
              enchant: clamp(Math.round(num(g.enchant)), 0, 99),
            };
          }
          c.gear = clean;
          save();
          closeModal(m);
          render();
          toast('Gear saved.', { type: 'ok' });
        },
      },
    });

    function onEdit(e) {
      const field = e.target.dataset.g;
      const tr = e.target.closest('tr[data-slot]');
      if (!field || !tr) return;
      const g = draft[tr.dataset.slot] || (draft[tr.dataset.slot] = { name: '', rarity: 'Common', ilvl: 0, enchant: 0 });
      g[field] = field === 'ilvl' || field === 'enchant' ? num(e.target.value) : e.target.value;
      if (field === 'rarity') e.target.style.setProperty('--rc', rarityColor(g.rarity));
      $('[data-score]', tr).textContent = isEquipped(g) ? fmtInt(itemScore(g)) : '—';
      $('#gear-total').textContent = total();
    }
  }

  /* Settings */
  function openSettings(startTab = 'tasks') {
    const draft = { tasks: clone(state.tasks), settings: clone(state.settings) };
    let tab = startTab;
    let tzText = draft.settings.tz;
    const openDetails = new Set(); // task editor rows whose Details are expanded (kept across repaints)
    let taskKind = 'daily';        // which activity list the Tasks tab is showing
    // [key, label, icon, one-line description]
    const TABS = [
      ['tasks', 'Tasks', 'check', 'Activities and lists'],
      ['resets', 'Reset times', 'clock', 'Daily and weekly reset'],
      ['scoring', 'Scoring', 'sword', 'Gear and stat weights'],
      ['data', 'Data', 'download', 'Backup and restore'],
    ];

    const m = openModal({
      title: 'Settings',
      size: 'wide settings-modal',
      body: `<div class="settings-layout">
          <nav class="settings-nav" role="tablist" aria-label="Settings sections">
            ${TABS.map(([k, l, ic, d]) => `<button type="button" role="tab" class="snav-btn" data-m="tab" data-tab="${k}">
              <span class="snav-ico">${icon(ic)}</span><span class="snav-text"><b>${l}</b><small>${d}</small></span></button>`).join('')}
          </nav>
          <section class="settings-pane" aria-live="polite"></section>
        </div>`,
      footer: `<span class="fine foot-note">Changes apply when you save.</span>
               <button class="btn ghost" data-m="cancel">Cancel</button>
               <button class="btn primary" data-m="save">Save changes</button>`,
      onInput,
      actions: {
        tab(b) { tab = b.dataset.tab; paint(); },
        'add-task'(b) {
          const kind = b.dataset.kind;
          const id = uid();
          draft.tasks[kind].push(normTask({ id, name: 'New activity', count: 1 }));
          openDetails.add(id);
          paint();
          const inputs = $$(`li[data-kind="${kind}"] .te-name`, m);
          const last = inputs[inputs.length - 1];
          if (last) { last.focus(); last.select(); }
        },
        up(b) { move(b, -1); },
        down(b) { move(b, 1); },
        'task-kind'(b) { taskKind = b.dataset.kind; paint(); },
        'toggle-off'(b) {
          const li = b.closest('li');
          const task = draft.tasks[li.dataset.kind].find(t => t.id === li.dataset.id);
          if (!task) return;
          task.off = !task.off;
          paint();
          const again = $(`li[data-id="${li.dataset.id}"] [data-m="toggle-off"]`, m);
          if (again) again.focus();
        },
        'del-task'(b) {
          const li = b.closest('li');
          const list = draft.tasks[li.dataset.kind];
          list.splice(list.findIndex(t => t.id === li.dataset.id), 1);
          paint();
        },
        'default-tasks'() { draft.tasks = defaultTasks(); paint(); toast('Aion 2 activity lists restored. Save to keep them.'); },
        'preset-aion'() {
          Object.assign(draft.settings, defaultSchedule());
          tzText = draft.settings.tz;
          paint();
        },
        'use-local-tz'() { tzText = USER_TZ; draft.settings.tz = USER_TZ; paint(); },
        'reset-scoring'() { draft.settings.scoring = defaultScoring(); paint(); },
        'share-export'(b) {
          const what = b.dataset.what;
          openShareExport(what, what === 'tasks' ? shareableTasks(draft.tasks) : clone(draft.settings.scoring));
        },
        'share-import'(b) {
          const what = b.dataset.what;
          openShareImport(what, (data, mode) => {
            if (what === 'tasks') draft.tasks = mergeTasks(draft.tasks, data, mode);
            else draft.settings.scoring = normScoring(data);
            paint();
            toast(`${what === 'tasks' ? 'Lists' : 'Weights'} imported. Click Save changes to keep them.`, { type: 'ok', timeout: 6000 });
          });
        },
        export: exportData,
        import() { openImport(m); },
        clear() { openClearAll(); },
        save() {
          if (!validTz(tzText)) {
            tab = 'resets';
            paint();
            toast('Please enter a valid time zone before saving.', { type: 'bad' });
            return;
          }
          draft.settings.tz = tzText.trim();
          for (const kind of KINDS) {
            draft.tasks[kind] = draft.tasks[kind].map(t => normTask({ ...t, name: String(t.name).trim() || 'Untitled task' }));
          }
          applySettings(draft.settings, draft.tasks);
          closeModal(m);
          toast('Settings saved.', { type: 'ok' });
        },
      },
    });

    function move(b, dir) {
      const li = b.closest('li');
      const list = draft.tasks[li.dataset.kind];
      const i = list.findIndex(t => t.id === li.dataset.id);
      const j = i + dir;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      paint();
      const btn = $(`li[data-id="${li.dataset.id}"] [data-m="${dir < 0 ? 'up' : 'down'}"]`, m);
      if (btn && !btn.disabled) btn.focus();
    }

    function onInput(e) {
      const t = e.target;
      if (t.dataset.te) {
        const li = t.closest('li[data-id]');
        const task = draft.tasks[li.dataset.kind].find(x => x.id === li.dataset.id);
        if (!task) return;
        const f = t.dataset.te;
        task[f] = f === 'count' ? clamp(Math.round(num(t.value, 1)), 1, 99) : f === 'mainOnly' ? t.checked : t.value;
      } else if (t.dataset.rs) {
        const s = draft.settings;
        if (t.dataset.rs === 'tz') {
          tzText = t.value;
          if (validTz(tzText.trim())) s.tz = tzText.trim();
        } else if (t.dataset.rs === 'weekday') {
          s.weekly.weekday = +t.value;
        } else if (/^\d{1,2}:\d{2}$/.test(t.value)) {
          const [h, mi] = t.value.split(':').map(Number);
          Object.assign(s[t.dataset.rs], { hour: h, minute: mi });
        }
        paintPreview();
      } else if (t.dataset.sc) {
        draft.settings.scoring[t.dataset.sc] = num(t.value);
      } else if (t.dataset.scR) {
        draft.settings.scoring.rarity[t.dataset.scR] = num(t.value, 1);
      } else if (t.dataset.scS) {
        draft.settings.scoring.stats[t.dataset.scS] = num(t.value);
      }
    }

    function paint() {
      $$('.snav-btn', m).forEach(b => {
        const on = b.dataset.tab === tab;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on);
      });
      const pane = $('.settings-pane', m);
      const [, label, ic, desc] = TABS.find(t => t[0] === tab);
      const scrollTop = pane.scrollTop;
      pane.innerHTML = `<header class="pane-head"><span class="pane-ico">${icon(ic)}</span><div><h3>${label}</h3><p>${desc}</p></div></header>` +
        (tab === 'tasks' ? tasksPane() : tab === 'resets' ? resetsPane() : tab === 'scoring' ? scoringPane() : dataPane());
      pane.scrollTop = scrollTop;
      if (tab === 'resets') paintPreview();
      $('.modal-foot', m).classList.toggle('is-muted', tab === 'data');
    }

    function tasksPane() {
      const editor = kind => {
        const list = draft.tasks[kind];
        const hiddenCount = list.filter(t => t.off).length;
        return `<section class="task-editor ${kind}">
          <header><h3>${KIND_LABEL[kind]}</h3><span class="fine">${list.length} activit${list.length === 1 ? 'y' : 'ies'}${hiddenCount ? ` · ${hiddenCount} hidden` : ''}</span></header>
          <ol class="te-list">${list.map((t, i) => `<li class="te-item ${t.off ? 'is-off' : ''}" data-kind="${kind}" data-id="${esc(t.id)}">
            <div class="te-row">
              <button type="button" class="icon-btn xs te-eye" data-m="toggle-off" aria-pressed="${!t.off}"
                aria-label="${t.off ? 'Show' : 'Hide'} ${esc(t.name)}" title="${t.off ? 'Hidden: not shown or counted. Click to show again.' : 'Shown. Click to hide for everyone.'}">${icon(t.off ? 'eyeOff' : 'eye')}</button>
              <input class="te-name" data-te="name" value="${esc(t.name)}" maxlength="80" aria-label="Activity name">
              <label class="te-count" title="How many times ${kind === 'static' ? 'in total' : 'per reset'}, e.g. 14 dungeon runs"><span>&times;</span>
                <input type="number" data-te="count" min="1" max="99" value="${t.count}" aria-label="Times ${kind === 'static' ? 'in total' : 'per reset'}"></label>
              <span class="te-btns">
                <button type="button" class="icon-btn xs" data-m="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('up')}</button>
                <button type="button" class="icon-btn xs" data-m="down" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move down">${icon('down')}</button>
                <button type="button" class="icon-btn xs danger-text" data-m="del-task" aria-label="Delete activity">${icon('trash')}</button>
              </span>
            </div>
            <details class="te-more" ${openDetails.has(t.id) ? 'open' : ''}>
              <summary>Details${t.off ? ' · Hidden' : ''}${t.mainOnly ? ' · Main only' : ''}${t.location ? ' · ' + esc(t.location) : ''}</summary>
              <div class="te-fields">
                <label class="field"><span>Description</span><input data-te="desc" maxlength="120" value="${esc(t.desc)}" placeholder="e.g. 14 dungeon entries"></label>
                <label class="field"><span>Location</span><input data-te="location" maxlength="60" value="${esc(t.location)}" placeholder="e.g. Journal → Duty"></label>
                <label class="field span-2"><span>Info (shown behind the &#9432; button)</span><textarea data-te="info" rows="2" maxlength="400" placeholder="Optional">${esc(t.info)}</textarea></label>
                <label class="check-row span-2"><input type="checkbox" data-te="mainOnly" ${t.mainOnly ? 'checked' : ''}> Main character only (hidden for alts)</label>
              </div>
            </details>
          </li>`).join('') || '<li class="te-empty">No activities yet.</li>'}</ol>
          <button type="button" class="btn ghost sm" data-m="add-task" data-kind="${kind}">${icon('plus')}Add ${KIND_LABEL[kind].toLowerCase()} activity</button>
        </section>`;
      };
      return `<p class="fine">These lists are shared by all characters. Use <b>&times;</b> for activities done several times (e.g. 14 dungeon runs).
        Click the ${icon('eye')} to <b>hide</b> an activity that isn't unlocked yet: it disappears for every character and doesn't count toward any day or week until you show it again.
        Open <b>Details</b> to add a description, location, info text, or to limit an activity to your main.</p>
        <div class="seg sub-seg" role="tablist" aria-label="Activity list">
          ${KINDS.map(k => `<button type="button" role="tab" class="seg-btn ${k} ${k === taskKind ? 'is-active' : ''}" aria-selected="${k === taskKind}" data-m="task-kind" data-kind="${k}">
            ${KIND_LABEL[k]} <span class="seg-count">${draft.tasks[k].filter(t => !t.off).length}/${draft.tasks[k].length}</span></button>`).join('')}
        </div>
        ${editor(taskKind)}
        <div class="btn-row">
          <button type="button" class="btn ghost sm" data-m="share-export" data-what="tasks">${icon('upload')}Share my lists</button>
          <button type="button" class="btn ghost sm" data-m="share-import" data-what="tasks">${icon('download')}Import lists</button>
          <button type="button" class="btn ghost sm" data-m="default-tasks">${icon('refresh')}Restore Aion 2 activities</button>
        </div>`;
    }

    function resetsPane() {
      const s = draft.settings;
      const hm = t => `${pad2(t.hour)}:${pad2(t.minute)}`;
      return `<p class="fine">Resets are set in the game server's reference time zone and then shown in your own time zone (<b>${esc(USER_TZ)}</b>). Aion 2's weekly reset is Wednesday 09:00 server time, which is 16:00 in Qatar (Asia/Qatar).</p>
        <div class="form-grid">
          <label class="field span-2"><span>Reference time zone</span>
            <input data-rs="tz" list="tz-list" value="${esc(tzText)}" autocomplete="off" spellcheck="false">
            <small>Any IANA name, e.g. Asia/Qatar, Europe/Berlin, UTC.</small></label>
          <datalist id="tz-list">${TZ_SUGGEST.concat(USER_TZ).filter((v, i, a) => a.indexOf(v) === i).map(z => `<option value="${esc(z)}">`).join('')}</datalist>
          <label class="field"><span>Daily reset time</span><input type="time" data-rs="daily" value="${hm(s.daily)}"></label>
          <span></span>
          <label class="field"><span>Weekly reset day</span>
            <select data-rs="weekday">${WEEKDAYS.map((d, i) => `<option value="${i}" ${i === s.weekly.weekday ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
          <label class="field"><span>Weekly reset time</span><input type="time" data-rs="weekly" value="${hm(s.weekly)}"></label>
        </div>
        <div class="btn-row">
          <button type="button" class="btn ghost sm" data-m="preset-aion">Use Aion 2 default (Wed 16:00 Qatar)</button>
          <button type="button" class="btn ghost sm" data-m="use-local-tz">Use my time zone</button>
        </div>
        <div class="preview" id="reset-preview" aria-live="polite"></div>`;
    }

    function paintPreview() {
      const el = $('#reset-preview', m);
      if (!el) return;
      if (!validTz(tzText.trim())) {
        el.innerHTML = `<p class="err">"${esc(tzText)}" is not a time zone this browser recognises.</p>`;
        return;
      }
      const now = Date.now();
      const sch = schedule(draft.settings, now);
      el.innerHTML = `<h4>In your time (${esc(USER_TZ)})</h4>
        <dl class="kv">
          <div><dt>Next daily reset</dt><dd>${esc(fmtWhen.format(sch.dailyNext))} <span class="fine">in ${fmtDur(sch.dailyNext - now)}</span></dd></div>
          <div><dt>Next weekly reset</dt><dd>${esc(fmtWhen.format(sch.weeklyNext))} <span class="fine">in ${fmtDur(sch.weeklyNext - now)}</span></dd></div>
          <div><dt>This week started</dt><dd>${esc(fmtWhen.format(sch.weeklyStart))}</dd></div>
        </dl>
        <p class="fine">Changing the reset time keeps the progress you've already ticked in the current period.</p>`;
    }

    function scoringPane() {
      const sc = draft.settings.scoring;
      const field = (label, attr, value, step = 'any') =>
        `<label class="field"><span>${esc(label)}</span><input type="number" step="${step}" ${attr} value="${esc(value)}"></label>`;
      return `<p class="fine">Item score = item level &times; level weight &times; rarity multiplier + enchant level &times; enchant weight.
        Gear Score is the total over all ${GEAR_SLOTS.length} slots. Stat Score = sum of each stat &times; its weight. Calculated score = Gear Score + Stat Score.
        These are tracking scores for comparing your own characters, not the game's official numbers.</p>
        <div class="form-grid cols-3">
          ${field('Item level weight', 'data-sc="ilvlWeight"', sc.ilvlWeight)}
          ${field('Enchant weight (per +1)', 'data-sc="enchantWeight"', sc.enchantWeight)}
        </div>
        <h4 class="sub">Rarity multipliers</h4>
        <div class="form-grid cols-3">
          ${RARITIES.map(r => `<label class="field"><span style="color:${r.color}">${r.key}</span><input type="number" step="any" data-sc-r="${r.key}" value="${esc(sc.rarity[r.key])}"></label>`).join('')}
        </div>
        <h4 class="sub">Stat weights</h4>
        <div class="form-grid cols-3">
          ${STAT_DEFS.map(d => field(d.label, `data-sc-s="${d.key}"`, sc.stats[d.key])).join('')}
        </div>
        <div class="btn-row">
          <button type="button" class="btn ghost sm" data-m="share-export" data-what="scoring">${icon('upload')}Share my weights</button>
          <button type="button" class="btn ghost sm" data-m="share-import" data-what="scoring">${icon('download')}Import weights</button>
          <button type="button" class="btn ghost sm" data-m="reset-scoring">${icon('refresh')}Restore default weights</button>
        </div>`;
    }

    function dataPane() {
      let bytes = 0;
      try { bytes = (localStorage.getItem(STORE_KEY) || '').length; } catch (e) { /* storage blocked */ }
      return `<p class="fine">${storageSummary()} This browser's copy uses ${fmtNum(bytes / 1024)} KB.
        The buttons below act immediately and don't need Save.</p>
        <div class="data-actions">
          <div class="data-card">
            <h4>${icon('download')}Export backup</h4>
            <p class="fine">Copy or download all characters, history and settings as a backup.</p>
            <button type="button" class="btn ghost sm" data-m="export">Export…</button>
          </div>
          <div class="data-card">
            <h4>${icon('upload')}Import backup</h4>
            <p class="fine">Replace the current data with a backup made by Export, from this or another device.</p>
            <button type="button" class="btn ghost sm" data-m="import">Import…</button>
          </div>
          ${canClearAll ? `<div class="data-card danger">
            <h4>${icon('trash')}Clear all data</h4>
            <p class="fine">Delete every character, their progress and all history. Asks for confirmation.</p>
            <button type="button" class="btn danger sm" data-m="clear">Clear all data…</button>
          </div>` : ''}
        </div>`;
    }

    // "toggle" doesn't bubble, so listen in the capture phase.
    m.addEventListener('toggle', e => {
      const li = e.target.closest && e.target.closest('li[data-id]');
      if (!li || !e.target.matches('.te-more')) return;
      if (e.target.open) openDetails.add(li.dataset.id); else openDetails.delete(li.dataset.id);
    }, true);

    paint();
  }

  // Saves new settings; keeps the current period's progress when reset times change.
  function applySettings(settings, tasks) {
    const oldSch = schedule(state.settings);
    const newSch = schedule(settings);
    for (const c of state.characters) {
      if (c.daily.period === oldSch.dailyStart) c.daily.period = newSch.dailyStart;
      if (c.weekly.period === oldSch.weeklyStart) c.weekly.period = newSch.weeklyStart;
    }
    state.settings = settings;
    state.tasks = tasks;
    const ids = new Set(KINDS.flatMap(k => tasks[k]).map(t => t.id));
    for (const c of state.characters) {
      for (const kind of KINDS) {
        for (const id of Object.keys(c[kind].prog)) if (!ids.has(id)) delete c[kind].prog[id];
      }
      for (const id of Object.keys(c.hidden)) if (!ids.has(id)) delete c.hidden[id];
    }
    processResets();
    save();
    render();
  }

  // Shows the backup as text to copy, with a download button where the browser allows downloads.
  function exportData() {
    const json = JSON.stringify({ app: 'aion2-progress-tracker', exportedAt: new Date().toISOString(), data: state }, null, 2);
    const d = new Date();
    // Embedded/hosted copies of the page can't start downloads, so only offer one when running locally.
    const canDownload = SERVED_BY_APP_SERVER || location.protocol === 'file:';
    const fileName = `aion2-tracker-backup-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}.json`;
    const m = openModal({
      title: 'Export backup',
      body: `<p class="fine">Copy this text and keep it somewhere safe${canDownload ? ', or download it as a file' : ', for example in a note or text file'}. Use Import on any device to restore it.</p>
        <textarea id="export-text" class="code-box" rows="12" readonly spellcheck="false">${esc(json)}</textarea>`,
      footer: `${canDownload ? `<button class="btn ghost" data-m="download">${icon('download')}Download file</button>` : ''}
               <button class="btn primary" data-m="copy" autofocus>Copy to clipboard</button>`,
      actions: {
        async copy() {
          const ta = $('#export-text', m);
          ta.focus();
          ta.select();
          try {
            await navigator.clipboard.writeText(json);
            toast('Backup copied to the clipboard.', { type: 'ok' });
          } catch (e) {
            try {
              document.execCommand('copy');
              toast('Backup copied to the clipboard.', { type: 'ok' });
            } catch (e2) {
              toast('Copy was blocked. The text is selected; press Ctrl+C to copy it.', { type: 'bad', timeout: 6000 });
            }
          }
        },
        download() {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
          toast('Backup downloaded.', { type: 'ok' });
        },
      },
    });
  }

  /* Sharing activity lists and scoring weights between people (Settings → Tasks / Scoring).
     A share is JSON text: { app, share: 'tasks' | 'scoring', version, data }. */

  const SHARE_LABEL = { tasks: 'activity lists', scoring: 'scoring weights' };

  // Only the parts worth sharing: no ids or progress, which are personal.
  function shareableTasks(tasks) {
    const out = {};
    for (const kind of KINDS) {
      out[kind] = tasks[kind].map(t => {
        const s = { name: t.name, count: t.count };
        for (const f of ['desc', 'location', 'info']) if (t[f]) s[f] = t[f];
        if (t.mainOnly) s.mainOnly = true;
        if (t.off) s.off = true;
        if (t.key) s.key = t.key;
        return s;
      });
    }
    return out;
  }

  // Applies someone's shared lists. Activities that match one of yours (same official activity, or same
  // name in the same list) keep your existing one's id, so your progress on it carries over.
  function mergeTasks(existing, incoming, mode) {
    const out = {};
    for (const kind of KINDS) {
      const mine = existing[kind];
      const theirs = (isObj(incoming) && Array.isArray(incoming[kind]) ? incoming[kind] : []).filter(isObj).slice(0, 60);
      const used = new Set();
      const mapped = theirs.map(t => {
        const m = mine.find(x => !used.has(x.id) && ((t.key && x.key === t.key) || lower(x.name) === lower(t.name)));
        const k = t.key || (m && m.key);
        const entry = k && CATALOG.find(e => e.key === k);
        let id = m ? m.id : (entry ? 'cat-' + entry.key : uid());
        if (used.has(id) || (!m && mine.some(x => x.id === id))) id = uid();
        used.add(id);
        // Linked to the official list at its current version, so their values count as deliberate edits.
        return normTask({ ...t, id, key: entry ? entry.key : '', rev: entry ? entry.rev : 0, official: entry ? officialOf(entry) : null });
      });
      out[kind] = mode === 'merge'
        ? mine.concat(mapped.filter(t => !mine.some(x => x.id === t.id)))
        : mapped;
    }
    return out;
  }

  function normScoring(sc) {
    const d = defaultScoring();
    sc = isObj(sc) ? sc : {};
    const nums = (src, base) => Object.fromEntries(Object.keys(base).map(k => [k, num(isObj(src) ? src[k] : undefined, base[k])]));
    return {
      ilvlWeight: num(sc.ilvlWeight, d.ilvlWeight),
      enchantWeight: num(sc.enchantWeight, d.enchantWeight),
      rarity: nums(sc.rarity, d.rarity),
      stats: nums(sc.stats, d.stats),
    };
  }

  function openShareExport(what, data) {
    const json = JSON.stringify({ app: 'aion2-progress-tracker', share: what, version: 1, data }, null, 2);
    const canDownload = SERVED_BY_APP_SERVER || location.protocol === 'file:';
    const m = openModal({
      title: `Share my ${SHARE_LABEL[what]}`,
      body: `<p class="fine">Send this to a friend (Discord, email, a text file). They open Settings &rarr; ${what === 'tasks' ? 'Tasks' : 'Scoring'} &rarr; <b>Import</b> and paste it.
          ${what === 'tasks' ? 'Only the lists are shared, never your characters or progress.' : ''}</p>
        <textarea id="share-text" class="code-box" rows="12" readonly spellcheck="false">${esc(json)}</textarea>`,
      footer: `${canDownload ? `<button class="btn ghost" data-m="download">${icon('download')}Download file</button>` : ''}
               <button class="btn primary" data-m="copy" autofocus>Copy to clipboard</button>`,
      actions: {
        async copy() {
          const ta = $('#share-text', m);
          ta.focus();
          ta.select();
          try { await navigator.clipboard.writeText(json); toast('Copied. Paste it to your friend.', { type: 'ok' }); }
          catch (e) {
            try { document.execCommand('copy'); toast('Copied. Paste it to your friend.', { type: 'ok' }); }
            catch (e2) { toast('Copy was blocked. The text is selected; press Ctrl+C to copy it.', { type: 'bad', timeout: 6000 }); }
          }
        },
        download() {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
          a.download = `aion2-${what === 'tasks' ? 'activity-lists' : 'scoring-weights'}.json`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        },
      },
    });
  }

  function openShareImport(what, onApply) {
    const m = openModal({
      title: `Import ${SHARE_LABEL[what]}`,
      body: `<p class="fine">Paste what a friend shared with you, or choose their file. Nothing changes until you click <b>Save changes</b> in Settings.</p>
        <textarea id="share-in" class="code-box" rows="10" spellcheck="false" placeholder='{ "app": "aion2-progress-tracker", "share": "${what}", ... }' autofocus></textarea>
        <div class="btn-row">
          <button type="button" class="btn ghost sm" data-m="pick">${icon('upload')}Choose file…</button>
          <input type="file" id="share-file" accept="application/json,.json,.txt" hidden>
        </div>
        ${what === 'tasks' ? `<fieldset class="share-mode">
          <legend class="fine">How to import</legend>
          <label class="check-row"><input type="radio" name="share-mode" value="merge" checked> Add only activities I don't have yet</label>
          <label class="check-row"><input type="radio" name="share-mode" value="replace"> Replace my lists with theirs (progress on matching activities is kept)</label>
        </fieldset>` : ''}`,
      footer: `<button class="btn ghost" data-m="cancel">Cancel</button>
               <button class="btn primary" data-m="go">Import</button>`,
      onChange(e) {
        const file = e.target.id === 'share-file' && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => { $('#share-in', m).value = String(reader.result); };
        reader.readAsText(file);
      },
      actions: {
        pick() { $('#share-file', m).click(); },
        go() {
          let parsed;
          try { parsed = JSON.parse($('#share-in', m).value.trim()); } catch (e) { parsed = null; }
          let data = null;
          if (isObj(parsed) && parsed.share === what && isObj(parsed.data)) data = parsed.data;
          // A full backup (Settings → Data → Export) works too.
          else if (isObj(parsed) && isObj(parsed.data) && what === 'tasks' && isObj(parsed.data.tasks)) data = parsed.data.tasks;
          else if (isObj(parsed) && isObj(parsed.data) && what === 'scoring' && isObj(parsed.data.settings)) data = parsed.data.settings.scoring;
          if (!data) {
            toast(`That isn't a shared ${SHARE_LABEL[what].replace(/s$/, '')} list. Ask your friend to use "Share my ${what === 'tasks' ? 'lists' : 'weights'}".`, { type: 'bad', timeout: 7000 });
            return;
          }
          const modeInput = $('input[name="share-mode"]:checked', m);
          closeModal(m);
          onApply(data, modeInput ? modeInput.value : 'replace');
        },
      },
    });
  }

  function openImport(settingsModal) {
    const m = openModal({
      title: 'Import backup',
      body: `<p class="fine">Paste the text from Export, or choose a backup file. Importing replaces everything currently saved in this browser.</p>
        <textarea id="import-text" class="code-box" rows="10" spellcheck="false" placeholder='{ "app": "aion2-progress-tracker", ... }' autofocus></textarea>
        <div class="btn-row">
          <button type="button" class="btn ghost sm" data-m="pick">${icon('upload')}Choose file…</button>
          <input type="file" id="import-file" accept="application/json,.json" hidden>
        </div>`,
      footer: `<button class="btn ghost" data-m="cancel">Cancel</button>
               <button class="btn primary" data-m="go">Import</button>`,
      onChange(e) {
        const file = e.target.id === 'import-file' && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => importData(String(reader.result), [m, settingsModal]);
        reader.readAsText(file);
      },
      actions: {
        pick() { $('#import-file', m).click(); },
        go() {
          const text = $('#import-text', m).value.trim();
          if (!text) { toast('Paste a backup first, or choose a file.', { type: 'bad' }); return; }
          importData(text, [m, settingsModal]);
        },
      },
    });
  }

  function importData(text, modalsToClose) {
    let incoming;
    try {
      const parsed = JSON.parse(text);
      const raw = isObj(parsed) && isObj(parsed.data) ? parsed.data : parsed;
      if (!isObj(raw) || (!Array.isArray(raw.characters) && !isObj(raw.tasks))) throw new Error('not a tracker file');
      incoming = normalize(raw);
    } catch (e) {
      toast('That is not a tracker backup. Use the text or file made by Export.', { type: 'bad', timeout: 6000 });
      return;
    }
    confirmModal({
      title: 'Replace current data?',
      message: `The backup has <b>${incoming.characters.length}</b> character(s) and <b>${incoming.history.length}</b> archived week(s). Importing replaces everything currently in this browser.`,
      confirmLabel: 'Import and replace',
      danger: true,
      onConfirm() {
        const backup = JSON.stringify(state);
        state = incoming;
        Object.keys(statsDrafts).forEach(k => delete statsDrafts[k]);
        processResets();
        save();
        modalsToClose.forEach(closeModal);
        render();
        toast('Backup imported.', { type: 'ok', timeout: 10000, action: { label: 'Undo', fn: () => restore(backup) } });
      },
    });
  }

  function restore(json) {
    state = normalize(JSON.parse(json));
    processResets();
    save();
    render();
    toast('Previous data restored.', { type: 'ok' });
  }

  /* Clear all data */
  function openClearAll() {
    if (!canClearAll) return;
    const n = state.characters.length, h = state.history.length;
    const m = openModal({
      title: 'Clear all data',
      body: `<div class="danger-box">${icon('alert')}
          <div><p><b>This permanently deletes:</b></p>
          <ul>
            <li>${n} character${n === 1 ? '' : 's'}, with their stats and gear</li>
            <li>All current daily and weekly progress</li>
            <li>${h} archived week${h === 1 ? '' : 's'} of history</li>
          </ul></div>
        </div>
        <label class="check-row"><input type="checkbox" id="keep-config" checked> Keep my task lists, reset times and scoring weights</label>
        <label class="field"><span>Type <b>DELETE</b> to confirm</span>
          <input id="confirm-text" autocomplete="off" spellcheck="false" autofocus></label>`,
      footer: `<button class="btn ghost" data-m="cancel">Cancel</button>
               <button class="btn danger" data-m="confirm" id="confirm-clear" disabled>Clear all data</button>`,
      onInput() {
        $('#confirm-clear', m).disabled = $('#confirm-text', m).value.trim().toUpperCase() !== 'DELETE';
      },
      actions: {
        submit() { /* Enter in the field should not clear anything by itself */ },
        confirm() {
          if ($('#confirm-text', m).value.trim().toUpperCase() !== 'DELETE') return;
          const backup = JSON.stringify(state);
          const fresh = defaultState();
          if ($('#keep-config', m).checked) {
            fresh.settings = state.settings;
            fresh.tasks = state.tasks;
          }
          state = fresh;
          Object.keys(statsDrafts).forEach(k => delete statsDrafts[k]);
          manageMode.clear();
          save();
          closeAllModals();
          render();
          toast('All data cleared.', { timeout: 15000, action: { label: 'Undo', fn: () => restore(backup) } });
        },
      },
    });
  }

  /* Weekly history */
  function openHistory() {
    let filter = '';
    const m = openModal({
      title: 'Weekly history',
      size: 'wide',
      body: `<div class="hist-toolbar">
          <label class="field inline"><span>Character</span><select id="hist-filter"></select></label>
          <span class="fine">Weeks are archived automatically at each weekly reset. Up to ${HISTORY_LIMIT} weeks are kept.</span>
        </div>
        <div id="hist-list"></div>`,
      footer: '<button class="btn primary" data-m="close">Done</button>',
      onChange(e) {
        if (e.target.id === 'hist-filter') { filter = e.target.value; paint(); }
      },
      actions: {
        'del-week'(b) {
          if (b.dataset.armed !== '1') {
            b.dataset.armed = '1';
            b.innerHTML = `${icon('trash')}Click again to delete`;
            return;
          }
          state.history = state.history.filter(x => String(x.start) !== b.dataset.start);
          save();
          paint();
          toast('Week removed from history.');
        },
      },
    });

    function paint() {
      const names = new Map();
      for (const c of state.characters) names.set(c.id, c.name);
      for (const h of state.history) for (const x of h.chars) if (!names.has(x.id)) names.set(x.id, x.name);
      $('#hist-filter', m).innerHTML = `<option value="">All characters</option>` +
        Array.from(names).map(([id, name]) => `<option value="${esc(id)}" ${id === filter ? 'selected' : ''}>${esc(name)}</option>`).join('');

      const sch = schedule();
      const current = { start: sch.weeklyStart, end: sch.weeklyNext, live: true, chars: state.characters.map(c => snapshotChar(c, true)) };
      const weeks = (state.characters.length ? [current] : []).concat(state.history);
      const html = weeks.map((w, i) => weekHTML(w, i === 0)).filter(Boolean).join('');
      const s = state.settings;
      $('#hist-list', m).innerHTML = html || `<div class="empty small">
        <p>No archived weeks yet.</p>
        <p class="fine">The first week is archived automatically at the next weekly reset (${esc(fmtWhen.format(nextReset(Date.now(), s.tz, s.weekly.hour, s.weekly.minute, s.weekly.weekday)))}, your time).</p>
      </div>`;
    }

    function weekHTML(w, open) {
      const chars = filter ? w.chars.filter(x => x.id === filter) : w.chars;
      if (!chars.length) return '';
      let wd = 0, wt = 0, dd = 0, dt = 0;
      for (const x of chars) {
        wd += x.weekly.filter(t => t.prog >= t.count).length; wt += x.weekly.length;
        for (const d of x.days) { dd += d.done; dt += d.total; }
      }
      return `<details class="week ${w.live ? 'is-live' : ''}" ${open ? 'open' : ''}>
        <summary>
          <div class="wk-title">
            <b>${w.live ? 'This week (in progress)' : `Week of ${esc(fmtDay.format(w.start))}`}</b>
            <small>${esc(fmtWhen.format(w.start))} &rarr; ${esc(fmtWhen.format(w.end))}</small>
          </div>
          <div class="wk-sum"><span class="pill weekly">Weekly ${wd}/${wt}</span><span class="pill daily">Daily ${dd}/${dt}</span></div>
        </summary>
        <div class="wk-chars">
          ${chars.map(x => {
            const done = x.weekly.filter(t => t.prog >= t.count).length;
            const pct = x.weekly.length ? Math.round((done / x.weekly.length) * 100) : 0;
            return `<div class="wc" style="--cc:${classColor(x)}">
              <div class="wc-head">
                ${avatar({ name: x.name, cls: x.cls }, 'sm')}
                <div><b>${esc(x.name)}</b><small>${[`Lv ${x.level}`, x.cls].filter(Boolean).map(esc).join(' · ')}</small></div>
                <span class="wc-cp" title="${num(x.gameCp) ? 'Combat Power' : 'Calculated score'} when archived">${num(x.gameCp) ? `CP ${fmtInt(x.gameCp)}` : `Score ${fmtInt(x.cp)}`}</span>
              </div>
              <div class="wc-row"><span>Weekly ${done}/${x.weekly.length}</span>${bar(pct, `${x.name} weekly`)}</div>
              <ul class="chips">${x.weekly.map(t => `<li class="${t.prog >= t.count ? 'is-done' : ''}">${t.prog >= t.count ? icon('check') : icon('x')}${esc(t.name)}${t.count > 1 ? ` <i>${t.prog}/${t.count}</i>` : ''}</li>`).join('')}</ul>
              ${x.days.length ? `<div class="wc-days"><span class="fine">Dailies</span><div class="wl-days">${x.days.map(dayDot).join('')}</div></div>` : ''}
            </div>`;
          }).join('')}
        </div>
        ${w.live ? '' : `<div class="wk-foot"><button type="button" class="btn ghost xs danger-text" data-m="del-week" data-start="${w.start}">${icon('trash')}Delete this week</button></div>`}
      </details>`;
    }

    paint();
  }

  /* Toasts */
  function toast(msg, { type = 'info', action, timeout = 3500 } = {}) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', type === 'bad' ? 'alert' : 'status');
    el.innerHTML = `<span>${esc(msg)}</span>
      ${action ? `<button class="btn xs primary" data-t="action">${esc(action.label)}</button>` : ''}
      <button class="icon-btn xs" data-t="close" aria-label="Dismiss">${icon('x')}</button>`;
    const dismiss = () => { el.classList.add('is-out'); setTimeout(() => el.remove(), 250); };
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-t]');
      if (!b) return;
      if (b.dataset.t === 'action' && action) action.fn();
      dismiss();
    });
    $('#toasts').appendChild(el);
    setTimeout(dismiss, timeout);
  }

  /* ---------- 9. Events ---------- */

  function statsEqual(a, b) {
    const v = x => (x == null || x === '' ? '' : num(x));
    return STAT_DEFS.every(d => v(a[d.key]) === v(b[d.key]));
  }

  function saveStats(c) {
    const draft = statsDrafts[c.id];
    if (!draft) { toast('No changes to save.'); return; }
    const clean = {};
    for (const d of STAT_DEFS) {
      if (draft[d.key] !== '' && draft[d.key] != null) clean[d.key] = num(draft[d.key]);
    }
    const before = effectiveCp(c);
    c.stats = clean;
    delete statsDrafts[c.id];
    save();
    render();
    const after = effectiveCp(c);
    if (c.cpMode !== 'manual' && after && cpTier(after).index > (before ? cpTier(before).index : -1) && before) {
      toast(`Tier up! ${c.name} reached ${cpTier(after).name}.`, { type: 'ok', timeout: 6000 });
    } else toast('Stats saved.', { type: 'ok' });
  }

  // Quick level change from the character header. Opens the roadmap phase the new level lands in.
  function setLevel(c, level, el) {
    const v = clamp(Math.round(num(level, c.level)), 1, 999);
    if (v === c.level) { renderView(); return; }
    const before = ROADMAP.find(p => c.level >= p.min && c.level < p.max);
    c.level = v;
    const after = ROADMAP.find(p => v >= p.min && v < p.max);
    if (after && after !== before && rmOpen.has(c.id)) rmOpen.get(c.id).add(after.key);
    save();
    if (el) rerender(el); else render();
    if (after && before && after !== before) toast(`${c.name} reached ${after.levels}: ${after.name}.`, { type: 'ok' });
  }

  function setProgress(el, next) {
    const c = getChar(el.dataset.char);
    const t = c && state.tasks[el.dataset.kind].find(x => x.id === el.dataset.task);
    if (!t) return;
    c[el.dataset.kind].prog[t.id] = clamp(Math.round(next(c, t, progOf(c, el.dataset.kind, t))), 0, t.count);
    save();
    rerender(el);
  }

  function closeInfoPops(except) {
    for (const pop of $$('.info-pop')) {
      if (pop === except || pop.hidden) continue;
      pop.hidden = true;
      const btn = pop.previousElementSibling;
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
  }

  const actions = {
    tab(el) {
      state.ui.active = el.dataset.id;
      save({ sync: false }); // the open tab is remembered per device
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    'add-char'() { openCharModal(); },
    'edit-char'(el) { const c = getChar(el.dataset.char); if (c) openCharModal(c); },
    'delete-char'(el) { const c = getChar(el.dataset.char); if (c) deleteCharacter(c); },
    toggle(el) {
      const c = getChar(el.dataset.char);
      const t = c && state.tasks[el.dataset.kind].find(x => x.id === el.dataset.task);
      if (!t) return;
      const p = progOf(c, el.dataset.kind, t);
      c[el.dataset.kind].prog[t.id] = p >= t.count ? 0 : p + 1;
      save();
      rerender(el);
    },
    dec(el) {
      const c = getChar(el.dataset.char);
      const t = c && state.tasks[el.dataset.kind].find(x => x.id === el.dataset.task);
      if (!t) return;
      c[el.dataset.kind].prog[t.id] = Math.max(0, progOf(c, el.dataset.kind, t) - 1);
      save();
      rerender(el);
    },
    inc(el) { setProgress(el, (c, t, p) => p + 1); },
    max(el) { setProgress(el, (c, t) => t.count); },
    'all-or-none'(el) { setProgress(el, (c, t, p) => (p >= t.count ? 0 : t.count)); },
    // Clicking the last filled segment steps back one, so any count (including 0) can be reached.
    'set-prog'(el) { setProgress(el, (c, t, p) => { const v = +el.dataset.value; return p === v ? v - 1 : v; }); },
    info(el) {
      const pop = el.nextElementSibling;
      const open = pop.hidden;
      closeInfoPops();
      pop.hidden = !open;
      el.setAttribute('aria-expanded', String(open));
    },
    'edit-cp'(el) { const c = getChar(el.dataset.char); if (c) openCpModal(c); },
    'cp-mode'(el) {
      const c = getChar(el.dataset.char);
      const mode = el.dataset.value === 'manual' ? 'manual' : 'auto';
      if (!c || c.cpMode === mode) return;
      c.cpMode = mode;
      save();
      rerender(el);
      if (mode === 'manual' && !num(c.gameCp)) openCpModal(c);
      else toast(mode === 'auto' ? 'Combat Power now comes from your Stats and Gear.' : 'Combat Power now uses the number you entered.', { type: 'ok' });
    },
    'heat-range'(el) {
      state.ui.heatMonths = num(el.dataset.value, 1);
      save({ sync: false }); // a per-device view preference
      rerender(el);
    },
    'side-tab'(el) {
      state.ui.sideTab = el.dataset.value;
      save({ sync: false }); // a per-device view preference
      rerender(el);
    },
    'make-main'(el) {
      const c = getChar(el.dataset.char);
      if (!c) return;
      const prev = mainChar();
      for (const x of state.characters) x.role = x === c ? 'main' : 'alt';
      save();
      render();
      toast(`${c.name} is now your main${prev ? `. ${prev.name} is an alt` : ''}.`, { type: 'ok' });
    },
    'check-all'(el) {
      const c = getChar(el.dataset.char);
      if (!c) return;
      for (const t of visibleTasks(c, el.dataset.kind)) c[el.dataset.kind].prog[t.id] = t.count;
      save();
      rerender(el);
    },
    'clear-list'(el) {
      const c = getChar(el.dataset.char), kind = el.dataset.kind;
      if (!c) return;
      const prev = clone(c[kind].prog), id = c.id;
      c[kind].prog = {};
      save();
      rerender(el);
      toast(`${KIND_LABEL[kind]} checklist unchecked.`, {
        timeout: 8000,
        action: { label: 'Undo', fn() { const cc = getChar(id); if (cc) { cc[kind].prog = prev; save(); render(); } } },
      });
    },
    manage(el) {
      const key = el.dataset.char + ':' + el.dataset.kind;
      if (manageMode.has(key)) manageMode.delete(key); else manageMode.add(key);
      rerender(el);
    },
    'hide-task'(el) {
      const c = getChar(el.dataset.char);
      if (!c) return;
      if (c.hidden[el.dataset.task]) delete c.hidden[el.dataset.task]; else c.hidden[el.dataset.task] = true;
      save();
      rerender(el);
    },
    'save-stats'(el) { const c = getChar(el.dataset.char); if (c) saveStats(c); },
    'revert-stats'(el) {
      delete statsDrafts[el.dataset.char];
      renderView();
      toast('Stats reverted to the last saved values.');
    },
    'edit-gear'(el) { const c = getChar(el.dataset.char); if (c) openGearModal(c); },
    'open-settings'() { openSettings(); },
    'open-history'() { openHistory(); },
    'open-news'() { openNewsList(); },
    'open-guide'(el) { openGuide(el.dataset.value); },
    'open-rift'() { openRift(); },
    'lvl-step'(el) {
      const c = getChar(el.dataset.char);
      if (c) setLevel(c, c.level + num(el.dataset.value), el);
    },
    'toggle-theme'() {
      state.settings.theme = state.settings.theme === 'light' ? 'dark' : 'light';
      save();
      applyTheme();
    },
    'rm-toggle'(el) {
      const c = getChar(el.dataset.char);
      if (!c) return;
      const k = el.dataset.task;
      if (c.roadmap.done[k]) delete c.roadmap.done[k]; else c.roadmap.done[k] = true;
      save();
      rerender(el);
    },
    'rm-expand'(el) {
      const c = getChar(el.dataset.char);
      if (!c) return;
      const set = rmOpen.get(c.id) || new Set();
      rmOpen.set(c.id, set.size === ROADMAP.length ? new Set() : new Set(ROADMAP.map(p => p.key)));
      rerender(el);
    },
    'sign-in'() { signIn(); },
    account() { toggleAccountMenu(); },
    'account-backup'() { toggleAccountMenu(false); openSettings('data'); },
    'sign-out'() { signOut(); },
    'open-notes'() {
      openModal({
        title: 'Your notes',
        size: 'wide',
        body: `<div class="notes-ui" data-scope="all" data-filter="all">${notesUIHTML('all', 'all')}</div>`,
        footer: `<span class="fine foot-note">Private to you${cloud.ready && !cloud.disabled ? ' and synced to your account' : ''}.</span>
                 <button class="btn primary" data-m="close">Done</button>`,
      });
    },
    'note-add'(el) {
      const box = el.closest('.notes-ui');
      const input = $('.note-input', box);
      const text = input.value.trim().slice(0, NOTE_LEN);
      if (!text) { input.focus(); return; }
      if (state.notes.length >= NOTES_MAX) {
        toast(`You have ${NOTES_MAX} notes, the most that can be kept. Delete some to add more.`, { type: 'bad', timeout: 6000 });
        return;
      }
      const pick = $('.note-for', box);
      const charId = box.dataset.scope === 'all' ? (pick ? pick.value : '') : box.dataset.scope;
      state.notes.unshift(normNote({ text, charId, created: Date.now() }));
      noteDraft[box.dataset.scope] = '';
      save();
      refreshNotes();
      const again = $(`.notes-ui[data-scope="${box.dataset.scope}"] .note-input`);
      if (again) again.focus();
    },
    'note-pin'(el) {
      const n = state.notes.find(x => x.id === el.dataset.note);
      if (!n) return;
      n.pinned = !n.pinned;
      save();
      refreshNotes();
    },
    'note-edit'(el) { editingNote = el.dataset.note; refreshNotes(); },
    'note-cancel'() { editingNote = null; refreshNotes(); },
    'note-save'(el) {
      const n = state.notes.find(x => x.id === el.dataset.note);
      const ta = el.closest('.note').querySelector('.note-edit-input');
      if (!n || !ta) return;
      const text = ta.value.trim().slice(0, NOTE_LEN);
      if (!text) { ta.focus(); return; }
      n.text = text;
      n.updated = Date.now();
      editingNote = null;
      save();
      refreshNotes();
    },
    'note-del'(el) {
      const i = state.notes.findIndex(x => x.id === el.dataset.note);
      if (i < 0) return;
      const [removed] = state.notes.splice(i, 1);
      save();
      refreshNotes();
      toast('Note deleted.', {
        timeout: 8000,
        action: { label: 'Undo', fn() { state.notes.splice(Math.min(i, state.notes.length), 0, removed); save(); refreshNotes(); } },
      });
    },
    'note-filter'(el) {
      const box = el.closest('.notes-ui');
      box.dataset.filter = el.dataset.value;
      box.innerHTML = notesUIHTML('all', box.dataset.filter);
    },
    'reload-now'() { reloadNow(); },
  };

  document.addEventListener('click', e => {
    if (!e.target.closest('.info-wrap')) closeInfoPops();
    if (!e.target.closest('.account-slot')) { const am = $('#account-menu'); if (am && !am.hidden) toggleAccountMenu(false); }
    const el = e.target.closest('[data-action]');
    // Page controls live in #app; the notes panel also works inside its dialog.
    if (!el || (!$('#app').contains(el) && !el.closest('.notes-ui')) || el.disabled) return;
    const fn = actions[el.dataset.action];
    if (fn) fn(el, e);
  });

  // Notes: remember the composer's text; Ctrl/Cmd+Enter adds (or saves while editing).
  document.addEventListener('input', e => {
    if (!e.target.matches('.note-input')) return;
    noteDraft[e.target.closest('.notes-ui').dataset.scope] = e.target.value;
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
    const box = e.target.closest && e.target.closest('.notes-ui');
    if (!box) return;
    e.preventDefault();
    const btn = e.target.matches('.note-edit-input')
      ? e.target.closest('.note').querySelector('[data-action="note-save"]')
      : $('[data-action="note-add"]', box);
    if (btn) btn.click();
  });

  document.addEventListener('input', e => {
    const inp = e.target.closest('[data-stat]');
    if (!inp) return;
    const c = getChar(inp.dataset.char);
    if (!c) return;
    const d = statsDrafts[c.id] || (statsDrafts[c.id] = { ...c.stats });
    d[inp.dataset.stat] = inp.value;
    if (statsEqual(d, c.stats)) delete statsDrafts[c.id];
    const panel = $('#calc-panel');
    if (panel) panel.innerHTML = calcHTML(c);
    const strip = $('#cp-strip');
    if (strip) { strip.innerHTML = cpStripHTML(c); animateCp(); }
    const badge = $('#stats-dirty');
    if (badge) badge.hidden = !statsDrafts[c.id];
  });

  document.addEventListener('submit', e => {
    if (e.target.id !== 'stats-form') return;
    e.preventDefault();
    const c = getChar(e.target.dataset.char);
    if (c) saveStats(c);
  });

  // Level typed into the character header: saved when the field is left or Enter is pressed.
  document.addEventListener('change', e => {
    const inp = e.target.closest && e.target.closest('[data-level]');
    if (!inp) return;
    const c = getChar(inp.dataset.level);
    if (c) setLevel(c, inp.value);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-level]')) e.target.blur();
  });

  // Progress sliders (used for activities with more than 20 runs).
  document.addEventListener('change', e => {
    const r = e.target.closest('[data-range]');
    if (r) setProgress(r, () => num(r.value));
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ($$('.info-pop').some(p => !p.hidden)) { closeInfoPops(); return; }
    const am = $('#account-menu');
    if (am && !am.hidden) { toggleAccountMenu(false); $('#account-btn').focus(); return; }
    const top = $('#modal-root').lastElementChild;
    if (top) closeModal(top);
  });

  // Keep several open tabs of the tracker in sync.
  window.addEventListener('storage', e => {
    if (e.key !== STORE_KEY) return;
    state = load();
    render();
  });

  window.addEventListener('beforeunload', e => {
    if (Object.keys(statsDrafts).length && !reloading) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /* ---------- 10. Live updates ---------- */

  // When served by server/server.py or server/serve.ps1, the page checks /__version.
  // Stylesheet changes are swapped in place; other changes reload the page
  // (or show a banner if you're in the middle of editing something).
  let reloading = false;
  const live = { files: null, build: null, mode: null, pending: false };
  const isBusy = () => $('#modal-root').children.length > 0 || Object.keys(statsDrafts).length > 0;

  function reloadNow() {
    save({ sync: false });
    reloading = true;
    try { sessionStorage.setItem('aion2-updated', '1'); } catch (e) { /* ignore */ }
    location.reload();
  }

  async function fetchJson(url) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      return r.ok ? await r.json() : null;
    } catch (e) {
      return null;
    }
  }

  function applyUpdate() {
    if (isBusy()) {
      live.pending = true;
      $('#update-banner').hidden = false;
    } else {
      reloadNow();
    }
  }

  // Returns false when this host offers no way to detect new versions.
  // Local server: /__version lists every file's hash (CSS swaps in without a reload).
  // Static hosting (GitHub Pages): version.json holds the build id written at each deploy.
  async function checkForUpdate() {
    if (location.protocol === 'file:' || reloading) return false;
    if (live.mode !== 'static') {
      const data = await fetchJson('/__version');
      if (isObj(data) && isObj(data.files)) {
        live.mode = 'server';
        onServerVersion(data);
        return true;
      }
      if (live.mode === 'server') return true; // server briefly unreachable
    }
    const v = await fetchJson(`version.json?t=${Date.now()}`); // query string skips the CDN's cache
    if (!isObj(v) || typeof v.build !== 'string') return live.mode === 'static';
    live.mode = 'static';
    if (!live.build) live.build = v.build;
    else if (v.build !== live.build) { live.build = v.build; applyUpdate(); }
    else if (live.pending && !isBusy()) reloadNow();
    return true;
  }

  function onServerVersion(data) {
    if (!live.files) { live.files = data.files; return; }
    const changed = Object.keys({ ...live.files, ...data.files }).filter(f => live.files[f] !== data.files[f]);
    if (!changed.length) {
      if (live.pending && !isBusy()) reloadNow();
      return;
    }
    live.files = data.files;
    if (changed.every(f => f.endsWith('.css'))) {
      for (const link of $$('link[rel="stylesheet"]')) {
        const url = new URL(link.href, location.href);
        const f = changed.find(x => url.pathname.endsWith('/' + x));
        if (f && url.origin === location.origin) link.href = `${url.pathname}?v=${data.files[f] || Date.now()}`;
      }
      return;
    }
    applyUpdate();
  }

  async function startLiveUpdates() {
    if (location.protocol === 'file:' || !SERVED_BY_APP_SERVER) return;
    if (!(await checkForUpdate())) return; // nothing to watch on this host
    setInterval(() => { if (!document.hidden) checkForUpdate(); }, live.mode === 'static' ? 60000 : 2000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
  }

  /* ---------- 10b. Cloud sync (hosted claude.ai page only) ----------
     Each signed-in person's data is kept in their own private folder of the page's database:
       data/users/<their id>/tracker         characters, tasks, settings (everything except history)
       data/users/<their id>/week-<start>    one document per archived week
     Nobody else can read it, the page owner included. This browser keeps a copy as well,
     so the page opens instantly and still works offline. Newest change wins. */

  const LINK_KEY = 'aion2-sync-linked'; // which account this browser's copy was last synced with
  // "Clear all data" is only offered to the owner: always on the local app (the owner's own PC),
  // on claude.ai to the page's owner, and on the public site to the admin account in firebase-config.js.
  const IS_LOCAL = location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  let canClearAll = IS_LOCAL;
  const cloud = {
    col: null,            // CollectionReference for data/users/<id>
    uid: null,
    ready: false,         // first server answer handled
    disabled: false,      // no permission, or the person chose to keep this device separate
    remoteWeeks: new Map(), // week doc id -> stable JSON of what the server holds
    timer: 0,
    pushing: false,
    again: false,
    retried: false,
    pending: null,        // remote change waiting for dialogs to close
  };

  const SYNC_TEXT = {
    connecting: 'Connecting to your cloud save…',
    saving: 'Saving to your account…',
    synced: 'Synced to your account',
    local: 'Saved on this device only',
    readonly: 'Saved on this device only (no permission to sync)',
    error: 'Cloud save failed. Changes are kept on this device.',
  };

  function storageSummary() {
    if (cloud.ready && !cloud.disabled) {
      return `Your data is saved to your ${cloud.provider === 'google' ? 'Google' : 'Claude'} account and syncs across your devices.`;
    }
    return 'Data is stored only in this browser.';
  }

  function setSyncStatus(kind, text) {
    const el = $('#sync-status');
    if (el) {
      el.hidden = false;
      el.dataset.state = kind;
      el.textContent = text || SYNC_TEXT[kind] || '';
    }
    const avatarBtn = $('#account-btn');
    if (avatarBtn) avatarBtn.dataset.sync = kind; // colours the small dot on the avatar
    const foot = $('#app-foot');
    if (foot) foot.innerHTML = `${storageSummary()} Back it up from Settings &rarr; Data.`;
  }

  // JSON with sorted keys, so the same week always compares equal however the server orders fields.
  function stableJson(v) {
    if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
    if (isObj(v)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
    return JSON.stringify(v);
  }

  const modalOpen = () => $('#modal-root').children.length > 0;
  const hasData = s => s.characters.length > 0 || s.history.length > 0;

  function scheduleSync() {
    if (!cloud.ready || cloud.disabled) return;
    clearTimeout(cloud.timer);
    setSyncStatus('saving');
    cloud.timer = setTimeout(pushNow, 800); // one upload per pause in clicking
  }

  async function pushNow() {
    clearTimeout(cloud.timer);
    cloud.timer = 0;
    if (!cloud.ready || cloud.disabled) return;
    if (cloud.pushing) { cloud.again = true; return; }
    cloud.pushing = true;
    try {
      do {
        cloud.again = false;
        const { history, ui, ...rest } = state;
        await cloud.col.doc('tracker').set({ v: 1, updatedAt: state.updatedAt, state: clone(rest) });
        const want = new Map(history.map(h => ['week-' + h.start, h]));
        for (const [id, week] of want) {
          const json = stableJson(week);
          if (cloud.remoteWeeks.get(id) === json) continue;
          await cloud.col.doc(id).set({ week: clone(week) });
          cloud.remoteWeeks.set(id, json);
        }
        for (const id of Array.from(cloud.remoteWeeks.keys())) {
          if (want.has(id)) continue;
          await cloud.col.doc(id).delete();
          cloud.remoteWeeks.delete(id);
        }
      } while (cloud.again);
      cloud.retried = false;
      setSyncStatus('synced');
    } catch (e) {
      // Error codes: claude.ai page storage uses snake_case, Firestore uses kebab-case.
      const code = e && e.code;
      if (code === 'invalid_argument' || code === 'not_granted' || code === 'revoked' ||
          code === 'capability_disabled' || code === 'capability_removed' ||
          code === 'permission-denied' || code === 'unauthenticated') {
        cloud.disabled = true;
        setSyncStatus('readonly');
      } else if (code === 'quota_exceeded' || code === 'resource-exhausted') {
        setSyncStatus('error', 'Cloud storage is full. Delete old weeks in History to free space.');
      } else if (code === 'invalid-argument') {
        setSyncStatus('error', 'Your data is too large to sync. Delete old weeks in History or some notes.');
      } else if (!cloud.retried) {
        cloud.retried = true;
        setSyncStatus('error');
        setTimeout(scheduleSync, 2000 + Math.random() * 2000);
      } else {
        setSyncStatus('error');
      }
    } finally {
      cloud.pushing = false;
    }
  }

  function adoptRemote(tracker, weeks) {
    const ui = state.ui;
    state = normalize({ ...clone(tracker.state), history: clone(weeks), updatedAt: num(tracker.updatedAt) });
    state.ui = ui;
    processResets();
    save({ sync: false });
    render();
    announceCatalog();
  }

  function applyPendingRemote() {
    if (!cloud.pending || modalOpen()) return;
    const { tracker, weeks } = cloud.pending;
    cloud.pending = null;
    if (num(tracker.updatedAt) > num(state.updatedAt)) {
      adoptRemote(tracker, weeks);
      toast('Updated with changes from your other device.', { type: 'ok' });
    }
  }

  function linkDevice() {
    try { localStorage.setItem(LINK_KEY, cloud.uid); } catch (e) { /* ignore */ }
  }

  // First server answer on this visit: decide whether the cloud copy or this browser's copy wins.
  function firstContact(tracker, weeks) {
    let linked = false;
    try { linked = localStorage.getItem(LINK_KEY) === cloud.uid; } catch (e) { /* ignore */ }

    const cloudEmpty = !tracker || (!hasData(normalize(clone(tracker.state))) && weeks.length === 0);
    if (cloudEmpty && hasData(state)) tracker = null;
    if (!tracker) {                    // nothing in the cloud yet: upload this device's data
      linkDevice();
      setSyncStatus('saving');
      pushNow();
      return;
    }
    const cloudState = normalize({ ...clone(tracker.state), history: clone(weeks) });
    if (!hasData(state) || (linked && num(tracker.updatedAt) >= num(state.updatedAt))) {
      linkDevice();
      adoptRemote(tracker, weeks);
      setSyncStatus('synced');
      return;
    }
    if (linked) {                      // this device changed things while offline: upload them
      setSyncStatus('saving');
      pushNow();
      return;
    }
    // First sync on a device that already has its own data: let the person choose.
    const fmt = t => (num(t) ? fmtWhen.format(num(t)) : 'unknown');
    const m = openModal({
      title: 'Choose which data to keep',
      size: 'sm',
      body: `<p>Your account already has a cloud save, and this browser has its own data. Syncing needs one of them.</p>
        <dl class="kv choice-kv">
          <div><dt>Cloud save</dt><dd>${cloudState.characters.length} character(s), ${cloudState.history.length} week(s)<br><span class="fine">Last changed ${esc(fmt(tracker.updatedAt))}</span></dd></div>
          <div><dt>This browser</dt><dd>${state.characters.length} character(s), ${state.history.length} week(s)<br><span class="fine">Last changed ${esc(fmt(state.updatedAt))}</span></dd></div>
        </dl>
        <p class="fine">Tip: export this browser's data first (Settings &rarr; Data) if you might want it later.</p>`,
      footer: `<button class="btn ghost" data-m="upload">Replace cloud with this browser</button>
               <button class="btn primary" data-m="cloud" autofocus>Use cloud save</button>`,
      onClose() {
        if (cloud.ready && !cloud.disabled && !m._chosen) {
          cloud.disabled = true;
          setSyncStatus('local', 'Not syncing on this visit. Reload the page to choose again.');
        }
      },
      actions: {
        cloud() {
          m._chosen = true;
          linkDevice();
          closeModal(m);
          adoptRemote(tracker, weeks);
          setSyncStatus('synced');
          toast('Loaded your cloud save.', { type: 'ok' });
        },
        upload() {
          m._chosen = true;
          linkDevice();
          closeModal(m);
          state.updatedAt = Date.now();
          save({ sync: false });
          setSyncStatus('saving');
          pushNow();
          toast('This browser\'s data is now your cloud save.', { type: 'ok' });
        },
      },
    });
  }

  function onRemoteSnapshot(snap) {
    if (!cloud.ready && snap.metadata.fromCache) return; // wait for the server's definitive answer
    let tracker = null;
    const weeks = [];
    const seen = new Map();
    for (const d of snap.docs) {
      const body = d.data();
      if (!body) continue;
      if (d.id === 'tracker' && isObj(body.state)) tracker = body;
      else if (d.id.startsWith('week-') && isObj(body.week)) {
        weeks.push(body.week);
        seen.set(d.id, stableJson(body.week));
      }
    }
    cloud.remoteWeeks = seen;
    if (!cloud.ready) {
      cloud.ready = true;
      firstContact(tracker, weeks);
      return;
    }
    if (cloud.disabled || snap.metadata.hasPendingWrites || !tracker) return;
    if (num(tracker.updatedAt) <= num(state.updatedAt)) return; // our own write, or older
    if (modalOpen() || cloud.pushing || cloud.timer) {
      cloud.pending = { tracker, weeks }; // don't pull the rug out from under an open dialog
      if (!modalOpen()) setTimeout(applyPendingRemote, 1500);
      return;
    }
    adoptRemote(tracker, weeks);
    setSyncStatus('synced');
  }

  async function startCloudSync() {
    if (!window.claude || typeof window.claude.use !== 'function') return; // local copy of the app
    setSyncStatus('connecting');
    let db = null, user = null;
    try {
      [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
    } catch (e) { /* treated as unavailable */ }
    canClearAll = !!(user && await user.isOwner());
    const uid = db && user ? await user.id() : null;
    if (!uid) { setSyncStatus('local'); return; }
    let col;
    try {
      col = db.collection('data/users/' + uid);
    } catch (e) {
      setSyncStatus('local');
      return;
    }
    connectCloud(col, uid, 'claude');
  }

  // Starts syncing with one person's private collection. Works with the claude.ai page storage and
  // with Firestore alike: both hold a "tracker" document plus one "week-<start>" document per week.
  function connectCloud(col, uid, provider) {
    disconnectCloud();
    Object.assign(cloud, { col, uid, provider, ready: false, disabled: false, remoteWeeks: new Map(), pending: null, retried: false });
    setSyncStatus('connecting');
    cloud.unsub = col.onSnapshot(onRemoteSnapshot, e => {
      const code = e && e.code;
      cloud.disabled = true;
      if (code === 'permission-denied' || code === 'invalid_argument') {
        setSyncStatus('error', 'Cloud save refused access. Saved on this device only for now.');
        console.warn('[sync] read refused:', e);
      } else {
        setSyncStatus('error', 'Lost connection to your cloud save. Reload the page to reconnect.');
        console.warn('[sync] listener stopped:', e);
      }
    });
  }

  // Stops syncing (e.g. after signing out). This browser keeps its copy of the data.
  function disconnectCloud() {
    if (cloud.unsub) { try { cloud.unsub(); } catch (e) { /* already closed */ } }
    clearTimeout(cloud.timer);
    Object.assign(cloud, { col: null, uid: null, ready: false, disabled: false, timer: 0, unsub: null, pending: null });
  }

  // Upload a pending change straight away when the page is hidden or closed.
  document.addEventListener('visibilitychange', () => { if (document.hidden && cloud.timer) pushNow(); });

  /* ---------- 10d. Google sign-in with Firebase (public website) ----------
     When js/firebase-config.js has an apiKey, people can sign in with Google and their data syncs
     through Firestore at users/<uid>/docs/{tracker, week-<start>}, the same layout the sync engine
     above uses on claude.ai. Security rules in Firestore only let each person read and write their own. */

  // Served from this site rather than Google's CDN: Edge's tracking prevention blocks storage for
  // scripts from other sites, which stops Firebase sign-in from starting.
  const FIREBASE_SDK = 'vendor/firebase-10.12.2/';
  const fb = { auth: null, db: null, user: null, ready: false };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  async function sha256Hex(text) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  }

  function renderAccount() {
    const slot = $('#account-slot');
    if (!slot) return;
    if (!fb.ready) { slot.innerHTML = ''; return; }
    const u = fb.user;
    if (!u) {
      slot.innerHTML = `<button class="signin-btn" data-action="sign-in" title="Sign in with Google to sync your tracker across browsers and devices">
          <span class="g-chip">${GOOGLE_G}</span><span class="signin-text">Sign in to sync</span></button>`;
      return;
    }
    const pic = size => (u.photoURL
      ? `<img class="account-pic ${size}" src="${esc(u.photoURL)}" alt="" referrerpolicy="no-referrer">`
      : `<span class="account-pic ${size}">${esc(initials(u.displayName || u.email || '?'))}</span>`);
    slot.innerHTML = `
      <button class="account-btn" id="account-btn" data-action="account" aria-haspopup="menu" aria-expanded="false"
        aria-controls="account-menu" data-sync="${esc(($('#sync-status') || {}).dataset ? $('#sync-status').dataset.state : 'off')}"
        title="${esc(u.displayName || u.email || 'Account')}" aria-label="Account: ${esc(u.displayName || u.email || '')}">
        ${pic('')}<i class="account-dot" aria-hidden="true"></i>
      </button>
      <div class="account-menu" id="account-menu" role="menu" aria-label="Account" hidden>
        <div class="am-head">
          ${pic('lg')}
          <div class="am-id"><b>${esc(u.displayName || 'Signed in')}</b><small>${esc(u.email || '')}</small></div>
        </div>
        <p class="am-sync"><i></i><span></span></p>
        <div class="am-items">
          <button role="menuitem" class="am-item" data-action="account-backup">${icon('download')}<span>Backup &amp; data</span></button>
          <button role="menuitem" class="am-item danger" data-action="sign-out">${icon('arrow')}<span>Sign out</span></button>
        </div>
      </div>`;
  }

  const GOOGLE_G = `<svg class="ico" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

  async function signIn() {
    if (!fb.auth) return;
    const provider = new window.firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await fb.auth.signInWithPopup(provider);
    } catch (e) {
      const code = e && e.code;
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        await fb.auth.signInWithRedirect(provider); // phones and strict pop-up blockers
      } else if (code === 'auth/unauthorized-domain') {
        toast('Sign-in isn\'t enabled for this web address yet. Add it under Authentication → Settings → Authorized domains in Firebase.', { type: 'bad', timeout: 10000 });
      } else if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        toast('Sign-in didn\'t work. Please try again.', { type: 'bad' });
      }
    }
  }

  // The account dropdown under the avatar pill.
  function toggleAccountMenu(force) {
    const menu = $('#account-menu'), btn = $('#account-btn');
    if (!menu || !btn) return;
    const open = force != null ? force : menu.hidden;
    if (open) {
      const status = $('#sync-status');
      const line = $('.am-sync', menu);
      line.dataset.state = status ? status.dataset.state : 'off';
      $('span', line).textContent = status && status.textContent ? status.textContent : 'Signed in';
    }
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) { const first = $('[role="menuitem"]', menu); if (first) first.focus(); }
  }

  async function signOut() {
    toggleAccountMenu(false);
    await fb.auth.signOut();
    toast('Signed out. This browser keeps its copy; sign in again to sync.');
  }

  async function startFirebase() {
    const cfg = window.AION2_FIREBASE;
    if (!cfg || !cfg.apiKey || !cfg.projectId) return; // sign-in not set up on this copy
    if (window.claude && typeof window.claude.use === 'function') return; // claude.ai has its own sync
    try {
      await loadScript(FIREBASE_SDK + 'firebase-app-compat.js');
      await loadScript(FIREBASE_SDK + 'firebase-auth-compat.js');
      await loadScript(FIREBASE_SDK + 'firebase-firestore-compat.js');
    } catch (e) {
      setSyncStatus('local', 'Saved on this device only (sign-in couldn\'t load)');
      return;
    }
    const app = window.firebase.initializeApp({ apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId, appId: cfg.appId });
    fb.auth = app.auth();
    fb.db = app.firestore();
    fb.ready = true;
    const admins = Array.isArray(cfg.adminEmailHashes) ? cfg.adminEmailHashes : [];
    fb.auth.getRedirectResult().catch(() => { /* handled by onAuthStateChanged */ });
    fb.auth.onAuthStateChanged(async user => {
      fb.user = user;
      renderAccount();
      if (user) {
        canClearAll = IS_LOCAL || (!!user.email && admins.includes(await sha256Hex(user.email.trim().toLowerCase())));
        connectCloud(fb.db.collection('users').doc(user.uid).collection('docs'), user.uid, 'google');
      } else {
        canClearAll = IS_LOCAL;
        disconnectCloud();
        setSyncStatus('local', 'Saved on this device only · sign in to sync');
      }
    });
  }

  /* ---------- 10c. Official AION 2 news ----------
     Local app: the server relays the official announcements live (/api/news).
     Shared claude.ai page: it can't reach other websites, so it reads a copy kept in the page's
     shared storage (news/feed, plus news/feed/articles/<id> for full articles). */

  const NEWS_PAGE = 'https://aion2.plaync.com/en-us/board/notice/list';
  const news = { items: [], updatedAt: 0, source: null, db: null, popShownFor: null };
  const fmtAgoUnits = [[864e5 * 365, 'year'], [864e5 * 30, 'month'], [864e5, 'day'], [36e5, 'hour'], [6e4, 'minute']];
  const rtf = typeof Intl.RelativeTimeFormat === 'function' ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null;

  function fmtAgo(t) {
    const diff = t - Date.now();
    for (const [ms, unit] of fmtAgoUnits) {
      if (Math.abs(diff) >= ms || unit === 'minute') {
        const v = Math.round(diff / ms);
        return rtf ? rtf.format(v, unit) : fmtDay.format(t);
      }
    }
    return '';
  }

  // Plain text from the site's summary HTML (entities like &nbsp; decoded).
  function textOf(html) {
    return (new DOMParser().parseFromString(String(html || ''), 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // The article body is someone else's HTML: keep only harmless formatting, links and (when the page
  // is allowed to load them) images; drop scripts, styles, event handlers and everything else.
  const SAFE_TAGS = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5',
    'A', 'IMG', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'BLOCKQUOTE', 'HR', 'DIV', 'SPAN', 'SUB', 'SUP', 'CODE', 'PRE']);
  const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA',
    'SVG', 'MATH', 'TEMPLATE', 'LINK', 'META', 'NOSCRIPT', 'VIDEO', 'AUDIO', 'SOURCE', 'CANVAS']);

  function sanitizeHtml(html, allowImages) {
    const doc = new DOMParser().parseFromString(`<div>${String(html || '')}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    const walk = node => {
      for (const el of Array.from(node.children)) {
        const tag = el.tagName;
        if (DROP_TAGS.has(tag) || (tag === 'IMG' && !allowImages)) { el.remove(); continue; }
        if (!SAFE_TAGS.has(tag)) { walk(el); el.replaceWith(...el.childNodes); continue; }
        for (const attr of Array.from(el.attributes)) {
          const n = attr.name.toLowerCase();
          const keep = (tag === 'A' && n === 'href') || (tag === 'IMG' && (n === 'src' || n === 'alt')) ||
            ((tag === 'TD' || tag === 'TH') && (n === 'colspan' || n === 'rowspan'));
          if (!keep) el.removeAttribute(attr.name);
        }
        if (tag === 'A') {
          if (/^https?:\/\//i.test(el.getAttribute('href') || '')) {
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer');
          } else el.removeAttribute('href');
        }
        if (tag === 'IMG') {
          if (!/^https:\/\//i.test(el.getAttribute('src') || '')) { el.remove(); continue; }
          el.setAttribute('loading', 'lazy');
        }
        walk(el);
      }
    };
    walk(root);
    // Collapse the editor's runs of empty lines.
    return root.innerHTML.replace(/(<div><br><\/div>\s*){2,}/g, '<div><br></div>');
  }

  const lastSeenNews = () => num(state.ui.newsSeenAt);
  function unreadNews() {
    // First visit on a device: only the last week counts as new, not the whole backlog.
    const seen = lastSeenNews() || Date.now() - 7 * 864e5;
    return news.items.filter(n => num(n.postedAt) > seen);
  }

  function markNewsSeen() {
    const newest = Math.max(0, ...news.items.map(n => num(n.postedAt)));
    if (newest > lastSeenNews()) {
      state.ui.newsSeenAt = newest;
      save({ sync: false }); // remembered per device
    }
    renderNewsButton();
    hideNewsPop();
  }

  function renderNewsButton() {
    const btn = $('#news-btn'), badge = $('#news-badge');
    if (!btn) return;
    btn.hidden = news.items.length === 0;
    const n = unreadNews().length;
    badge.hidden = n === 0;
    badge.textContent = n > 9 ? '9+' : String(n);
    btn.setAttribute('aria-label', n ? `News, ${n} new` : 'News');
  }

  function hideNewsPop() {
    const pop = $('#news-pop');
    if (pop) pop.remove();
  }

  // A small card in the corner for the newest unread announcement (once per announcement per visit).
  function showNewsPop() {
    const latest = unreadNews().sort((a, b) => b.postedAt - a.postedAt)[0];
    if (!latest || news.popShownFor === latest.id || modalOpen()) return;
    news.popShownFor = latest.id;
    hideNewsPop();
    const more = unreadNews().length - 1;
    const summary = textOf(latest.summary);
    const pop = document.createElement('aside');
    pop.id = 'news-pop';
    pop.className = `news-pop ${more > 0 ? 'has-more' : ''}`;
    pop.setAttribute('role', 'status');
    pop.setAttribute('aria-label', 'New AION 2 announcement');
    pop.innerHTML = `
      <span class="np-medal" aria-hidden="true">${icon('news')}<i class="np-dot"></i></span>
      <div class="np-body">
        <div class="np-top">
          <span class="np-kicker">New announcement</span>
          <time class="np-time">${esc(fmtAgo(latest.postedAt))}</time>
          <button class="np-x" data-np="close" aria-label="Dismiss" title="Dismiss">${icon('x')}</button>
        </div>
        <b class="np-title"></b>
        ${summary ? '<p class="np-summary"></p>' : ''}
        <div class="np-actions">
          <button class="np-read" data-np="read">Read now ${icon('arrow')}</button>
          <button class="np-all" data-np="all">${more > 0 ? `See all <span class="np-count">${more + 1}</span>` : 'All news'}</button>
        </div>
      </div>`;
    $('.np-title', pop).textContent = latest.title;
    if (summary) $('.np-summary', pop).textContent = summary;
    pop.addEventListener('click', e => {
      const b = e.target.closest('[data-np]');
      if (!b) return;
      if (b.dataset.np === 'read') { markNewsSeen(); openArticle(latest); }
      else if (b.dataset.np === 'all') { openNewsList(); }
      else markNewsSeen();
    });
    document.body.appendChild(pop);
  }

  function onNewsLoaded() {
    renderNewsButton();
    showNewsPop();
  }

  function openNewsList() {
    const unreadIds = new Set(unreadNews().map(n => n.id));
    const images = news.source !== 'cloud';
    const items = news.items.slice().sort((a, b) => b.postedAt - a.postedAt);
    const m = openModal({
      title: 'AION 2 news',
      size: 'wide',
      body: `<ul class="news-list">
          ${items.map(n => `<li>
            <button type="button" class="news-item" data-m="open" data-id="${esc(n.id)}">
              <span class="news-thumb">${images && n.thumb ? `<img src="${esc(n.thumb)}" alt="" loading="lazy">` : icon('news')}</span>
              <span class="news-body">
                <span class="news-meta">${unreadIds.has(n.id) ? '<span class="pill new">New</span>' : ''}<time>${esc(fmtDay.format(n.postedAt))}</time> · ${esc(fmtAgo(n.postedAt))}</span>
                <b class="news-title">${esc(n.title)}</b>
                <span class="news-summary">${esc(textOf(n.summary))}</span>
              </span>
            </button>
          </li>`).join('')}
        </ul>`,
      footer: `<span class="fine foot-note">Official announcements from aion2.plaync.com${news.updatedAt ? ` · updated ${esc(fmtAgo(news.updatedAt))}` : ''}</span>
               <a class="btn ghost" href="${NEWS_PAGE}" target="_blank" rel="noopener noreferrer">${icon('external')}Official site</a>
               <button class="btn primary" data-m="close">Done</button>`,
      actions: {
        open(b) {
          const item = news.items.find(n => n.id === b.dataset.id);
          if (item) openArticle(item);
        },
      },
    });
    markNewsSeen();
    return m;
  }

  async function loadArticle(item) {
    if (news.source === 'server' || news.source === 'static') {
      const url = news.source === 'server'
        ? `/api/news/${encodeURIComponent(item.id)}`
        : `news/${encodeURIComponent(item.id)}.json?t=${num(news.updatedAt)}`;
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('unavailable');
      return r.json();
    }
    if (news.db) {
      const snap = await news.db.doc(`news/feed/articles/${item.id}`).get();
      if (snap.exists) return snap.data();
    }
    return null;
  }

  function openArticle(item) {
    const images = news.source !== 'cloud'; // claude.ai pages can't load pictures from other sites
    const m = openModal({
      title: item.title,
      size: 'wide',
      body: `<p class="article-meta">${icon('clock')}<time>${esc(fmtWhen.format(item.postedAt))}</time> · ${esc(fmtAgo(item.postedAt))}</p>
        <div class="article-body" aria-busy="true"><p class="fine">Loading…</p></div>`,
      footer: `<a class="btn ghost" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${icon('external')}Read on the official site</a>
               <button class="btn primary" data-m="close">Close</button>`,
    });
    const body = $('.article-body', m);
    loadArticle(item).then(full => {
      if (!body.isConnected) return;
      body.removeAttribute('aria-busy');
      if (full && full.html) {
        body.innerHTML = sanitizeHtml(full.html, images) +
          (images ? '' : '<p class="fine article-note">Pictures from this announcement are on the official site.</p>');
      } else {
        body.innerHTML = `<p>${esc(textOf(item.summary))}</p><p class="fine">The full article is on the official site.</p>`;
      }
    }).catch(() => {
      if (!body.isConnected) return;
      body.innerHTML = `<p>${esc(textOf(item.summary))}</p><p class="fine">Couldn't load the full article right now. Open it on the official site.</p>`;
    });
  }

  // Local server: live relay at /api/news. GitHub Pages: news/feed.json, saved hourly by the deploy
  // workflow (tools/fetch_news.py). Returns false when this host has neither, so polling can stop.
  async function loadHostedNews() {
    const url = news.source === 'server' ? '/api/news' : `news/feed.json?t=${Date.now()}`;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.status === 404) return false;
      if (!r.ok) return true;
      const d = await r.json();
      if (!Array.isArray(d.items)) return true;
      news.items = d.items;
      news.updatedAt = num(d.updatedAt, Date.now());
      onNewsLoaded();
    } catch (e) { /* offline or the site is down: keep what we have */ }
    return true;
  }

  async function startNews() {
    if (SERVED_BY_APP_SERVER) {
      news.source = 'server';
      if (!(await loadHostedNews())) {
        news.source = 'static';
        if (!(await loadHostedNews())) { news.source = null; return; }
      }
      setInterval(() => { if (!document.hidden) loadHostedNews(); }, 15 * 60e3);
      return;
    }
    if (!window.claude || typeof window.claude.use !== 'function') return;
    let db = null;
    try { db = await window.claude.use('db'); } catch (e) { /* unavailable */ }
    if (!db) return;
    news.db = db;
    news.source = 'cloud';
    db.doc('news/feed').onSnapshot(snap => {
      const d = snap.exists ? snap.data() : null;
      if (!d || !Array.isArray(d.items)) return;
      news.items = clone(d.items);
      news.updatedAt = num(d.updatedAt);
      onNewsLoaded();
    }, () => { /* news is optional */ });
  }

  /* ---------- 11. Start-up ---------- */

  applyTheme(); // before the first paint, so light-mode users don't see a dark flash
  renderShell();
  const first = processResets();
  save({ sync: false }); // persists any upgrade from an older version (and the generated task ids) straight away
  render();
  if (first.weekly && state.history.length) toast('New week started — last week was archived to History.', { type: 'ok', timeout: 6000 });
  else if (first.daily) toast('Daily reset — checklists are fresh.', { type: 'ok' });
  announceCatalog();
  try {
    if (sessionStorage.getItem('aion2-updated')) {
      sessionStorage.removeItem('aion2-updated');
      toast('Updated to the latest version.', { type: 'ok' });
    }
  } catch (e) { /* ignore */ }

  setInterval(() => {
    const r = processResets();
    if (r.weekly) {
      render();
      toast('Weekly reset — last week was archived to History.', { type: 'ok', timeout: 6000 });
    } else if (r.daily) {
      render();
      toast('Daily reset — checklists are fresh.', { type: 'ok' });
    } else {
      updateClocks();
    }
  }, 1000);

  startLiveUpdates();
  startCloudSync();
  startFirebase();
  startNews();
})();
