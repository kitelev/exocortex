# Graph View Configuration Reference

Complete reference for all configuration options in 2D and 3D graph visualization modes.

## 3D Scene Configuration

### Scene3DConfig

Main configuration for the 3D scene:

```typescript
interface Scene3DConfig {
  /** Background color (hex number). Default: 0x1a1a2e */
  backgroundColor: number;

  /** Ambient light intensity (0-1). Default: 0.4 */
  ambientLightIntensity: number;

  /** Directional light intensity (0-1). Default: 0.8 */
  directionalLightIntensity: number;

  /** Camera field of view in degrees. Default: 60 */
  cameraFov: number;

  /** Camera near clipping plane. Default: 0.1 */
  cameraNear: number;

  /** Camera far clipping plane. Default: 10000 */
  cameraFar: number;

  /** Enable anti-aliasing. Default: true */
  antialias: boolean;

  /** Device pixel ratio. Default: min(devicePixelRatio, 2) */
  pixelRatio: number;

  /** Initial camera distance from center. Default: 500 */
  cameraDistance: number;

  /** Enable fog for depth perception. Default: true */
  enableFog: boolean;

  /** Fog near distance. Default: 500 */
  fogNear: number;

  /** Fog far distance. Default: 2000 */
  fogFar: number;
}
```

### Default Values

```typescript
const DEFAULT_SCENE_3D_CONFIG = {
  backgroundColor: 0x1a1a2e,
  ambientLightIntensity: 0.4,
  directionalLightIntensity: 0.8,
  cameraFov: 60,
  cameraNear: 0.1,
  cameraFar: 10000,
  antialias: true,
  pixelRatio: Math.min(window.devicePixelRatio, 2),
  cameraDistance: 500,
  enableFog: true,
  fogNear: 500,
  fogFar: 2000
};
```

## Node Style Configuration

### Node3DStyle

Visual appearance of nodes:

```typescript
interface Node3DStyle {
  /** Base radius in world units. Default: 8 */
  radius: number;

  /** Node color (hex number). Default: 0x6366f1 */
  color: number;

  /** Emissive color for glow effect. Default: 0x6366f1 */
  emissive: number;

  /** Emissive intensity. Default: 0.2 */
  emissiveIntensity: number;

  /** Material roughness (0-1). Default: 0.7 */
  roughness: number;

  /** Material metalness (0-1). Default: 0.3 */
  metalness: number;

  /** Sphere segments (detail level). Default: 16 */
  segments: number;
}
```

### Default Values

```typescript
const DEFAULT_NODE_3D_STYLE = {
  radius: 8,
  color: 0x6366f1,
  emissive: 0x6366f1,
  emissiveIntensity: 0.2,
  roughness: 0.7,
  metalness: 0.3,
  segments: 16
};
```

## Edge Style Configuration

### Edge3DStyle

Visual appearance of edges:

```typescript
interface Edge3DStyle {
  /** Line width in pixels. Default: 1 */
  lineWidth: number;

  /** Line color (hex number). Default: 0x64748b */
  color: number;

  /** Line opacity (0-1). Default: 0.6 */
  opacity: number;

  /** Use tube geometry instead of lines. Default: false */
  useTube: boolean;

  /** Tube radius (if using tubes). Default: 0.5 */
  tubeRadius: number;

  /** Tube segments (detail level). Default: 8 */
  tubeSegments: number;
}
```

### Default Values

```typescript
const DEFAULT_EDGE_3D_STYLE = {
  lineWidth: 1,
  color: 0x64748b,
  opacity: 0.6,
  useTube: false,
  tubeRadius: 0.5,
  tubeSegments: 8
};
```

## Label Style Configuration

### Label3DStyle

Visual appearance of labels:

```typescript
interface Label3DStyle {
  /** Font size in pixels. Default: 14 */
  fontSize: number;

  /** Font family. Default: "Inter, system-ui, sans-serif" */
  fontFamily: string;

  /** Text color (CSS color). Default: "#e2e8f0" */
  color: string;

  /** Background color (CSS color or null). Default: "rgba(26, 26, 46, 0.8)" */
  backgroundColor: string | null;

  /** Padding around text. Default: 4 */
  padding: number;

  /** Billboard behavior - always face camera. Default: true */
  billboard: boolean;

  /** Scale factor for sprite size. Default: 1 */
  scale: number;

  /** Y offset from node center. Default: 12 */
  yOffset: number;
}
```

### Default Values

```typescript
const DEFAULT_LABEL_3D_STYLE = {
  fontSize: 14,
  fontFamily: "Inter, system-ui, sans-serif",
  color: "#e2e8f0",
  backgroundColor: "rgba(26, 26, 46, 0.8)",
  padding: 4,
  billboard: true,
  scale: 1,
  yOffset: 12
};
```

## Orbit Controls Configuration

### OrbitControlsConfig

Camera orbit controls settings:

