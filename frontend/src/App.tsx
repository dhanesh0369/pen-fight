import { useEffect, useState } from 'react'
import { initGame, destroyGame } from './game/Game'
import { PEN_TYPES, PEN_TYPE_IDS, type PenTypeId } from './game/pens'
import './App.css'

const RATING_LABELS = [
  ['weight', 'Weight'],
  ['speed', 'Speed'],
  ['spin', 'Spin'],
  ['bounce', 'Bounce'],
] as const;

function App() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [penType, setPenType] = useState<PenTypeId>(() => {
    const saved = localStorage.getItem('penfight.penType');
    return saved && saved in PEN_TYPES ? (saved as PenTypeId) : 'ballpoint';
  });

  useEffect(() => {
    localStorage.setItem('penfight.penType', penType);
  }, [penType]);
  const [gameState, setGameState] = useState<'lobby' | 'playing'>('lobby');
  const [gameMode, setGameMode] = useState<'single' | 'multiplayer'>('single');
  const [roomCode, setRoomCode] = useState('');

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch(err => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().then(() => {
          setIsFullscreen(false);
        });
      }
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Start game when entering playing state
  useEffect(() => {
    if (gameState === 'playing') {
      initGame({ mode: gameMode, roomCode, penType });
      return () => {
        destroyGame();
      };
    }
  }, [gameState, gameMode, roomCode, penType]);

  const handlePlayVsComputer = () => {
    setGameMode('single');
    setRoomCode('');
    setGameState('playing');
  };

  const handleJoinGame = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomCode.trim().length > 0) {
      setGameMode('multiplayer');
      setGameState('playing');
    }
  };

  const handleCreateGame = () => {
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    setGameMode('multiplayer');
    setRoomCode(code);
    setGameState('playing');
  };

  const handleBackToMenu = () => {
    setGameState('lobby');
    setRoomCode('');
  };

  return (
    <div className="app-container">
      {gameState === 'playing' && (
        <button className="menu-btn" onClick={handleBackToMenu}>
          ← Menu
        </button>
      )}
      <button className="fullscreen-btn" onClick={toggleFullScreen}>
        {isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
      </button>

      {gameState === 'lobby' ? (
        <div className="lobby-container">
          <div className="lobby-card">
            <h1 className="lobby-title">PEN FIGHT</h1>
            <p className="lobby-subtitle">Classic Desk Battle</p>

            <div className="pen-picker">
              <div className="pen-picker-label">Choose your pen</div>
              <div className="pen-options">
                {PEN_TYPE_IDS.map((id) => {
                  const pen = PEN_TYPES[id];
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`pen-option${penType === id ? ' selected' : ''}`}
                      onClick={() => setPenType(id)}
                      aria-pressed={penType === id}
                    >
                      <span
                        className={`pen-preview pen-preview-${id}`}
                        style={{ width: pen.length * 0.45, height: pen.width * 0.45 }}
                      />
                      <span className="pen-name">{pen.name}</span>
                    </button>
                  );
                })}
              </div>
              <p className="pen-description">{PEN_TYPES[penType].description}</p>
              <div className="pen-stats">
                {RATING_LABELS.map(([key, label]) => (
                  <div className="pen-stat" key={key}>
                    <span className="pen-stat-label">{label}</span>
                    <span className="pen-stat-bar">
                      <span
                        className="pen-stat-fill"
                        style={{ width: `${PEN_TYPES[penType].ratings[key] * 20}%` }}
                      />
                    </span>
                  </div>
                ))}
              </div>
              <p className="pen-tip">Tip: grab the pen near its tip and flick sideways for spin — grab the middle for a straight push.</p>
            </div>
            
            <div className="lobby-actions">
              <button className="btn-ai" onClick={handlePlayVsComputer}>
                🤖 Play vs Computer (Solo)
              </button>

              <div className="divider"><span>OR PLAY MULTIPLAYER</span></div>

              <button className="btn-primary" onClick={handleCreateGame}>
                Create Multiplayer Game
              </button>
              
              <form onSubmit={handleJoinGame} className="join-form">
                <input 
                  type="text" 
                  placeholder="Enter Room Code" 
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  maxLength={4}
                  className="room-input"
                />
                <button type="submit" className="btn-secondary" disabled={!roomCode.trim()}>
                  Join Game
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : (
        <main className="game-wrapper">
          <div id="game-container"></div>
        </main>
      )}
    </div>
  )
}

export default App
