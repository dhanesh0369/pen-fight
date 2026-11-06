// Shared pen catalog used by the React lobby (selection UI) and the Phaser scene (physics).

export type PenTypeId = 'ballpoint' | 'gel' | 'marker';

export interface PenStats {
  id: PenTypeId;
  name: string;
  description: string;
  /** Body dimensions in logical pixels (length along the pen axis, thickness across it). */
  length: number;
  width: number;
  /** Matter.js body properties. */
  mass: number;
  frictionAir: number;
  restitution: number;
  /** Max force applied at 100% drag power. Scaled with mass so launch speeds stay comparable. */
  launchPower: number;
  /** How strongly an off-center flick converts into rotation (higher = spins more easily). */
  spinMultiplier: number;
  /** 0-5 ratings shown in the lobby. */
  ratings: { weight: number; speed: number; spin: number; bounce: number };
}

export const PEN_TYPES: Record<PenTypeId, PenStats> = {
  ballpoint: {
    id: 'ballpoint',
    name: 'Classic Ballpoint',
    description: 'Light & bouncy. Fast flicks and wild spin, but easy to knock off.',
    length: 150,
    width: 20,
    mass: 0.07,
    frictionAir: 0.026,
    restitution: 0.7,
    launchPower: 0.0038,
    spinMultiplier: 1.35,
    ratings: { weight: 1, speed: 5, spin: 5, bounce: 4 },
  },
  marker: {
    id: 'marker',
    name: 'Chunky Marker',
    description: 'Balanced all-rounder. Grippy and stable with steady, controlled shots.',
    length: 140,
    width: 32,
    mass: 0.12,
    frictionAir: 0.034,
    restitution: 0.45,
    launchPower: 0.0062,
    spinMultiplier: 0.95,
    ratings: { weight: 3, speed: 3, spin: 3, bounce: 2 },
  },
  gel: {
    id: 'gel',
    name: 'Heavy Metal Gel',
    description: 'A tank. Hard to push off the desk and hits like a truck, but slow to spin.',
    length: 170,
    width: 26,
    mass: 0.2,
    frictionAir: 0.03,
    restitution: 0.3,
    launchPower: 0.0098,
    spinMultiplier: 0.6,
    ratings: { weight: 5, speed: 2, spin: 1, bounce: 1 },
  },
};

export const PEN_TYPE_IDS = Object.keys(PEN_TYPES) as PenTypeId[];

export const isPenTypeId = (value: unknown): value is PenTypeId =>
  typeof value === 'string' && value in PEN_TYPES;

/** Max angular velocity (rad/step) from a full-power flick on the very tip, before spinMultiplier. */
export const BASE_SPIN = 0.3;
/** Fraction of linear power lost when the flick is converted fully into spin. */
export const SPIN_ENERGY_LOSS = 0.35;

export interface ShotResult {
  forceX: number;
  forceY: number;
  angularVelocity: number;
  /** Signed spin amount in [-1, 1]: lever ratio x perpendicular component. */
  spinAmount: number;
}

/**
 * Point-of-contact flick physics.
 *
 * Torque is r x F: the farther from the center the pen is struck (lever) and the more
 * perpendicular the flick is to the pen's axis, the more of the shot turns into rotation.
 * A dead-center or along-the-axis flick gives a straight push with no spin.
 *
 * @param stats       pen being flicked
 * @param penRotation pen angle in radians
 * @param contactX    contact offset along the pen axis in local space (-length/2 .. length/2)
 * @param dirX/dirY   normalized shot direction (world space)
 * @param power       0..1 drag power
 */
export const computeShot = (
  stats: PenStats,
  penRotation: number,
  contactX: number,
  dirX: number,
  dirY: number,
  power: number,
): ShotResult => {
  const halfLength = stats.length / 2;
  const lever = Math.max(-1, Math.min(1, contactX / halfLength));

  const axisX = Math.cos(penRotation);
  const axisY = Math.sin(penRotation);
  // 2D cross product (axis x direction) = sine of angle between them. Matches Matter's torque sign.
  const perpendicular = axisX * dirY - axisY * dirX;

  const spinAmount = lever * perpendicular;
  const linearFactor = 1 - SPIN_ENERGY_LOSS * Math.abs(spinAmount);
  const force = power * stats.launchPower * linearFactor;

  return {
    forceX: dirX * force,
    forceY: dirY * force,
    angularVelocity: spinAmount * power * BASE_SPIN * stats.spinMultiplier,
    spinAmount,
  };
};