```typescript
interface OrbitControlsConfig {
  /** Enable orbit rotation. Default: true */
  enableRotate: boolean;

  /** Enable zoom. Default: true */
  enableZoom: boolean;

  /** Enable panning. Default: true */
  enablePan: boolean;

  /** Enable damping (inertia). Default: true */
  enableDamping: boolean;

  /** Damping factor. Default: 0.05 */
  dampingFactor: number;

  /** Rotation speed multiplier. Default: 1.0 */
  rotateSpeed: number;

  /** Zoom speed multiplier. Default: 1.0 */
  zoomSpeed: number;

  /** Pan speed multiplier. Default: 1.0 */
  panSpeed: number;

  /** Minimum zoom distance. Default: 10 */
  minDistance: number;

  /** Maximum zoom distance. Default: 5000 */
  maxDistance: number;

  /** Minimum polar angle (vertical rotation limit). Default: 0 */
  minPolarAngle: number;

  /** Maximum polar angle (vertical rotation limit). Default: Math.PI */
  maxPolarAngle: number;

  /** Auto-rotate the scene. Default: false */
  autoRotate: boolean;

  /** Auto-rotate speed. Default: 2.0 */
  autoRotateSpeed: number;
}
```

### Default Values

```typescript
const DEFAULT_ORBIT_CONTROLS_CONFIG = {
  enableRotate: true,
  enableZoom: true,
  enablePan: true,
  enableDamping: true,
  dampingFactor: 0.05,
  rotateSpeed: 1.0,
  zoomSpeed: 1.0,
  panSpeed: 1.0,
  minDistance: 10,
  maxDistance: 5000,
  minPolarAngle: 0,
  maxPolarAngle: Math.PI,
  autoRotate: false,
  autoRotateSpeed: 2.0
};
```

## Force Simulation Configuration

### ForceSimulation3DConfig

Force-directed layout settings:

```typescript
interface ForceSimulation3DConfig {
  /** Repulsion strength between nodes. Default: -300 */
  chargeStrength: number;

  /** Target distance between linked nodes. Default: 100 */
  linkDistance: number;

  /** Center attraction strength. Default: 0.1 */
  centerStrength: number;

  /** Collision detection radius multiplier. Default: 1.5 */
  collisionRadius: number;

  /** Simulation alpha (energy level). Default: 1 */
  alpha: number;

  /** Target alpha for convergence. Default: 0 */
  alphaTarget: number;

  /** Alpha decay rate per tick. Default: 0.0228 */
  alphaDecay: number;

  /** Velocity decay (damping) per tick. Default: 0.4 */
  velocityDecay: number;

  /** Minimum alpha before stopping. Default: 0.01 */
  alphaMin: number;

  /** Use Barnes-Hut optimization. Default: true */
  useBarnesHut: boolean;

  /** Barnes-Hut theta parameter. Default: 0.9 */
  theta: number;
}
```

### Default Values

```typescript
const DEFAULT_FORCE_SIMULATION_3D_CONFIG = {
  chargeStrength: -300,
  linkDistance: 100,
  centerStrength: 0.1,
  collisionRadius: 1.5,
  alpha: 1,
  alphaTarget: 0,
  alphaDecay: 0.0228,
  velocityDecay: 0.4,
  alphaMin: 0.01,
  useBarnesHut: true,
  theta: 0.9
};
```

## Performance Configuration

### LODConfig

Level of Detail settings:

```typescript
interface LODConfig {
  /** Enable LOD system. Default: true */
  enabled: boolean;

  /** Distance at which labels start fading. Default: 150 */
  labelFadeStart: number;

  /** Distance at which labels are fully hidden. Default: 250 */
  labelFadeEnd: number;

  /** Minimum opacity for labels during fade (0-1). Default: 0 */
  labelMinOpacity: number;

  /** Distance at which node detail reduces. Default: 200 */
  nodeDetailFadeStart: number;

  /** Distance at which nodes use minimum detail. Default: 400 */
  nodeDetailFadeEnd: number;
}
```

### FrustumCullingConfig

Frustum culling settings:

```typescript
interface FrustumCullingConfig {
  /** Enable frustum culling. Default: true */
  enabled: boolean;

  /** Padding around frustum for culling. Default: 50 */
  padding: number;

  /** Update culling every N frames. Default: 2 */
  updateInterval: number;
}
```

### WebGLRecoveryConfig

WebGL context recovery settings:

```typescript
interface WebGLRecoveryConfig {
  /** Enable automatic context recovery. Default: true */
  enabled: boolean;

  /** Maximum recovery attempts. Default: 3 */
  maxAttempts: number;

  /** Delay between recovery attempts (ms). Default: 1000 */
  retryDelay: number;

  /** Show recovery UI message. Default: true */
  showRecoveryMessage: boolean;
}
```

### Default Performance Values

```typescript
const DEFAULT_LOD_CONFIG = {
  enabled: true,
  labelFadeStart: 150,
  labelFadeEnd: 250,
  labelMinOpacity: 0,
  nodeDetailFadeStart: 200,
  nodeDetailFadeEnd: 400
};

const DEFAULT_FRUSTUM_CULLING_CONFIG = {
  enabled: true,
  padding: 50,
  updateInterval: 2
};

const DEFAULT_WEBGL_RECOVERY_CONFIG = {
  enabled: true,
  maxAttempts: 3,
  retryDelay: 1000,
  showRecoveryMessage: true
};
```

