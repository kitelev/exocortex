/**
 * Mock for Three.js addons (OrbitControls, etc.)
 *
 * Provides mock implementations for Three.js addon modules used in 3D graph rendering.
 */

// Inline Vector3 mock to avoid circular dependencies
class MockVector3 {
  x = 0;
  y = 0;
  z = 0;
  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
}

// Mock OrbitControls class
export class OrbitControls {
  target: MockVector3 = new MockVector3();
  enableRotate = true;
  enableZoom = true;
  enablePan = true;
  enableDamping = true;
  dampingFactor = 0.05;
  rotateSpeed = 1.0;
  zoomSpeed = 1.0;
  panSpeed = 1.0;
  minDistance = 0;
  maxDistance = Infinity;
  minPolarAngle = 0;
  maxPolarAngle = Math.PI;
  autoRotate = false;
  autoRotateSpeed = 2.0;

  private listeners: Map<string, Set<() => void>> = new Map();

  constructor(_camera: unknown, _domElement: HTMLElement) {
    // No-op
  }

  addEventListener(event: string, callback: () => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  removeEventListener(event: string, callback: () => void): void {
    this.listeners.get(event)?.delete(callback);
  }

  update(): void {
    // No-op
  }

  dispose(): void {
    this.listeners.clear();
  }
}
