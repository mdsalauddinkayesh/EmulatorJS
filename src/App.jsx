import { useCallback, useEffect, useRef, useState } from 'react';
import * as fflate from 'fflate';
import Player from './Player.jsx';
import { initDB, saveGame, loadGames, getRomBlob, deleteGame, clearAllGames } from './db.js';
import {
  CORE_EXTENSIONS, ROM_PRIORITY, SYSTEM_LABELS, LARGE_FILE_THRESHOLD,
  formatBytes, generateMinimalNesRom,
} from './utils.js';

// ---------- Static data (things that never change) ----------
const SYSTEM_OPTIONS = [
  ['nes', 'Nintendo NES (.nes)'], ['snes', 'Super Nintendo (.snes, .smc)'],
  ['gba', 'Game Boy Advance (.gba)'], ['gb', 'Game Boy (.gb)'], ['gbc', 'Game Boy Color (.gbc)'],
  ['segaMD', 'Sega Genesis / Mega Drive (.gen, .md)'], ['gamegear', 'Sega Game Gear (.gg)'],
  ['segaMS', 'Sega Master System (.sms)'], ['beetle_vb', 'Virtual Boy (.vb)'],
  ['n64', 'Nintendo 64 (.n64, .z64)'], ['nds', 'Nintendo DS (.nds)'],
  ['a2600', 'Atari 2600 (.a26)'], ['a7800', 'Atari 7800 (.a78)'], ['lynx', 'Atari Lynx (.lnx)'],
  ['pce', 'PC Engine / TG16 (.pce)'], ['ws', 'WonderSwan (.ws, .wsc)'], ['ngp', 'Neo Geo Pocket (.ngp)'],
];

const SYSTEM_TAGS = ['NES', 'SNES', 'GAME BOY', 'GBA', 'GENESIS', 'GAME GEAR', 'SMS', 'N64', 'NDS', 'ATARI'];

const DEMOS = [
  { id: 'nes-cyan', icon: '🎯', title: 'Cyan Sky Demo', desc: 'NROM-128 16KB Cyan Color & Raster Test', colors: [0x21, 0x30, 0x0F] },
  { id: 'nes-amber', icon: '🌅', title: 'Amber Sunset Demo', desc: 'NROM-128 Warm Amber Monochrome Test', colors: [0x27, 0x37, 0x17] },
  { id: 'nes-emerald', icon: '🌲', title: 'Phosphor Emerald Demo', desc: 'NROM-128 Classic Phosphor Green Test', colors: [0x29, 0x39, 0x19] },
];

const BIN_CHOICES = [
  ['a2600', 'Atari 2600', 'Typical for 2KB to 64KB cartridges'],
  ['segaMD', 'Sega Genesis / Mega Drive', 'Typical for 512KB to 4MB ROM dumps'],
  ['a7800', 'Atari 7800', '7800 raw binary rom files'],
  ['pce', 'PC Engine / TurboGrafx-16', 'PC Engine binary dumps'],
];

const CONTROLS = [
  ['D-Pad Up / Down / Left / Right', 'Arrow Keys'], ['A Button', 'X'], ['B Button', 'Z'],
  ['X Button (SNES)', 'S'], ['Y Button (SNES)', 'A'], ['L / R Bumpers (GBA/SNES)', 'Q / W'],
  ['Start', 'Enter'], ['Select', 'Right Shift'], ['Fast Forward', 'Space'], ['Emulator Menu / Pause', 'Escape'],
];

const TOAST_ICONS = { error: '⚠️', success: '✅', info: 'ℹ️' };

