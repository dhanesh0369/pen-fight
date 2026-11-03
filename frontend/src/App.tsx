import { useEffect, useState } from 'react'
import { initGame, destroyGame } from './game/Game'
import './App.css'

function App() {
  const [isFullscreen, setIsFullscreen] = useState(false);
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
      initGame({ mode: gameMode, roomCode });
      return () => {
        destroyGame();
      };
    }
  }, [gameState, gameMode, roomCode]);

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
