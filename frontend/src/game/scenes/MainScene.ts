import Phaser from 'phaser';
import {
  PEN_TYPES,
  PEN_TYPE_IDS,
  computeShot,
  isPenTypeId,
  type PenStats,
  type PenTypeId,
} from '../pens';

const PLAYER_COLORS: Record<1 | 2, { body: number; dark: number; grip: number }> = {
  1: { body: 0x3b82f6, dark: 0x1d4ed8, grip: 0x1e3a8a },
  2: { body: 0xef4444, dark: 0xb91c1c, grip: 0x7f1d1d },
};

export default class MainScene extends Phaser.Scene {
  private pen1!: Phaser.Physics.Matter.Image;
  private pen2!: Phaser.Physics.Matter.Image;
  private penTypes: Record<1 | 2, PenTypeId> = { 1: 'ballpoint', 2: 'ballpoint' };
  
  private currentTurn: 1 | 2 = 1;
  private isDragging = false;
  private dragStart = new Phaser.Math.Vector2();
  /** Where on the pen the player grabbed, as an offset along the pen axis (local space). */
  private grabLocalX = 0;
  private dragLine!: Phaser.GameObjects.Graphics;
  private aimText!: Phaser.GameObjects.Text;
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
  private localPenType: PenTypeId = 'ballpoint';

  private readonly MAX_DRAG = 250;

  constructor() {
    super({ key: 'MainScene' });
  }

  init(data: { mode?: 'single' | 'multiplayer'; roomCode?: string; penType?: PenTypeId }) {
    this.gameMode = data.mode || (data.roomCode ? 'multiplayer' : 'single');
    this.localPenType = isPenTypeId(data.penType) ? data.penType : 'ballpoint';

    if (this.gameMode === 'multiplayer' && data.roomCode) {
      this.roomCode = data.roomCode;
      this.isMultiplayer = true;
      // Real types for both slots arrive from the server; show ours in slot 1 until then.
      this.penTypes = { 1: this.localPenType, 2: 'ballpoint' };
    } else {
      this.isMultiplayer = false;
      this.gameMode = 'single';
      // Computer picks a random pen
      const aiPen = PEN_TYPE_IDS[Math.floor(Math.random() * PEN_TYPE_IDS.length)];
      this.penTypes = { 1: this.localPenType, 2: aiPen };
    }
  }

  preload() {
    // Generate a texture for every pen type in both player colors
    for (const id of PEN_TYPE_IDS) {
      this.generatePenTexture(PEN_TYPES[id], 1);
      this.generatePenTexture(PEN_TYPES[id], 2);
    }
  }

  private penTextureKey(type: PenTypeId, player: 1 | 2) {
    return `pen_${type}_${player}`;
  }

