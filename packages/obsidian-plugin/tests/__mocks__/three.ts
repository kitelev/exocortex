/**
 * Mock for Three.js library
 *
 * Provides mock implementations for Three.js classes used in 3D graph rendering.
 * This allows unit testing without WebGL context.
 */

// Mock Vector classes
export class Vector2 {
  x = 0;
  y = 0;
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }
  set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }
}

export class Vector3 {
  x = 0;
  y = 0;
  z = 0;
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  normalize(): this {
    return this;
  }
  copy(v: Vector3): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }
}

// Mock Color class
export class Color {
  r = 0;
  g = 0;
  b = 0;
  constructor(_color?: number | string) {
    // Just store default values
  }
}

// Mock Fog class
export class Fog {
  color: Color;
  near: number;
  far: number;
  constructor(color: number, near: number, far: number) {
    this.color = new Color(color);
    this.near = near;
    this.far = far;
  }
}

// Mock Scene class
export class Scene {
  background: Color | null = null;
  fog: Fog | null = null;
  children: unknown[] = [];

  add(object: unknown): void {
    this.children.push(object);
  }

  remove(object: unknown): void {
    const index = this.children.indexOf(object);
    if (index !== -1) {
      this.children.splice(index, 1);
    }
  }

  clear(): void {
    this.children = [];
  }
}

// Mock Camera classes
export class PerspectiveCamera {
  fov: number;
  aspect: number;
  near: number;
  far: number;
  position: Vector3 = new Vector3();
  up: Vector3 = new Vector3(0, 1, 0);
  zoom = 1;

  constructor(fov = 50, aspect = 1, near = 0.1, far = 2000) {
    this.fov = fov;
    this.aspect = aspect;
    this.near = near;
    this.far = far;
  }

  lookAt(_x: number, _y: number, _z: number): void {
    // No-op
  }

  updateProjectionMatrix(): void {
    // No-op
  }
}

// Mock Renderer class
export class WebGLRenderer {
  domElement: HTMLCanvasElement;
  info = {
    render: { calls: 0, triangles: 0 },
    memory: { geometries: 0, textures: 0 },
  };

  constructor(_params?: { antialias?: boolean; powerPreference?: string }) {
    this.domElement = document.createElement("canvas");
  }

  setSize(_width: number, _height: number): void {
    // No-op
  }

  setPixelRatio(_ratio: number): void {
    // No-op
  }

  getSize(target: Vector2): Vector2 {
    target.set(800, 600);
    return target;
  }

  render(_scene: Scene, _camera: PerspectiveCamera): void {
    // No-op
  }

  dispose(): void {
    // No-op
  }
}

// Mock Group class
export class Group {
  children: unknown[] = [];
  visible = true;

  add(object: unknown): void {
    this.children.push(object);
  }

  remove(object: unknown): void {
    const index = this.children.indexOf(object);
    if (index !== -1) {
      this.children.splice(index, 1);
    }
  }
}

// Mock Light classes
export class AmbientLight {
  intensity: number;
  constructor(_color?: number, intensity = 1) {
    this.intensity = intensity;
  }
}

export class DirectionalLight {
  intensity: number;
  position: Vector3 = new Vector3();
  constructor(_color?: number, intensity = 1) {
    this.intensity = intensity;
  }
}

// Mock Geometry classes
export class SphereGeometry {
  constructor(_radius?: number, _widthSegments?: number, _heightSegments?: number) {
    // No-op
  }
  dispose(): void {
    // No-op
  }
}

export class BufferGeometry {
  attributes: Record<string, BufferAttribute> = {};

  setAttribute(name: string, attribute: BufferAttribute): void {
    this.attributes[name] = attribute;
  }

  getAttribute(name: string): BufferAttribute | undefined {
    return this.attributes[name];
  }

  dispose(): void {
    // No-op
  }
}

export class BufferAttribute {
  array: Float32Array;
  itemSize: number;
  needsUpdate = false;

  constructor(array: Float32Array, itemSize: number) {
    this.array = array;
    this.itemSize = itemSize;
  }

  setXYZ(index: number, x: number, y: number, z: number): void {
    const offset = index * this.itemSize;
    this.array[offset] = x;
    this.array[offset + 1] = y;
    this.array[offset + 2] = z;
  }
}

// Mock Material classes
export class Material {
  dispose(): void {
    // No-op
  }
}

export class MeshStandardMaterial extends Material {
  color: number;
  emissive: number;
  emissiveIntensity: number;
  roughness: number;
  metalness: number;

  constructor(params?: {
    color?: number;
    emissive?: number;
    emissiveIntensity?: number;
    roughness?: number;
    metalness?: number;
  }) {
    super();
    this.color = params?.color ?? 0xffffff;
    this.emissive = params?.emissive ?? 0x000000;
    this.emissiveIntensity = params?.emissiveIntensity ?? 0;
    this.roughness = params?.roughness ?? 1;
    this.metalness = params?.metalness ?? 0;
  }
}

export class LineBasicMaterial extends Material {
  color: number;
  opacity: number;
  transparent: boolean;

  constructor(params?: { color?: number; opacity?: number; transparent?: boolean }) {
    super();
    this.color = params?.color ?? 0xffffff;
    this.opacity = params?.opacity ?? 1;
    this.transparent = params?.transparent ?? false;
  }
}

export class SpriteMaterial extends Material {
  map: CanvasTexture | null;
  transparent: boolean;

  constructor(params?: { map?: CanvasTexture; transparent?: boolean }) {
    super();
    this.map = params?.map ?? null;
    this.transparent = params?.transparent ?? false;
  }
}

// Mock Mesh and Object3D classes
export class Object3D {
  position: Vector3 = new Vector3();
  scale: Vector3 = new Vector3(1, 1, 1);
  children: unknown[] = [];

  add(object: unknown): void {
    this.children.push(object);
  }

  remove(object: unknown): void {
    const index = this.children.indexOf(object);
    if (index !== -1) {
      this.children.splice(index, 1);
    }
  }
}

export class Mesh extends Object3D {
  geometry: BufferGeometry | SphereGeometry;
  material: Material;

  constructor(geometry: BufferGeometry | SphereGeometry, material: Material) {
    super();
    this.geometry = geometry;
    this.material = material;
  }
}

export class Line extends Object3D {
  geometry: BufferGeometry;
  material: Material;

  constructor(geometry: BufferGeometry, material: Material) {
    super();
    this.geometry = geometry;
    this.material = material;
  }
}

export class Sprite extends Object3D {
  material: SpriteMaterial;

  constructor(material: SpriteMaterial) {
    super();
    this.material = material;
  }
}

// Mock Texture class
export class CanvasTexture {
  needsUpdate = false;
  constructor(_canvas: HTMLCanvasElement) {
    // No-op
  }
}

// Mock Raycaster class
export class Raycaster {
  setFromCamera(_coords: Vector2, _camera: PerspectiveCamera): void {
    // No-op
  }

  intersectObjects(_objects: unknown[], _recursive?: boolean): { point: Vector3; object: unknown }[] {
    return [];
  }
}
