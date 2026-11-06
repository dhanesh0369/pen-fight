import Phaser from 'phaser';
import MainScene from './scenes/MainScene';
import type { PenTypeId } from './pens';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1400,
  height: 900,
  parent: 'game-container',
  backgroundColor: '#1e293b',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'matter',
    matter: {
      gravity: { y: 0, x: 0 }, // Top-down view
      debug: false
    }
  },
  scene: [MainScene]
};

export interface GameOptions {
  mode: 'single' | 'multiplayer';
  roomCode?: string;
  penType?: PenTypeId;
}

let game: Phaser.Game | null = null;

export const initGame = (options: GameOptions) => {
  if (!game) {
    game = new Phaser.Game(config);
    // Wait for game to boot then start MainScene with data
    game.events.once('ready', () => {
      game?.scene.start('MainScene', options);
    });
  }
  return game;
};

export const destroyGame = () => {
  if (game) {
    game.destroy(true);
    game = null;
  }
};