  private generatePenTexture(stats: PenStats, player: 1 | 2) {
    const { length: L, width: W } = stats;
    const c = PLAYER_COLORS[player];
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const r = W / 2;
    const nib = Math.round(L * 0.1);

    // Nib / tip (left end, pointing along -x)
    g.fillStyle(stats.id === 'marker' ? 0x111827 : 0xd1d5db);
    g.fillTriangle(0, r, nib, r * 0.35, nib, W - r * 0.35);

    // Body
    g.fillStyle(c.body);
    g.fillRoundedRect(nib - 2, 0, L - nib + 2, W, Math.min(r, 12));

    // Grip section near the nib
    g.fillStyle(c.grip, 0.9);
    g.fillRect(nib + 4, 2, L * 0.18, W - 4);

    // Cap (right end)
    const capLen = L * 0.25;
    g.fillStyle(c.dark);
    g.fillRoundedRect(L - capLen, 0, capLen, W, Math.min(r, 12));

    if (stats.id === 'gel') {
      // Metallic bands for the heavy pen
      g.fillStyle(0xe5e7eb);
      g.fillRect(L - capLen - 6, 0, 5, W);
      g.fillRect(nib + 4 + L * 0.18, 0, 4, W);
      g.fillStyle(0x9ca3af);
      g.fillRect(L - capLen + 8, r - 2, capLen - 16, 4); // clip
    } else if (stats.id === 'ballpoint') {
      g.fillStyle(0xffffff, 0.85);
      g.fillRect(L - capLen + 6, r - 1.5, capLen - 12, 3); // thin clip
    } else {
      // Marker: chunky end cap stripe
      g.fillStyle(0xffffff, 0.25);
      g.fillRect(L - capLen + 4, 4, 6, W - 8);
    }

    // Highlight for a bit of depth
    g.fillStyle(0xffffff, 0.18);
    g.fillRect(nib + 2, 2, L - nib - 6, Math.max(2, W * 0.18));

    g.generateTexture(this.penTextureKey(stats.id, player), L, W);
    g.destroy();
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
    this.ws = new WebSocket(`ws://localhost:8000/ws/${this.roomCode}?pen=${this.localPenType}`);
    
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'init') {
        this.playerNum = data.player_num;
        console.log(`Connected as Player ${this.playerNum}`);
        // Show our chosen pen in our actual slot while waiting
        this.setPenType(this.playerNum, this.localPenType);
        this.setPenType(this.playerNum === 1 ? 2 : 1, 'ballpoint');
        this.resetGame();
        this.turnText.setText(`Waiting for opponent... (Room: ${this.roomCode})`).setColor('#ffffff');
      } else if (data.type === 'game_start') {
        const pens = data.state?.pens ?? {};
        this.setPenType(1, isPenTypeId(pens['1']) ? pens['1'] : 'ballpoint');
        this.setPenType(2, isPenTypeId(pens['2']) ? pens['2'] : 'ballpoint');
        this.resetGame();
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

    // Pen name labels above each side of the desk
    this.penLabel1 = this.add.text(80, 92, '', {
      fontSize: '18px', color: '#93c5fd', fontStyle: 'bold'
    }).setOrigin(0, 0);
    this.penLabel2 = this.add.text(1320, 92, '', {
      fontSize: '18px', color: '#fca5a5', fontStyle: 'bold'
    }).setOrigin(1, 0);
    
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
    this.pen1 = this.matter.add.image(width / 2 - (arenaWidth / 4), arenaCenterY, this.penTextureKey(this.penTypes[1], 1));
    this.setPenType(1, this.penTypes[1]);

    this.pen2 = this.matter.add.image(width / 2 + (arenaWidth / 4), arenaCenterY, this.penTextureKey(this.penTypes[2], 2));
    this.setPenType(2, this.penTypes[2]);
    this.pen2.setAngle(180);
    
    this.dragLine = this.add.graphics();
    this.dragLine.setDepth(10);

    this.aimText = this.add.text(0, 0, '', {
      fontSize: '18px', color: '#ffffff', fontStyle: 'bold',
      backgroundColor: '#00000099', padding: { x: 8, y: 4 }
    }).setDepth(11).setVisible(false);
  }

  private turnText!: Phaser.GameObjects.Text;
  private penLabel1!: Phaser.GameObjects.Text;
  private penLabel2!: Phaser.GameObjects.Text;
  private gameOverText!: Phaser.GameObjects.Text;
  private restartText!: Phaser.GameObjects.Text;
  private isGameOver = false;

  private getPen(player: 1 | 2) {
    return player === 1 ? this.pen1 : this.pen2;
  }

  private getStats(player: 1 | 2) {
    return PEN_TYPES[this.penTypes[player]];
  }

  /** Swap a pen's texture and rebuild its physics body for the given pen type. */
  private setPenType(player: 1 | 2, type: PenTypeId) {
    this.penTypes[player] = type;
    const pen = this.getPen(player);
    if (!pen) return;

    const stats = PEN_TYPES[type];
    const { x, y, angle } = pen;

    pen.setTexture(this.penTextureKey(type, player));
    pen.setRectangle(stats.length, stats.width);
    this.setupPen(pen, stats);
    pen.setPosition(x, y);
    pen.setAngle(angle);

    const label = player === 1 ? this.penLabel1 : this.penLabel2;
    label?.setText(stats.name);
  }

