import { useEffect, useMemo, useRef, useState } from 'react';
import { EMULATOR_DATA_PATH, EMULATOR_LOADER_SCRIPT, SYSTEM_LABELS } from './utils';

// Safely put a value inside the iframe's <script> text
const js = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

export default function Player({ session, onExit, onRestart, onStatus }) {
  const { name, core, romBlob } = session;
  const label = SYSTEM_LABELS[core] || core.toUpperCase();

  // 'loading' -> 'playing' or 'error'
  const [phase, setPhase] = useState('loading');
  const [errorText, setErrorText] = useState('');
  const [blobUrl, setBlobUrl] = useState(null);
  const iframeRef = useRef(null);
  const containerRef = useRef(null);

  // 1) Turn the ROM file into a temporary URL the emulator can fetch.
  //    The returned function runs when the player closes: it frees the memory.
  useEffect(() => {
    const url = URL.createObjectURL(romBlob);
    setBlobUrl(url);
    onStatus('loading', `Loading ${label}...`);
    return () => URL.revokeObjectURL(url);
  }, [romBlob]);

  // 2) Listen for "started" / "error" messages from the iframe + 20s safety timeout
  useEffect(() => {
    const fail = (text, badge) => {
      setPhase('error');
      setErrorText(text);
      onStatus('error', badge);
    };
    const timer = setTimeout(
      () => fail('Emulator core initialization timed out. The CDN may be slow or blocked.', 'Core Timeout'),
      20000
    );
    const onMessage = (e) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type === 'EJS_STARTED') {
        clearTimeout(timer);
        setPhase('playing');
        onStatus('playing', `Emulating ${label}`);
      } else if (e.data?.type === 'EJS_ERROR') {
        clearTimeout(timer);
        fail('Failed to load emulator core script from pinned CDN.', 'CDN Error');
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };
  }, []);

  // 3) The tiny web page that runs inside the iframe (built once per ROM URL)
  const srcDoc = useMemo(() => {
    if (!blobUrl) return '';
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #game { width: 100%; height: 100%; overflow: hidden; background: #000; }
</style></head>
<body>
  <div id="game"></div>
  <script>
    window.EJS_player = '#game';
    window.EJS_core = ${js(core)};
    window.EJS_gameName = ${js(name)};
    window.EJS_color = '#6366f1';
    window.EJS_startOnLoaded = true;
    window.EJS_pathtodata = ${js(EMULATOR_DATA_PATH)};
    window.EJS_gameUrl = ${js(blobUrl)};
    window.EJS_onGameStart = function () {
      try { window.parent.postMessage({ type: 'EJS_STARTED' }, '*'); } catch (_) {}
    };
  </script>
  <script src="${EMULATOR_LOADER_SCRIPT}"
    onerror="try { window.parent.postMessage({ type: 'EJS_ERROR' }, '*'); } catch (_) {}"></script>
</body></html>`;
  }, [blobUrl, core, name]);

  // Stop the emulator cleanly before leaving / restarting
  const teardown = () => {
    const frame = iframeRef.current;
    if (!frame) return;
    try {
      const emu = frame.contentWindow?.EJS_emulator;
      emu?.pause?.();
      emu?.destroy?.();
      frame.src = 'about:blank';
    } catch (_) {}
  };

  const exit = () => { teardown(); onExit(); };
  const restart = () => { teardown(); onRestart(); };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch((err) => console.warn('Fullscreen error:', err));
    } else {
      document.exitFullscreen().catch((err) => console.warn('Exit fullscreen error:', err));
    }
  };

  return (
    <div id="view-player">
      <div className="player-topbar">
        <div className="player-left">
          <button className="btn-back" onClick={exit}>← Exit to Library</button>
          <span className="player-title">{name}</span>
          <span className={`badge-console badge-${core}`}>{label}</span>
        </div>
        <div className="player-right">
          <button className="player-tool-btn" title="Restart Game" onClick={restart}>🔄 Restart</button>
          <button className="player-tool-btn" title="Toggle Fullscreen" onClick={toggleFullscreen}>⛶ Fullscreen</button>
        </div>
      </div>

      <div className="player-viewport">
        <div id="player-container" ref={containerRef}>
          {phase === 'loading' && (
            <div className="player-overlay">
              <div className="player-spinner"></div>
              <p>Downloading and initializing {label} core...</p>
            </div>
          )}
          {phase === 'error' && (
            <div className="player-overlay">
              <div className="player-error-icon">⚠️</div>
              <p>{errorText}</p>
              <button className="btn-player-retry" onClick={restart}>🔄 Retry Launch</button>
            </div>
          )}
          {blobUrl && (
            <iframe
              ref={iframeRef}
              className="emulator-iframe"
              allow="autoplay; gamepad; fullscreen"
              allowFullScreen
              srcDoc={srcDoc}
            />
          )}
        </div>
      </div>

      <div className="player-bottombar">
        <div className="player-keys-hint">
          <span>Controls:</span>
          <span className="key-tag">D-Pad: Arrows</span>
          <span className="key-tag">A: X</span>
          <span className="key-tag">B: Z</span>
          <span className="key-tag">Start: Enter</span>
          <span className="key-tag">Select: Shift</span>
        </div>
        <div><span>Powered by EmulatorJS (v4.0.10)</span></div>
      </div>
    </div>
  );
}