export default function App() {
  // ---------- State: when any of these change, React redraws the screen ----------
  const [games, setGames] = useState([]);                 // saved library (metadata only)
  const [session, setSession] = useState(null);           // the game being played, or null
  const [status, setStatus] = useState({ state: 'loading', text: 'Initializing DB...' });
  const [toasts, setToasts] = useState([]);
  const [query, setQuery] = useState('');
  const [manualCore, setManualCore] = useState('auto');
  const [showControls, setShowControls] = useState(false);
  const [binPrompt, setBinPrompt] = useState(null);       // { resolve } while the .bin modal is open
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef(null);
  const gamesRef = useRef(games);
  gamesRef.current = games; // always holds the newest list, for use inside async code

  const updateStatus = useCallback((state, text) => setStatus({ state, text }), []);

  const showToast = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  // ---------- Startup (runs once) ----------
  useEffect(() => {
    (async () => {
      const ok = await initDB();
      if (ok) {
        updateStatus('ready', 'Engine Ready');
      } else {
        updateStatus('error', 'Storage Blocked');
        showToast('IndexedDB unavailable. Games will only be kept in active session.', 'error');
      }
      navigator.storage?.persist?.();
      setGames(await loadGames());
    })();
  }, []);

  // The CSS hides the header while a game is running
  useEffect(() => {
    document.body.classList.toggle('is-playing', !!session);
  }, [session]);

  // ---------- Launching games ----------
  const launch = (game, romBlob) => {
    // runId changes every launch, so <Player key=...> starts fresh each time
    setSession({ id: game.id, name: game.name, core: game.core, romBlob, runId: Date.now() });
  };
  const exitPlayer = () => { setSession(null); updateStatus('ready', 'Engine Ready'); };
  const restartPlayer = () => setSession((s) => ({ ...s, runId: Date.now() }));

  const playFromLibrary = async (id) => {
    const game = gamesRef.current.find((g) => g.id === id);
    if (!game) return;
    const romBlob = await getRomBlob(id);
    if (!romBlob) return showToast('ROM data not found in local storage.', 'error');
    launch(game, romBlob);
  };

  const downloadFromLibrary = async (id) => {
    const game = gamesRef.current.find((g) => g.id === id);
    if (!game) return;
    const romBlob = await getRomBlob(id);
    if (!romBlob) return showToast('ROM data not found in local storage.', 'error');
    const url = URL.createObjectURL(romBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = game.fileName || `${game.name}.rom`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const removeGame = async (id) => {
    const game = gamesRef.current.find((g) => g.id === id);
    if (!window.confirm(`Delete ${game ? `"${game.name}"` : 'this game'} from your local library?`)) return;
    await deleteGame(id);
    setGames((list) => list.filter((g) => g.id !== id));
    showToast('Game removed from library', 'info');
  };

  const clearLibrary = async () => {
    if (games.length === 0) return;
    if (!window.confirm('Clear all saved games from your local library?')) return;
    await clearAllGames();
    setGames([]);
    showToast('Library cleared', 'info');
  };

  const launchDemo = async (demo) => {
    const romBlob = generateMinimalNesRom(...demo.colors);
    const game = { id: 'demo_' + demo.id, name: demo.title, fileName: demo.title + '.nes', core: 'nes', size: romBlob.size, date: Date.now() };
    const result = await saveGame(game, romBlob);
    if (result === 'ok' && !gamesRef.current.some((g) => g.id === game.id)) {
      setGames((list) => [game, ...list]);
    }
    launch(game, romBlob);
  };

  // ---------- Handling a dropped / selected ROM file ----------
  const askBinCore = () => new Promise((resolve) => setBinPrompt({ resolve }));
  const answerBin = (core) => { binPrompt?.resolve(core); setBinPrompt(null); };

  const detectCore = async (fileName, fileSize) => {
    if (manualCore !== 'auto') return manualCore; // dropdown always wins
    const parts = fileName.toLowerCase().split('.');
    if (parts.length > 1) {
      const ext = parts.pop();
      if (ext === 'zip' && parts.length > 0) {
        const prevExt = parts.pop();
        if (CORE_EXTENSIONS[prevExt]) return CORE_EXTENSIONS[prevExt];
      }
      if (ext === 'bin') {
        const chosen = await askBinCore();
        return chosen || (fileSize <= 65536 ? 'a2600' : 'segaMD');
      }
      if (CORE_EXTENSIONS[ext]) return CORE_EXTENSIONS[ext];
    }
    return 'nes';
  };

  const handleRomReady = async ({ blob, name, fileName, core, size }) => {
    const existing = gamesRef.current.find((g) => g.name === name && g.size === size);
    if (existing) {
      showToast(`Loaded "${existing.name}" from library`, 'info');
      return playFromLibrary(existing.id);
    }
    const game = { id: 'rom_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), name, fileName, core, size, date: Date.now() };
    const result = await saveGame(game, blob);
    if (result === 'ok') {
      setGames((list) => [game, ...list]);
      showToast(`Saved "${name}" to your library`, 'success');
    } else if (result === 'quota') {
      showToast('Storage full! Please free up space by deleting older games.', 'error');
    } else if (result === 'error') {
      showToast('Storage error while saving game to library.', 'error');
    }
    launch(game, blob);
  };

  const processRomFile = async (file) => {
    if (!file) return;
    if (file.size > LARGE_FILE_THRESHOLD) {
      showToast(`Large file (${formatBytes(file.size)}) detected. Decompression and loading may take a few seconds.`, 'info');
    }

    if (file.name.toLowerCase().endsWith('.zip')) {
      try {
        const zipBytes = new Uint8Array(await file.arrayBuffer());
        const unzipped = fflate.unzipSync(zipBytes, {
          filter(info) {
            const ext = info.name.split('.').pop().toLowerCase();
            return ext in CORE_EXTENSIONS && ext !== 'zip';
          },
        });
        const names = Object.keys(unzipped);
        if (names.length > 0) {
          const prio = (n) => {
            const i = ROM_PRIORITY.indexOf(n.split('.').pop().toLowerCase());
            return i === -1 ? 999 : i;
          };
          names.sort((a, b) => prio(a) - prio(b));
          const romName = names[0];
          const romBytes = unzipped[romName];
          const ext = romName.split('.').pop().toLowerCase();
          return handleRomReady({
            blob: new Blob([romBytes]),
            name: romName.replace(/\.[^/.]+$/, ''),
            fileName: romName,
            core: manualCore !== 'auto' ? manualCore : CORE_EXTENSIONS[ext] || 'nes',
            size: romBytes.byteLength,
          });
        }
      } catch (err) {
        console.warn('Zip decompression failed:', err);
        return showToast('Could not extract ROM from ZIP archive.', 'error');
      }
    }

    const core = await detectCore(file.name, file.size);
    await handleRomReady({ blob: file, name: file.name.replace(/\.[^/.]+$/, ''), fileName: file.name, core, size: file.size });
  };

  // Window-level listeners are created once, so keep a pointer to the newest function
  const processRef = useRef(processRomFile);
  processRef.current = processRomFile;

  // ---------- Drag & drop anywhere on the page ----------
  useEffect(() => {
    const stop = (e) => e.preventDefault();
    const onEnter = () => setDragOver(true);
    const onLeave = (e) => {
      if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) setDragOver(false);
    };
    const onDrop = (e) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) processRef.current(file);
    };
    window.addEventListener('dragover', stop);
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', stop);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // Escape closes any open modal
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setShowControls(false);
      if (binPrompt) answerBin(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [binPrompt]);

  // ---------- What we show ----------
  const q = query.trim().toLowerCase();
  const filtered = games.filter((g) => g.name?.toLowerCase().includes(q) || g.core?.toLowerCase().includes(q));
  const countText = `${games.length} ${games.length === 1 ? 'game' : 'games'}`;

  return (
    <>
      <header className="site-header">
        <div className="container header-content">
          <a href="#" className="brand">
            <div className="brand-icon">🎮</div>
            <div className="brand-text">
              <h1>EmulatorJS</h1>
              <p>Drag &amp; Drop Retro Web Player</p>
            </div>
          </a>
          <div className="header-actions">
            <span className={`header-badge badge-status-${status.state}`}>
              <span className={`dot dot-${status.state}`}></span> {status.text}
            </span>
            <button className="btn-header" title="Keyboard & Gamepad Controls" onClick={() => setShowControls(true)}>🕹️ Controls</button>
            <span className="header-badge" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#a5b4fc', borderColor: 'rgba(99, 102, 241, 0.3)' }}>
              {games.length} Saved
            </span>
          </div>
        </div>
      </header>

      {!session && (
        <main className="main-content">
          <div className="container">
            <section className="hero">
              <div className="hero-pill">⚡ 100% Client-Side WebAssembly Gaming</div>
              <h2>Drag &amp; Drop. Instant Play.</h2>
              <p>Drop any retro ROM file onto the canvas below to immediately launch the game. Files are parsed locally in memory with zero server uploads.</p>
            </section>

            <section className="dropzone-section">
              <div
                className={`dropzone-container${dragOver ? ' drag-over' : ''}`}
                title="Click or Drag & Drop ROM here"
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".nes,.snes,.smc,.sfc,.gba,.gb,.gbc,.gen,.md,.smd,.gg,.sms,.vb,.bin,.n64,.z64,.v64,.nds,.a26,.a78,.lnx,.pce,.ws,.wsc,.ngp,.ngc,.zip"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) processRomFile(file);
                    e.target.value = '';
                  }}
                />
                <div className="dropzone-icon-box">🕹️</div>
                <h3 className="dropzone-title">Drop your ROM file here to play</h3>
                <p className="dropzone-subtitle">Drop files anywhere or select a file from your device</p>

                <div className="dropzone-controls" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="btn-upload" onClick={() => fileInputRef.current?.click()}>📁 Browse ROM File</button>
                  <div className="core-select-wrapper">
                    <span className="core-select-label">System:</span>
                    <select className="core-select" value={manualCore} onChange={(e) => setManualCore(e.target.value)}>
                      <option value="auto">✨ Auto Detect</option>
                      {SYSTEM_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </div>
                </div>

                <div className="supported-systems">
                  {SYSTEM_TAGS.map((t) => <span key={t} className="system-tag">{t}</span>)}
                </div>
              </div>
            </section>

            <section className="quick-demos-section">
              <div className="section-header">
                <h3 className="section-title"><span>✨</span> Instant Test Demos</h3>
                <span className="section-badge">No ROM required • 1-Click play</span>
              </div>
              <div className="demos-grid">
                {DEMOS.map((demo) => (
                  <div className="demo-card" key={demo.id}>
                    <div className="demo-info">
                      <div className="demo-icon">{demo.icon}</div>
                      <div className="demo-details">
                        <h4>{demo.title}</h4>
                        <p>{demo.desc}</p>
                      </div>
                    </div>
                    <button className="btn-play-sm" onClick={() => launchDemo(demo)}>▶ Play Demo</button>
                  </div>
                ))}
              </div>
            </section>

            <section className="library-section">
              <div className="section-header">
                <h3 className="section-title">
                  <span>📁</span> Your Game Library
                  <span className="section-badge" style={{ marginLeft: '0.5rem' }}>{countText}</span>
                </h3>
                <button className="btn-clear" title="Remove all saved games" onClick={clearLibrary}>Clear Library</button>
              </div>

              <div className="library-toolbar">
                <div className="library-search-box">
                  <span className="search-icon">🔍</span>
                  <input
                    type="text"
                    className="library-search-input"
                    placeholder="Search saved games or system..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>

              <div className="library-grid">
                {filtered.length === 0 ? (
                  <div className="empty-library">
                    <div className="empty-library-icon">🕹️</div>
                    <h4>No games found</h4>
                    <p>{games.length === 0 ? 'Your library is empty. Drag and drop any ROM file above to add and play!' : 'No games match your search query.'}</p>
                  </div>
                ) : (
                  filtered.map((game) => (
                    <div className="game-card" key={game.id}>
                      <div className="game-card-top">
                        <div className="game-title-group">
                          <h4>{game.name}</h4>
                          <div className="game-meta">{formatBytes(game.size || 0)} • Added {new Date(game.date).toLocaleDateString()}</div>
                        </div>
                        <span className={`badge-${game.core} badge-console`}>{(SYSTEM_LABELS[game.core] || game.core).split(' ')[0]}</span>
                      </div>
                      <div className="game-card-actions">
                        <button className="btn-play-game" onClick={() => playFromLibrary(game.id)}>▶ Play Now</button>
                        <div>
                          <button className="card-icon-btn btn-download" title="Download ROM" onClick={() => downloadFromLibrary(game.id)}>⬇</button>
                          <button className="card-icon-btn btn-delete" title="Delete from library" onClick={() => removeGame(game.id)}>✕</button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </main>
      )}

      {session && (
        <Player
          key={session.runId}
          session={session}
          onExit={exitPlayer}
          onRestart={restartPlayer}
          onStatus={updateStatus}
        />
      )}

      {showControls && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setShowControls(false)}>
          <div className="modal-content">
            <div className="modal-header">
              <h3>🎮 Default Controls &amp; Shortcuts</h3>
              <button className="modal-close-btn" onClick={() => setShowControls(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                EmulatorJS automatically supports USB and Bluetooth gamepads natively. For keyboard, the standard bindings are:
              </p>
              <table className="controls-table">
                <thead><tr><th>Controller Action</th><th>Keyboard Key</th></tr></thead>
                <tbody>
                  {CONTROLS.map(([action, key]) => (
                    <tr key={action}><td>{action}</td><td><span className="key-pill">{key}</span></td></tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: '1.25rem', fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                💡 Tip: You can also customize keys, save states, and adjust shaders directly within the bottom in-game menu bar inside EmulatorJS.
              </div>
            </div>
          </div>
        </div>
      )}

      {binPrompt && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && answerBin(null)}>
          <div className="modal-content" style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <h3>🎮 Select Console for .bin ROM</h3>
              <button className="modal-close-btn" onClick={() => answerBin(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '1.25rem', lineHeight: 1.4 }}>
                The .bin extension is used by multiple consoles. Please choose the target system for this game:
              </p>
              <div className="bin-choices-list">
                {BIN_CHOICES.map(([core, title, sub]) => (
                  <button key={core} type="button" className="bin-choice-btn" onClick={() => answerBin(core)}>
                    <span className="bin-choice-title">{title}</span>
                    <span className="bin-choice-sub">{sub}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span>{TOAST_ICONS[t.type]}</span><span>{t.message}</span>
          </div>
        ))}
      </div>
    </>
  );
}
