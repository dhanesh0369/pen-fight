import Phaser from 'phaser';

export default class MainScene extends Phaser.Scene {
  private pen1!: Phaser.Physics.Matter.Image;
  private pen2!: Phaser.Physics.Matter.Image;
  
  private currentTurn: 1 | 2 = 1;
  private isDragging = false;
  private dragStart = new Phaser.Math.Vector2();
  private dragLine!: Phaser.GameObjects.Graphics;
  private isMoving = false;
  
  // Game mode & AI state
  private gameMode: 'single' | 'multiplayer' = 'single';
  private aiTimer: Phaser.Time.TimerEvent | null = null;
  private isAIThinking = false;

  // Multiplayer state
  private roomCode!: string;
  private ws: WebSocket | null = null;
  private playerNum: 1 | 2 = 1;
  private gameStarted = false;
  private isMultiplayer = false;

  // Pen stats based on the spec
  private readonly CLASSIC_PEN = {
    mass: 0.1,
    frictionAir: 0.03, // Surface friction in top-down matter.js
    restitution: 0.55, // Bounce
    launchPower: 0.005, // Matter.js forces are much smaller numbers
  };

  constructor() {
    super({ key: 'MainScene' });
  }

  init(data: { mode?: 'single' | 'multiplayer'; roomCode?: string }) {
    this.gameMode = data.mode || (data.roomCode ? 'multiplayer' : 'single');
    if (this.gameMode === 'multiplayer' && data.roomCode) {
      this.roomCode = data.roomCode;
      this.isMultiplayer = true;
    } else {
      this.isMultiplayer = false;
      this.gameMode = 'single';
    }
  }

  preload() {
    // Generate placeholder pen graphics
    const graphics = this.make.graphics({ x: 0, y: 0 });
    
    // Pen 1 (Blue)
    graphics.fillStyle(0x3b82f6);
    graphics.fillRoundedRect(0, 0, 160, 24, 12); // Body
    graphics.fillStyle(0x1d4ed8);
    graphics.fillRoundedRect(120, 0, 40, 24, 12); // Cap
    graphics.generateTexture('pen1', 160, 24);
    graphics.clear();
    
    // Pen 2 (Red)
    graphics.fillStyle(0xef4444);
    graphics.fillRoundedRect(0, 0, 160, 24, 12); // Body
    graphics.fillStyle(0xb91c1c);
    graphics.fillRoundedRect(120, 0, 40, 24, 12); // Cap
    graphics.generateTexture('pen2', 160, 24);
    graphics.clear();
  }

  private arenaGraphics!: Phaser.GameObjects.Graphics;
  private arenaBounds!: Phaser.Geom.Rectangle;

  create() {
    this.createUI();
    this.createGameObjects();

    // Input Handling
    this.input.on('pointerdown', this.handlePointerDown, this);
    this.input.on('pointermove', this.handlePointerMove, this);
    this.input.on('pointerup', this.handlePointerUp, this);

    if (this.isMultiplayer) {
      this.connectWebSocket();
      this.turnText.setText(`Waiting for opponent... (Room: ${this.roomCode})`).setColor('#ffffff');
      this.gameStarted = false;
    } else {
      this.gameStarted = true;
      this.updateTurnText();
    }
  }