## Theme Configuration

### ThemeColors

Color configuration for a theme:

```typescript
interface ThemeColors {
  /** Scene background color (hex) */
  background: string;

  /** Node colors by ontology namespace */
  nodeColors: Record<OntologyNamespace, string>;

  /** Edge colors by predicate type */
  edgeColors: {
    rdfType: string;
    subClassOf: string;
    sameAs: string;
    default: string;
  };

  /** Label text color */
  labelColor: string;

  /** Label background color */
  labelBackground: string;

  /** Fog color */
  fogColor: string;
}
```

### Default Theme Configuration

```typescript
const DEFAULT_THEME_CONFIG = {
  dark: {
    background: "#1E1E1E",
    nodeColors: {
      exo: "#4A90E2",
      ems: "#7ED321",
      ims: "#9B59B6",
      rdf: "#F5A623",
      rdfs: "#E67E22",
      owl: "#E74C3C",
      xsd: "#1ABC9C",
      unknown: "#95A5A6"
    },
    edgeColors: {
      rdfType: "#F5A623",
      subClassOf: "#9B59B6",
      sameAs: "#3498DB",
      default: "#64748B"
    },
    labelColor: "#E2E8F0",
    labelBackground: "rgba(30, 30, 30, 0.85)",
    fogColor: "#1E1E1E"
  },
  light: {
    background: "#F5F5F5",
    nodeColors: {
      exo: "#2563EB",
      ems: "#16A34A",
      ims: "#7C3AED",
      rdf: "#D97706",
      rdfs: "#C2410C",
      owl: "#DC2626",
      xsd: "#0D9488",
      unknown: "#6B7280"
    },
    edgeColors: {
      rdfType: "#D97706",
      subClassOf: "#7C3AED",
      sameAs: "#2563EB",
      default: "#475569"
    },
    labelColor: "#1E293B",
    labelBackground: "rgba(245, 245, 245, 0.85)",
    fogColor: "#F5F5F5"
  }
};
```

## Touch Gesture Configuration

### TouchGestureConfig

Touch gesture settings for mobile devices:

```typescript
interface TouchGestureConfig {
  /** Enable tap gesture. Default: true */
  enableTap: boolean;

  /** Enable double-tap gesture. Default: true */
  enableDoubleTap: boolean;

  /** Enable long press gesture. Default: true */
  enableLongPress: boolean;

  /** Maximum movement for tap detection (pixels). Default: 10 */
  tapMaxMovement: number;

  /** Maximum duration for tap detection (ms). Default: 300 */
  tapMaxDuration: number;

  /** Maximum interval between double-taps (ms). Default: 300 */
  doubleTapMaxInterval: number;

  /** Duration for long press detection (ms). Default: 500 */
  longPressDuration: number;
}
```

### Default Values

```typescript
const DEFAULT_TOUCH_GESTURE_CONFIG = {
  enableTap: true,
  enableDoubleTap: true,
  enableLongPress: true,
  tapMaxMovement: 10,
  tapMaxDuration: 300,
  doubleTapMaxInterval: 300,
  longPressDuration: 500
};
```

## Configuration Examples

### High Performance Mode

Optimized for large graphs (1000+ nodes):

```typescript
const highPerformanceConfig = {
  config: {
    antialias: false,
    pixelRatio: 1,
    enableFog: false
  },
  nodeStyle: {
    segments: 8  // Lower detail spheres
  },
  performanceConfig: {
    lod: {
      enabled: true,
      labelFadeStart: 100,
      labelFadeEnd: 150
    },
    frustumCulling: {
      enabled: true,
      updateInterval: 1
    }
  }
};
```

### High Quality Mode

Maximum visual quality:

```typescript
const highQualityConfig = {
  config: {
    antialias: true,
    pixelRatio: 2,
    enableFog: true
  },
  nodeStyle: {
    segments: 32,
    emissiveIntensity: 0.3
  },
  edgeStyle: {
    useTube: true,
    tubeRadius: 0.8
  },
  performanceConfig: {
    lod: { enabled: false },
    frustumCulling: { enabled: false }
  }
};
```

### Mobile-Optimized Mode

Optimized for touch devices:

```typescript
const mobileConfig = {
  config: {
    antialias: false,
    pixelRatio: 1
  },
  controlsConfig: {
    rotateSpeed: 0.5,
    panSpeed: 0.5,
    zoomSpeed: 0.5
  },
  performanceConfig: {
    lod: { enabled: true },
    frustumCulling: { enabled: true }
  },
  touchGestureConfig: {
    longPressDuration: 400  // Faster long press
  }
};
```

### Custom Theme Mode

Custom color scheme:

```typescript
const customThemeConfig = {
  themeConfig: {
    dark: {
      background: "#0a0a0a",
      nodeColors: {
        exo: "#ff6b6b",
        ems: "#4ecdc4",
        ims: "#45b7d1",
        rdf: "#f9ca24",
        rdfs: "#f0932b",
        owl: "#eb4d4b",
        xsd: "#6ab04c",
        unknown: "#535c68"
      }
    }
  }
};
```