  private setupPen(pen: Phaser.Physics.Matter.Image, stats: PenStats) {
    pen.setBounce(stats.restitution);
    pen.setFrictionAir(stats.frictionAir);
    pen.setMass(stats.mass);
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
    this.aimText?.setVisible(false);
    this.isDragging = false;
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

  /** Convert a world point into the pen's local frame (x = along the pen axis). */
  private toPenLocal(pen: Phaser.Physics.Matter.Image, worldX: number, worldY: number) {
    const dx = worldX - pen.x;
    const dy = worldY - pen.y;
    const cos = Math.cos(pen.rotation);
    const sin = Math.sin(pen.rotation);
    return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
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

    const currentPen = this.getPen(this.currentTurn);
    const stats = this.getStats(this.currentTurn);
    
    // Grab test in the pen's local space: anywhere along its length, with a forgiving margin
    const local = this.toPenLocal(currentPen, pointer.x, pointer.y);
    const halfLength = stats.length / 2;
    if (Math.abs(local.x) <= halfLength + 20 && Math.abs(local.y) <= stats.width / 2 + 35) {
      this.isDragging = true;
      // Remember the point of contact along the pen axis (this drives the spin)
      this.grabLocalX = Phaser.Math.Clamp(local.x, -halfLength, halfLength);
      this.dragStart.set(pointer.x, pointer.y);
      this.drawAim(pointer);
    }
  }

  /** Read the current drag as a shot: direction, power and resulting spin. */
  private readDrag(pointer: Phaser.Input.Pointer) {
    const dx = this.dragStart.x - pointer.x;
    const dy = this.dragStart.y - pointer.y;
    const rawDistance = Phaser.Math.Distance.Between(0, 0, dx, dy);
    const distance = Math.min(rawDistance, this.MAX_DRAG);
    const power = distance / this.MAX_DRAG;
    const dirX = rawDistance > 0 ? dx / rawDistance : 0;
    const dirY = rawDistance > 0 ? dy / rawDistance : 0;

    const pen = this.getPen(this.currentTurn);
    const shot = computeShot(this.getStats(this.currentTurn), pen.rotation, this.grabLocalX, dirX, dirY, power);
    return { dirX, dirY, power, shot };
  }

  /** Contact point on the pen in world space. */
  private contactWorldPoint(pen: Phaser.Physics.Matter.Image, localX: number) {
    return {
      x: pen.x + Math.cos(pen.rotation) * localX,
      y: pen.y + Math.sin(pen.rotation) * localX,
    };
  }

  private drawAimGraphics(
    pen: Phaser.Physics.Matter.Image,
    localX: number,
    dirX: number,
    dirY: number,
    power: number,
    spinAmount: number,
    tint?: number,
  ) {
    const contact = this.contactWorldPoint(pen, localX);
    const g = this.dragLine;
    g.clear();

    // Power-coloured arrow from the contact point (green -> yellow -> red)
    const powerColor = tint ?? Phaser.Display.Color.GetColor(
      Math.round(Phaser.Math.Linear(74, 239, power)),
      Math.round(Phaser.Math.Linear(222, 68, power)),
      Math.round(Phaser.Math.Linear(128, 68, power)),
    );
    const len = 40 + power * 220;
    const endX = contact.x + dirX * len;
    const endY = contact.y + dirY * len;

    g.lineStyle(4, powerColor, 0.9);
    g.beginPath();
    g.moveTo(contact.x, contact.y);
    g.lineTo(endX, endY);
    g.strokePath();

    // Arrow head
    const headAngle = Math.atan2(dirY, dirX);
    g.fillStyle(powerColor, 0.9);
    g.fillTriangle(
      endX + Math.cos(headAngle) * 14, endY + Math.sin(headAngle) * 14,
      endX + Math.cos(headAngle + 2.5) * 12, endY + Math.sin(headAngle + 2.5) * 12,
      endX + Math.cos(headAngle - 2.5) * 12, endY + Math.sin(headAngle - 2.5) * 12,
    );

    // Contact point marker
    g.fillStyle(0xffffff, 1);
    g.fillCircle(contact.x, contact.y, 6);
    g.lineStyle(2, 0x000000, 0.6);
    g.strokeCircle(contact.x, contact.y, 6);

    // Spin arc around the pen center (direction + magnitude)
    const absSpin = Math.abs(spinAmount);
    if (absSpin > 0.05 && power > 0.05) {
      const radius = this.getStats(this.currentTurn).length / 2 + 18;
      const sweep = absSpin * Math.PI * 0.9;
      const start = pen.rotation - sweep / 2;
      const end = pen.rotation + sweep / 2;
      const clockwise = spinAmount > 0;

      g.lineStyle(3, 0xfacc15, 0.9);
      g.beginPath();
      g.arc(pen.x, pen.y, radius, start, end, false);
      g.strokePath();

      // Arrow head at the leading end of the arc
      const tipAngle = clockwise ? end : start;
      const tx = pen.x + Math.cos(tipAngle) * radius;
      const ty = pen.y + Math.sin(tipAngle) * radius;
      const tangent = tipAngle + (clockwise ? Math.PI / 2 : -Math.PI / 2);
      g.fillStyle(0xfacc15, 0.9);
      g.fillTriangle(
        tx + Math.cos(tangent) * 12, ty + Math.sin(tangent) * 12,
        tx + Math.cos(tangent + 2.4) * 10, ty + Math.sin(tangent + 2.4) * 10,
        tx + Math.cos(tangent - 2.4) * 10, ty + Math.sin(tangent - 2.4) * 10,
      );
    }
  }

  private drawAim(pointer: Phaser.Input.Pointer) {
    const pen = this.getPen(this.currentTurn);
    const { dirX, dirY, power, shot } = this.readDrag(pointer);
    this.drawAimGraphics(pen, this.grabLocalX, dirX, dirY, power, shot.spinAmount);

    const spinPct = Math.round(Math.abs(shot.spinAmount) * 100);
    const spinIcon = spinPct < 5 ? '•' : shot.spinAmount > 0 ? '⟳' : '⟲';
    this.aimText
      .setText(`Power ${Math.round(power * 100)}%  Spin ${spinIcon} ${spinPct}%`)
      .setPosition(pointer.x + 18, pointer.y + 18)
      .setVisible(true);
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer) {
    if (!this.isDragging) return;
    this.drawAim(pointer);
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer) {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.dragLine.clear();
    this.aimText.setVisible(false);

    const { power, shot } = this.readDrag(pointer);
    
    if (power > 0.05) {
        const playerToShoot = this.isMultiplayer ? this.playerNum : this.currentTurn;
        this.applyShot(shot.forceX, shot.forceY, shot.angularVelocity, playerToShoot);

        // We no longer send the 'shoot' event. 
        // The active player will just continuously sync positions in update().
    }
  }

  private applyShot(forceX: number, forceY: number, angularVelocity: number, player: 1 | 2) {
    const currentPen = this.getPen(player);
    currentPen.applyForce(new Phaser.Math.Vector2(forceX, forceY));
    // Spin comes from where the pen was struck (point-of-contact torque), not randomness
    currentPen.setAngularVelocity(angularVelocity);
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

      // AI mostly flicks near the center, sometimes off-center for a bit of spin
      const stats = this.getStats(2);
      const contactX = (Math.random() - 0.5) * 0.7 * stats.length / 2;
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);
      const shot = computeShot(stats, this.pen2.rotation, contactX, dirX, dirY, power);

      // Visual Aiming Indicator (Computer shows its trajectory and contact point before releasing)
      this.drawAimGraphics(this.pen2, contactX, dirX, dirY, Math.min(power, 1), shot.spinAmount, 0xf87171);

      this.aiTimer = this.time.delayedCall(450, () => {
        this.dragLine.clear();
        this.isAIThinking = false;
        this.updateTurnText();

        if (this.isGameOver || this.currentTurn !== 2) return;

        this.applyShot(shot.forceX, shot.forceY, shot.angularVelocity, 2);
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