  private connectWebSocket() {
    this.ws = new WebSocket(`ws://localhost:8000/ws/${this.roomCode}`);
    
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'init') {
        this.playerNum = data.player_num;
        console.log(`Connected as Player ${this.playerNum}`);
      } else if (data.type === 'game_start') {
        this.gameStarted = true;
        this.currentTurn = 1;
        this.updateTurnText();
      } else if (data.type === 'sync_move' && data.player !== this.playerNum) {
        // Continuous position updates from the active player
        this.isMoving = true;
        this.pen1.setPosition(data.p1.x, data.p1.y);
        this.pen1.setAngle(data.p1.angle);
        this.pen2.setPosition(data.p2.x, data.p2.y);
        this.pen2.setAngle(data.p2.angle);
      } else if (data.type === 'sync' && data.player !== this.playerNum) {
        // Final position sync when pens stop moving
        this.pen1.setPosition(data.p1.x, data.p1.y);
        this.pen1.setAngle(data.p1.angle);
        this.pen1.setVelocity(0, 0);
        this.pen1.setAngularVelocity(0);

        this.pen2.setPosition(data.p2.x, data.p2.y);
        this.pen2.setAngle(data.p2.angle);
        this.pen2.setVelocity(0, 0);
        this.pen2.setAngularVelocity(0);

        this.isMoving = false;
        this.checkWinCondition();
        if (!this.isGameOver) {
          this.switchTurn();
        }
      } else if (data.type === 'restart' && data.player !== this.playerNum) {
        this.resetGame();
      }
    };
  }

  private createUI() {
    const cx = 1400 / 2;

    // UI Layout
    this.add.text(cx, 10, 'PEN FIGHT', { 
      fontSize: '48px', color: '#ffffff', fontStyle: 'bold'
    }).setOrigin(0.5, 0);

    this.turnText = this.add.text(cx, 65, 'Player 1 (Blue)\'s Turn', { 
      fontSize: '32px', color: '#60a5fa', fontStyle: 'bold'
    }).setOrigin(0.5, 0);
    
    this.gameOverText = this.add.text(cx, 450 - 40, '', { 
      fontSize: '64px', color: '#ffffff', fontStyle: 'bold',
      backgroundColor: '#00000088', padding: { x: 30, y: 15 }
    }).setOrigin(0.5).setDepth(20).setVisible(false);

    this.restartText = this.add.text(cx, 450 + 40, 'Click anywhere to restart', {
      fontSize: '32px', color: '#4ade80', backgroundColor: '#00000088',
      padding: { x: 15, y: 8 }
    }).setOrigin(0.5).setDepth(20).setVisible(false);
  }

  private createGameObjects() {
    const width = 1400;
    const height = 900;
    const uiHeight = 120;
    const paddingX = 80;
    const paddingY = 60;

    const arenaWidth = width - (paddingX * 2);
    const arenaHeight = height - uiHeight - paddingY;
    const arenaX = paddingX;
    const arenaY = uiHeight;
    const arenaCenterY = arenaY + (arenaHeight / 2);

    this.arenaBounds = new Phaser.Geom.Rectangle(arenaX, arenaY, arenaWidth, arenaHeight);

    this.arenaGraphics = this.add.graphics();
    this.arenaGraphics.fillStyle(0xd4a373);
    this.arenaGraphics.fillRect(arenaX, arenaY, arenaWidth, arenaHeight);
    this.arenaGraphics.lineStyle(8, 0x5c4033);
    this.arenaGraphics.strokeRect(arenaX, arenaY, arenaWidth, arenaHeight);
    this.arenaGraphics.lineStyle(2, 0x5c4033, 0.4);
    this.arenaGraphics.beginPath();
    this.arenaGraphics.moveTo(width / 2, arenaY);
    this.arenaGraphics.lineTo(width / 2, arenaY + arenaHeight);
    this.arenaGraphics.strokePath();

    // Create Pens using Matter.js
    this.pen1 = this.matter.add.image(width / 2 - (arenaWidth / 4), arenaCenterY, 'pen1').setRectangle(160, 24);
    this.setupPen(this.pen1);

    this.pen2 = this.matter.add.image(width / 2 + (arenaWidth / 4), arenaCenterY, 'pen2').setRectangle(160, 24);
    this.setupPen(this.pen2);
    this.pen2.setAngle(180);
    
    this.dragLine = this.add.graphics();
    this.dragLine.setDepth(10);
  }

  private turnText!: Phaser.GameObjects.Text;
  private gameOverText!: Phaser.GameObjects.Text;
  private restartText!: Phaser.GameObjects.Text;
  private isGameOver = false;

  private setupPen(pen: Phaser.Physics.Matter.Image) {
    pen.setBounce(this.CLASSIC_PEN.restitution);
    pen.setFrictionAir(this.CLASSIC_PEN.frictionAir);
    pen.setMass(this.CLASSIC_PEN.mass);
  }

  private updateTurnText() {
    let text = '';
    if (this.gameMode === 'single') {
      if (this.currentTurn === 1) {
        text = 'Your Turn (Blue)';
        this.turnText.setColor('#60a5fa');
      } else {
        text = this.isAIThinking ? 'Computer Thinking... (Red)' : 'Computer\'s Turn (Red)';
        this.turnText.setColor('#f87171');
      }
    } else {
      if (this.currentTurn === 1) {
        text = 'Player 1 (Blue)\'s Turn';
        this.turnText.setColor('#60a5fa');
      } else {
        text = 'Player 2 (Red)\'s Turn';
        this.turnText.setColor('#f87171');
      }

      if (this.isMultiplayer) {
        if (this.currentTurn === this.playerNum) {
          text += ' (You)';
        }
      }
    }
    this.turnText.setText(text);
  }

  private resetGame() {
    if (this.aiTimer) {
      this.aiTimer.remove();
      this.aiTimer = null;
    }
    this.isAIThinking = false;
    if (this.dragLine) {
      this.dragLine.clear();
    }
    this.isGameOver = false;
    this.isMoving = false;
    this.currentTurn = 1;
    this.gameOverText.setVisible(false);
    this.restartText.setVisible(false);
    
    // Reset pen positions
    const width = 1400;
    const paddingX = 80;
    const arenaWidth = width - (paddingX * 2);
    const arenaCenterY = 120 + ((900 - 120 - 60) / 2);
    
    this.pen1.setPosition(width / 2 - (arenaWidth / 4), arenaCenterY);
    this.pen1.setAngle(0);
    this.pen1.setVelocity(0, 0);
    this.pen1.setAngularVelocity(0);

    this.pen2.setPosition(width / 2 + (arenaWidth / 4), arenaCenterY);
    this.pen2.setAngle(180);
    this.pen2.setVelocity(0, 0);
    this.pen2.setAngularVelocity(0);

    this.updateTurnText();
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer) {
    if (this.isGameOver) {
      this.resetGame();
      if (this.isMultiplayer && this.ws) {
        this.ws.send(JSON.stringify({ type: 'restart', player: this.playerNum }));
      }
      return;
    }

    if (!this.gameStarted) return;
    if (this.isMoving) return;
    
    // In single player, player can only control Pen 1
    if (this.gameMode === 'single' && (this.currentTurn !== 1 || this.isAIThinking)) return;

    // In multiplayer, only allow grabbing if it's your turn
    if (this.isMultiplayer && this.currentTurn !== this.playerNum) return;

    const currentPen = this.currentTurn === 1 ? this.pen1 : this.pen2;
    
    // Allow grabbing anywhere reasonably close to the pen
    if (Phaser.Math.Distance.Between(pointer.x, pointer.y, currentPen.x, currentPen.y) < 100) {
      this.isDragging = true;
      this.dragStart.set(currentPen.x, currentPen.y);
    }
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer) {
    if (!this.isDragging) return;

    this.dragLine.clear();
    // Draw a trajectory aiming line opposite to drag
    const dx = this.dragStart.x - pointer.x;
    const dy = this.dragStart.y - pointer.y;

    const currentPen = this.currentTurn === 1 ? this.pen1 : this.pen2;

    this.dragLine.lineStyle(4, 0xffffff, 0.8);
    this.dragLine.beginPath();
    this.dragLine.moveTo(currentPen.x, currentPen.y);
    // The line shows where the pen will shoot
    this.dragLine.lineTo(currentPen.x + dx, currentPen.y + dy);
    this.dragLine.strokePath();
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer) {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.dragLine.clear();

    const dx = this.dragStart.x - pointer.x;
    const dy = this.dragStart.y - pointer.y;
    
    const maxDrag = 250;
    const distance = Math.min(Phaser.Math.Distance.Between(0, 0, dx, dy), maxDrag);
    const power = distance / maxDrag;
    
    if (power > 0.05) {
        const forceX = (dx / distance) * power * this.CLASSIC_PEN.launchPower;
        const forceY = (dy / distance) * power * this.CLASSIC_PEN.launchPower;
        
        const playerToShoot = this.isMultiplayer ? this.playerNum : this.currentTurn;
        this.applyShot(forceX, forceY, playerToShoot);

        // We no longer send the 'shoot' event. 
        // The active player will just continuously sync positions in update().
    }
  }

  private applyShot(forceX: number, forceY: number, player: number) {
    const currentPen = player === 1 ? this.pen1 : this.pen2;
    currentPen.applyForce(new Phaser.Math.Vector2(forceX, forceY));
    currentPen.setAngularVelocity((Math.random() > 0.5 ? 1 : -1) * 0.15);
    this.isMoving = true;
  }

  update() {
    if (this.isGameOver) return;

    // In Matter.js, bodies naturally sleep or stop based on frictionAir.
    // We check their velocities to determine when the turn ends.
    const v1 = this.pen1.body ? (this.pen1.body as MatterJS.BodyType).velocity : {x:0, y:0};
    const v2 = this.pen2.body ? (this.pen2.body as MatterJS.BodyType).velocity : {x:0, y:0};
    const speed1 = v1.x * v1.x + v1.y * v1.y;
    const speed2 = v2.x * v2.x + v2.y * v2.y;
    
    const angSpeed1 = this.pen1.body ? Math.abs((this.pen1.body as MatterJS.BodyType).angularVelocity) : 0;
    const angSpeed2 = this.pen2.body ? Math.abs((this.pen2.body as MatterJS.BodyType).angularVelocity) : 0;

    // Thresholds for "stopped" in Matter.js
    const stopThreshold = 0.05;
    const angStopThreshold = 0.01;

    // In multiplayer, the active player broadcasts positions every frame while moving
    if (this.isMultiplayer && this.isMoving && this.currentTurn === this.playerNum && this.ws) {
      this.ws.send(JSON.stringify({
        type: 'sync_move',
        player: this.playerNum,
        p1: { x: this.pen1.x, y: this.pen1.y, angle: this.pen1.angle },
        p2: { x: this.pen2.x, y: this.pen2.y, angle: this.pen2.angle }
      }));
    }

    // Manually clamp velocity to 0 when very slow to prevent infinite sliding
    if (speed1 < stopThreshold && angSpeed1 < angStopThreshold && this.pen1.body) {
      this.pen1.setVelocity(0, 0);
      this.pen1.setAngularVelocity(0);
    }
    if (speed2 < stopThreshold && angSpeed2 < angStopThreshold && this.pen2.body) {
      this.pen2.setVelocity(0, 0);
      this.pen2.setAngularVelocity(0);
    }

    // The active player (or local player) evaluates when the pens have stopped
    const isActivePlayer = !this.isMultiplayer || this.currentTurn === this.playerNum;

    if (isActivePlayer && this.isMoving && 
        speed1 < stopThreshold && speed2 < stopThreshold && 
        angSpeed1 < angStopThreshold && angSpeed2 < angStopThreshold) {
      
      this.isMoving = false;

      if (this.isMultiplayer) {
        // In multiplayer, the active player broadcasts the final positions
        if (this.ws) {
          this.ws.send(JSON.stringify({
            type: 'sync',
            player: this.playerNum,
            p1: { x: this.pen1.x, y: this.pen1.y, angle: this.pen1.angle },
            p2: { x: this.pen2.x, y: this.pen2.y, angle: this.pen2.angle }
          }));
          
          this.checkWinCondition();
          if (!this.isGameOver) {
            this.switchTurn();
          }
        }
      } else {
        // Local multiplayer logic
        this.checkWinCondition();
        if (!this.isGameOver) {
          this.switchTurn();
        }
      }
    }
  }

  private checkWinCondition() {
    const pen1Out = !Phaser.Geom.Rectangle.Contains(this.arenaBounds, this.pen1.x, this.pen1.y);
    const pen2Out = !Phaser.Geom.Rectangle.Contains(this.arenaBounds, this.pen2.x, this.pen2.y);

    if (pen1Out && pen2Out) {
      this.gameOver('Draw!');
    } else if (pen1Out) {
      this.gameOver(this.gameMode === 'single' ? 'Computer Wins!' : 'Player 2 (Red) Wins!');
    } else if (pen2Out) {
      this.gameOver(this.gameMode === 'single' ? 'You Win! 🏆' : 'Player 1 (Blue) Wins!');
    }
  }

  private switchTurn() {
    this.currentTurn = this.currentTurn === 1 ? 2 : 1;
    this.updateTurnText();

    if (this.gameMode === 'single' && this.currentTurn === 2 && !this.isGameOver) {
      this.triggerAITurn();
    }
  }

  private triggerAITurn() {
    this.isAIThinking = true;
    this.updateTurnText();

    // AI "thinks" for 600ms, then draws aim line for 400ms, then shoots!
    this.aiTimer = this.time.delayedCall(600, () => {
      if (this.isGameOver || this.currentTurn !== 2) {
        this.isAIThinking = false;
        return;
      }

      // Calculate shot towards Pen 1
      const targetX = this.pen1.x;
      const targetY = this.pen1.y;
      const originX = this.pen2.x;
      const originY = this.pen2.y;

      const dx = targetX - originX;
      const dy = targetY - originY;
      const dist = Phaser.Math.Distance.Between(originX, originY, targetX, targetY);

      // Add a slight human-like aim imperfection (±4 degrees)
      const baseAngle = Math.atan2(dy, dx);
      const angleVariation = (Math.random() - 0.5) * 0.14;
      const angle = baseAngle + angleVariation;

      // Power calculation based on distance
      const minPower = 0.45;
      const maxPower = 0.92;
      const distanceFactor = Phaser.Math.Clamp(dist / 550, minPower, maxPower);
      const power = distanceFactor + (Math.random() * 0.1 - 0.05);

      // Visual Aiming Indicator (Computer shows its trajectory before releasing)
      const aimDist = Math.min(dist * 0.7, 200);
      const aimEndX = originX + Math.cos(angle) * aimDist;
      const aimEndY = originY + Math.sin(angle) * aimDist;

      this.dragLine.clear();
      this.dragLine.lineStyle(4, 0xf87171, 0.85); // Red aim line for AI
      this.dragLine.beginPath();
      this.dragLine.moveTo(originX, originY);
      this.dragLine.lineTo(aimEndX, aimEndY);
      this.dragLine.strokePath();

      this.aiTimer = this.time.delayedCall(450, () => {
        this.dragLine.clear();
        this.isAIThinking = false;
        this.updateTurnText();

        if (this.isGameOver || this.currentTurn !== 2) return;

        const forceX = Math.cos(angle) * power * this.CLASSIC_PEN.launchPower;
        const forceY = Math.sin(angle) * power * this.CLASSIC_PEN.launchPower;
        this.applyShot(forceX, forceY, 2);
      });
    });
  }

  private gameOver(message: string) {
    if (this.aiTimer) {
      this.aiTimer.remove();
      this.aiTimer = null;
    }
    this.isAIThinking = false;
    this.isGameOver = true;
    this.gameOverText.setText(message).setVisible(true);
    this.restartText.setVisible(true);
  }

  shutdown() {
    if (this.aiTimer) {
      this.aiTimer.remove();
      this.aiTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
