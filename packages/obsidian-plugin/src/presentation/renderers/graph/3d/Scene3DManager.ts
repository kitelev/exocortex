/**
 * Scene3DManager - High-performance 3D graph rendering with Three.js and WebGL2
 *
 * Provides GPU-accelerated 3D rendering for graph visualization with:
 * - WebGL2 backend for optimal performance
 * - Layered group hierarchy (edges → nodes → labels)
 * - OrbitControls for camera manipulation (orbit, pan, zoom)
 * - Raycasting for node/edge interaction
 * - ResizeObserver integration for responsive sizing
 *
 * @module presentation/renderers/graph/3d
 * @since 1.0.0
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type {
  Scene3DConfig,
  GraphNode3D,
  GraphEdge3D,
  Node3DStyle,
  Edge3DStyle,
  Label3DStyle,
  OrbitControlsConfig,
  Viewport3DState,
  Renderer3DStats,
  Scene3DEventType,
  Scene3DEvent,
  Scene3DEventListener,
  Point3D,
} from "./types3d";
import {
  DEFAULT_SCENE_3D_CONFIG,
  DEFAULT_NODE_3D_STYLE,
  DEFAULT_EDGE_3D_STYLE,
  DEFAULT_LABEL_3D_STYLE,
  DEFAULT_ORBIT_CONTROLS_CONFIG,
} from "./types3d";

/**
 * Internal representation of a rendered node
 */
interface RenderedNode3D {
  mesh: THREE.Mesh;
  labelSprite: THREE.Sprite | null;
  node: GraphNode3D;
}

/**
 * Internal representation of a rendered edge
 */
interface RenderedEdge3D {
  line: THREE.Line | THREE.Mesh;
  edge: GraphEdge3D;
}

/**
 * Scene3DManager - GPU-accelerated 3D graph rendering using Three.js
 *
 * @example
 * ```typescript
 * const manager = new Scene3DManager();
 * manager.initialize(containerElement);
 *
 * // Update graph data
 * manager.setNodes(nodes);
 * manager.setEdges(edges);
 *
 * // Listen for events
 * manager.on('nodeClick', (event) => {
 *   console.log('Clicked node:', event.node);
 * });
 *
 * // Cleanup
 * manager.destroy();
 * ```
 */
export class Scene3DManager {
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private controls: OrbitControls | null = null;

  private nodeGroup: THREE.Group | null = null;
  private edgeGroup: THREE.Group | null = null;
  private labelGroup: THREE.Group | null = null;

  private config: Scene3DConfig;
  private nodeStyle: Node3DStyle;
  private edgeStyle: Edge3DStyle;
  private labelStyle: Label3DStyle;
  private controlsConfig: OrbitControlsConfig;

  private renderedNodes: Map<string, RenderedNode3D> = new Map();
  private renderedEdges: Map<string, RenderedEdge3D> = new Map();

  private container: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private animationFrameId: number | null = null;

  private raycaster: THREE.Raycaster = new THREE.Raycaster();
  private pointer: THREE.Vector2 = new THREE.Vector2();
  private hoveredNode: GraphNode3D | null = null;
  private eventListeners: Map<Scene3DEventType, Set<Scene3DEventListener>> = new Map();

  private initialized = false;

  // Shared geometries and materials for instancing
  private sphereGeometry: THREE.SphereGeometry | null = null;
  private nodeMaterial: THREE.MeshStandardMaterial | null = null;

  constructor(
    config: Partial<Scene3DConfig> = {},
    nodeStyle: Partial<Node3DStyle> = {},
    edgeStyle: Partial<Edge3DStyle> = {},
    labelStyle: Partial<Label3DStyle> = {},
    controlsConfig: Partial<OrbitControlsConfig> = {}
  ) {
    this.config = { ...DEFAULT_SCENE_3D_CONFIG, ...config };
    this.nodeStyle = { ...DEFAULT_NODE_3D_STYLE, ...nodeStyle };
    this.edgeStyle = { ...DEFAULT_EDGE_3D_STYLE, ...edgeStyle };
    this.labelStyle = { ...DEFAULT_LABEL_3D_STYLE, ...labelStyle };
    this.controlsConfig = { ...DEFAULT_ORBIT_CONTROLS_CONFIG, ...controlsConfig };

    // Initialize event listener maps
    const eventTypes: Scene3DEventType[] = [
      "nodeClick",
      "nodeHover",
      "nodeHoverEnd",
      "edgeClick",
      "edgeHover",
      "edgeHoverEnd",
      "backgroundClick",
      "cameraChange",
      "render",
    ];
    for (const type of eventTypes) {
      this.eventListeners.set(type, new Set());
    }
  }

  /**
   * Initialize the Three.js scene and renderer
   *
   * @param container - The HTML element to render into
   */
  initialize(container: HTMLElement): void {
    if (this.initialized) {
      throw new Error("Scene3DManager is already initialized");
    }

    this.container = container;

    // Create scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.config.backgroundColor);

    // Add fog for depth perception
    if (this.config.enableFog) {
      this.scene.fog = new THREE.Fog(
        this.config.backgroundColor,
        this.config.fogNear,
        this.config.fogFar
      );
    }

    // Create camera
    const aspect = container.clientWidth / container.clientHeight || 1;
    this.camera = new THREE.PerspectiveCamera(
      this.config.cameraFov,
      aspect,
      this.config.cameraNear,
      this.config.cameraFar
    );
    this.camera.position.set(0, 0, this.config.cameraDistance);
    this.camera.lookAt(0, 0, 0);

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: this.config.antialias,
      powerPreference: "high-performance",
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(this.config.pixelRatio);
    container.appendChild(this.renderer.domElement);

    // Create orbit controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.applyControlsConfig();
    this.controls.addEventListener("change", () => {
      this.emit("cameraChange", {
        type: "cameraChange",
        worldPosition: {
          x: this.camera!.position.x,
          y: this.camera!.position.y,
          z: this.camera!.position.z,
        },
      });
    });

    // Add lights
    this.setupLights();

    // Create groups for layered rendering
    this.edgeGroup = new THREE.Group();
    this.nodeGroup = new THREE.Group();
    this.labelGroup = new THREE.Group();
    this.scene.add(this.edgeGroup);
    this.scene.add(this.nodeGroup);
    this.scene.add(this.labelGroup);

    // Create shared geometry and materials
    this.sphereGeometry = new THREE.SphereGeometry(
      1, // Unit radius, scaled per node
      this.nodeStyle.segments,
      this.nodeStyle.segments
    );
    this.nodeMaterial = new THREE.MeshStandardMaterial({
      color: this.nodeStyle.color,
      emissive: this.nodeStyle.emissive,
      emissiveIntensity: this.nodeStyle.emissiveIntensity,
      roughness: this.nodeStyle.roughness,
      metalness: this.nodeStyle.metalness,
    });

    // Setup event handlers
    this.setupEventHandlers();

    // Setup resize observer
    this.setupResizeObserver();

    // Start render loop
    this.startRenderLoop();

    this.initialized = true;
  }

  /**
   * Setup lighting for the scene
   */
  private setupLights(): void {
    if (!this.scene) return;

    // Ambient light for base illumination
    const ambientLight = new THREE.AmbientLight(
      0xffffff,
      this.config.ambientLightIntensity
    );
    this.scene.add(ambientLight);

    // Directional light for shadows and depth
    const directionalLight = new THREE.DirectionalLight(
      0xffffff,
      this.config.directionalLightIntensity
    );
    directionalLight.position.set(1, 1, 1).normalize();
    this.scene.add(directionalLight);

    // Secondary light from opposite direction
    const directionalLight2 = new THREE.DirectionalLight(
      0xffffff,
      this.config.directionalLightIntensity * 0.5
    );
    directionalLight2.position.set(-1, -0.5, -1).normalize();
    this.scene.add(directionalLight2);
  }

  /**
   * Apply orbit controls configuration
   */
  private applyControlsConfig(): void {
    if (!this.controls) return;

    this.controls.enableRotate = this.controlsConfig.enableRotate;
    this.controls.enableZoom = this.controlsConfig.enableZoom;
    this.controls.enablePan = this.controlsConfig.enablePan;
    this.controls.enableDamping = this.controlsConfig.enableDamping;
    this.controls.dampingFactor = this.controlsConfig.dampingFactor;
    this.controls.rotateSpeed = this.controlsConfig.rotateSpeed;
    this.controls.zoomSpeed = this.controlsConfig.zoomSpeed;
    this.controls.panSpeed = this.controlsConfig.panSpeed;
    this.controls.minDistance = this.controlsConfig.minDistance;
    this.controls.maxDistance = this.controlsConfig.maxDistance;
    this.controls.minPolarAngle = this.controlsConfig.minPolarAngle;
    this.controls.maxPolarAngle = this.controlsConfig.maxPolarAngle;
    this.controls.autoRotate = this.controlsConfig.autoRotate;
    this.controls.autoRotateSpeed = this.controlsConfig.autoRotateSpeed;
  }

  /**
   * Setup event handlers for mouse interactions
   */
  private setupEventHandlers(): void {
    if (!this.renderer) return;

    const canvas = this.renderer.domElement;

    canvas.addEventListener("mousemove", this.handleMouseMove.bind(this));
    canvas.addEventListener("click", this.handleClick.bind(this));
  }

  /**
   * Handle mouse move for hover detection
   */
  private handleMouseMove(event: MouseEvent): void {
    if (!this.renderer || !this.camera || !this.nodeGroup) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersects = this.raycaster.intersectObjects(this.nodeGroup.children, false);

    if (intersects.length > 0) {
      const mesh = intersects[0].object as THREE.Mesh;
      const nodeEntry = [...this.renderedNodes.values()].find(
        (entry) => entry.mesh === mesh
      );

      if (nodeEntry && nodeEntry.node !== this.hoveredNode) {
        // End previous hover
        if (this.hoveredNode) {
          this.emit("nodeHoverEnd", {
            type: "nodeHoverEnd",
            node: this.hoveredNode,
          });
        }

        // Start new hover
        this.hoveredNode = nodeEntry.node;
        this.emit("nodeHover", {
          type: "nodeHover",
          node: nodeEntry.node,
          worldPosition: {
            x: intersects[0].point.x,
            y: intersects[0].point.y,
            z: intersects[0].point.z,
          },
          screenPosition: { x: event.clientX, y: event.clientY },
          originalEvent: event,
        });
      }
    } else if (this.hoveredNode) {
      this.emit("nodeHoverEnd", {
        type: "nodeHoverEnd",
        node: this.hoveredNode,
      });
      this.hoveredNode = null;
    }
  }

  /**
   * Handle click for node selection
   */
  private handleClick(event: MouseEvent): void {
    if (!this.renderer || !this.camera || !this.nodeGroup) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersects = this.raycaster.intersectObjects(this.nodeGroup.children, false);

    if (intersects.length > 0) {
      const mesh = intersects[0].object as THREE.Mesh;
      const nodeEntry = [...this.renderedNodes.values()].find(
        (entry) => entry.mesh === mesh
      );

      if (nodeEntry) {
        this.emit("nodeClick", {
          type: "nodeClick",
          node: nodeEntry.node,
          worldPosition: {
            x: intersects[0].point.x,
            y: intersects[0].point.y,
            z: intersects[0].point.z,
          },
          screenPosition: { x: event.clientX, y: event.clientY },
          originalEvent: event,
        });
      }
    } else {
      this.emit("backgroundClick", {
        type: "backgroundClick",
        originalEvent: event,
      });
    }
  }

  /**
   * Setup resize observer for responsive sizing
   */
  private setupResizeObserver(): void {
    if (!this.container || typeof ResizeObserver === "undefined") return;

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        this.resize(width, height);
      }
    });

    this.resizeObserver.observe(this.container);
  }

  /**
   * Start the render loop
   */
  private startRenderLoop(): void {
    const animate = (): void => {
      this.animationFrameId = requestAnimationFrame(animate);

      if (this.controls && this.controlsConfig.enableDamping) {
        this.controls.update();
      }

      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
        this.emit("render", { type: "render" });
      }
    };

    animate();
  }

  /**
   * Resize the renderer to new dimensions
   */
  resize(width: number, height: number): void {
    if (!this.camera || !this.renderer) return;

    this.camera.aspect = width / height || 1;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  /**
   * Get current canvas dimensions
   */
  getSize(): { width: number; height: number } {
    if (!this.renderer) {
      return { width: 0, height: 0 };
    }
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    return { width: size.x, height: size.y };
  }

  /**
   * Set and render nodes
   */
  setNodes(nodes: GraphNode3D[]): void {
    if (!this.nodeGroup || !this.sphereGeometry) return;

    const currentNodeIds = new Set(nodes.map((n) => n.id));

    // Remove nodes that no longer exist
    for (const [id, rendered] of this.renderedNodes) {
      if (!currentNodeIds.has(id)) {
        this.nodeGroup.remove(rendered.mesh);
        rendered.mesh.geometry.dispose();
        if (rendered.mesh.material instanceof THREE.Material) {
          rendered.mesh.material.dispose();
        }
        if (rendered.labelSprite && this.labelGroup) {
          this.labelGroup.remove(rendered.labelSprite);
          if (rendered.labelSprite.material instanceof THREE.Material) {
            rendered.labelSprite.material.dispose();
          }
        }
        this.renderedNodes.delete(id);
      }
    }

    // Add or update nodes
    for (const node of nodes) {
      let rendered = this.renderedNodes.get(node.id);

      if (!rendered) {
        // Create new node mesh
        const color = node.color
          ? parseInt(node.color.replace("#", ""), 16)
          : this.nodeStyle.color;

        const material = new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: this.nodeStyle.emissiveIntensity,
          roughness: this.nodeStyle.roughness,
          metalness: this.nodeStyle.metalness,
        });

        const mesh = new THREE.Mesh(this.sphereGeometry, material);
        const radius = (node.size ?? 1) * this.nodeStyle.radius;
        mesh.scale.setScalar(radius);

        this.nodeGroup.add(mesh);

        // Create label sprite
        let labelSprite: THREE.Sprite | null = null;
        if (this.labelGroup) {
          labelSprite = this.createLabelSprite(node.label);
          this.labelGroup.add(labelSprite);
        }

        rendered = { mesh, labelSprite, node };
        this.renderedNodes.set(node.id, rendered);
      } else {
        rendered.node = node;
      }

      // Update position
      this.updateNodePosition(rendered, node);
    }
  }

  /**
   * Update a single node's position
   */
  private updateNodePosition(rendered: RenderedNode3D, node: GraphNode3D): void {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const z = node.z ?? 0;

    rendered.mesh.position.set(x, y, z);

    if (rendered.labelSprite) {
      const radius = (node.size ?? 1) * this.nodeStyle.radius;
      rendered.labelSprite.position.set(x, y + radius + this.labelStyle.yOffset, z);
    }
  }

  /**
   * Create a sprite for a label
   */
  private createLabelSprite(text: string): THREE.Sprite {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;

    const fontSize = this.labelStyle.fontSize * 2; // Higher res for crisp text
    context.font = `${fontSize}px ${this.labelStyle.fontFamily}`;
    const textWidth = context.measureText(text).width;

    const padding = this.labelStyle.padding * 2;
    canvas.width = textWidth + padding * 2;
    canvas.height = fontSize + padding * 2;

    // Draw background
    if (this.labelStyle.backgroundColor) {
      context.fillStyle = this.labelStyle.backgroundColor;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Draw text
    context.font = `${fontSize}px ${this.labelStyle.fontFamily}`;
    context.fillStyle = this.labelStyle.color;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
    });

    const sprite = new THREE.Sprite(spriteMaterial);
    const scale = this.labelStyle.scale * 0.5;
    sprite.scale.set((canvas.width / canvas.height) * scale * 10, scale * 10, 1);

    return sprite;
  }

  /**
   * Set and render edges
   */
  setEdges(edges: GraphEdge3D[], nodes: GraphNode3D[]): void {
    if (!this.edgeGroup) return;

    // Create node position lookup
    const nodePositions = new Map<string, Point3D>();
    for (const node of nodes) {
      nodePositions.set(node.id, {
        x: node.x ?? 0,
        y: node.y ?? 0,
        z: node.z ?? 0,
      });
    }

    const currentEdgeIds = new Set(edges.map((e) => e.id));

    // Remove edges that no longer exist
    for (const [id, rendered] of this.renderedEdges) {
      if (!currentEdgeIds.has(id)) {
        this.edgeGroup.remove(rendered.line);
        rendered.line.geometry.dispose();
        if (rendered.line.material instanceof THREE.Material) {
          rendered.line.material.dispose();
        }
        this.renderedEdges.delete(id);
      }
    }

    // Add or update edges
    for (const edge of edges) {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;

      const sourcePos = nodePositions.get(sourceId);
      const targetPos = nodePositions.get(targetId);

      if (!sourcePos || !targetPos) continue;

      let rendered = this.renderedEdges.get(edge.id);

      if (!rendered) {
        // Create new edge line
        const color = edge.color
          ? parseInt(edge.color.replace("#", ""), 16)
          : this.edgeStyle.color;

        const material = new THREE.LineBasicMaterial({
          color,
          opacity: this.edgeStyle.opacity,
          transparent: true,
        });

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array([
          sourcePos.x,
          sourcePos.y,
          sourcePos.z,
          targetPos.x,
          targetPos.y,
          targetPos.z,
        ]);
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

        const line = new THREE.Line(geometry, material);
        this.edgeGroup.add(line);

        rendered = { line, edge };
        this.renderedEdges.set(edge.id, rendered);
      } else {
        // Update existing edge position
        rendered.edge = edge;
        this.updateEdgePosition(rendered, sourcePos, targetPos);
      }
    }
  }

  /**
   * Update edge line positions
   */
  private updateEdgePosition(
    rendered: RenderedEdge3D,
    sourcePos: Point3D,
    targetPos: Point3D
  ): void {
    const geometry = rendered.line.geometry as THREE.BufferGeometry;
    const positions = geometry.getAttribute("position");

    if (positions) {
      positions.setXYZ(0, sourcePos.x, sourcePos.y, sourcePos.z);
      positions.setXYZ(1, targetPos.x, targetPos.y, targetPos.z);
      positions.needsUpdate = true;
    }
  }

  /**
   * Update all node and edge positions (call after force simulation tick)
   */
  updatePositions(nodes: GraphNode3D[], edges?: GraphEdge3D[]): void {
    // Update node positions
    for (const node of nodes) {
      const rendered = this.renderedNodes.get(node.id);
      if (rendered) {
        this.updateNodePosition(rendered, node);
      }
    }

    // Update edge positions
    if (edges) {
      const nodePositions = new Map<string, Point3D>();
      for (const node of nodes) {
        nodePositions.set(node.id, {
          x: node.x ?? 0,
          y: node.y ?? 0,
          z: node.z ?? 0,
        });
      }

      for (const edge of edges) {
        const rendered = this.renderedEdges.get(edge.id);
        if (rendered) {
          const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
          const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;
          const sourcePos = nodePositions.get(sourceId);
          const targetPos = nodePositions.get(targetId);

          if (sourcePos && targetPos) {
            this.updateEdgePosition(rendered, sourcePos, targetPos);
          }
        }
      }
    }
  }

  /**
   * Set label visibility
   */
  setLabelsVisible(visible: boolean): void {
    if (this.labelGroup) {
      this.labelGroup.visible = visible;
    }
  }

  /**
   * Get current viewport state
   */
  getViewport(): Viewport3DState {
    if (!this.camera || !this.controls) {
      return {
        cameraPosition: { x: 0, y: 0, z: this.config.cameraDistance },
        cameraTarget: { x: 0, y: 0, z: 0 },
        cameraUp: { x: 0, y: 1, z: 0 },
        zoom: 1,
      };
    }

    const target = this.controls.target;
    return {
      cameraPosition: {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z,
      },
      cameraTarget: {
        x: target.x,
        y: target.y,
        z: target.z,
      },
      cameraUp: {
        x: this.camera.up.x,
        y: this.camera.up.y,
        z: this.camera.up.z,
      },
      zoom: this.camera.zoom,
    };
  }

  /**
   * Set camera position
   */
  setCameraPosition(position: Point3D, target?: Point3D): void {
    if (!this.camera || !this.controls) return;

    this.camera.position.set(position.x, position.y, position.z);

    if (target) {
      this.controls.target.set(target.x, target.y, target.z);
    }

    this.controls.update();
  }

  /**
   * Reset camera to default position with smooth animation
   *
   * @param duration - Animation duration in milliseconds (default: 500)
   */
  resetCamera(duration: number = 500): void {
    if (!this.camera || !this.controls) return;

    const startPosition = {
      x: this.camera.position.x,
      y: this.camera.position.y,
      z: this.camera.position.z,
    };
    const startTarget = {
      x: this.controls.target.x,
      y: this.controls.target.y,
      z: this.controls.target.z,
    };

    const endPosition = { x: 0, y: 0, z: this.config.cameraDistance };
    const endTarget = { x: 0, y: 0, z: 0 };

    const startTime = performance.now();

    const animate = (): void => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-out cubic for smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 3);

      if (this.camera && this.controls) {
        this.camera.position.set(
          startPosition.x + (endPosition.x - startPosition.x) * eased,
          startPosition.y + (endPosition.y - startPosition.y) * eased,
          startPosition.z + (endPosition.z - startPosition.z) * eased
        );
        this.controls.target.set(
          startTarget.x + (endTarget.x - startTarget.x) * eased,
          startTarget.y + (endTarget.y - startTarget.y) * eased,
          startTarget.z + (endTarget.z - startTarget.z) * eased
        );
        this.controls.update();

        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      }
    };

    requestAnimationFrame(animate);
  }

  /**
   * Set auto-rotate mode
   *
   * @param enabled - Whether to enable auto-rotation
   * @param speed - Rotation speed (default: 2.0 degrees per frame)
   */
  setAutoRotate(enabled: boolean, speed?: number): void {
    if (!this.controls) return;

    this.controls.autoRotate = enabled;
    if (speed !== undefined) {
      this.controls.autoRotateSpeed = speed;
    }
  }

  /**
   * Get current auto-rotate state
   */
  getAutoRotate(): boolean {
    return this.controls?.autoRotate ?? false;
  }

  /**
   * Get current labels visibility state
   */
  getLabelsVisible(): boolean {
    return this.labelGroup?.visible ?? true;
  }

  /**
   * Fit all nodes in view
   */
  fitToView(nodes: GraphNode3D[], padding: number = 1.5): void {
    if (!this.camera || !this.controls || nodes.length === 0) return;

    // Calculate bounding sphere
    let sumX = 0,
      sumY = 0,
      sumZ = 0;
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;

    for (const node of nodes) {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const z = node.z ?? 0;

      sumX += x;
      sumY += y;
      sumZ += z;

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }

    const center = {
      x: sumX / nodes.length,
      y: sumY / nodes.length,
      z: sumZ / nodes.length,
    };

    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    const distance = (size * padding) / Math.tan((this.config.cameraFov * Math.PI) / 360);

    this.controls.target.set(center.x, center.y, center.z);
    this.camera.position.set(center.x, center.y, center.z + distance);
    this.controls.update();
  }

  /**
   * Find node at screen position
   */
  findNodeAtPosition(screenX: number, screenY: number): GraphNode3D | undefined {
    if (!this.renderer || !this.camera || !this.nodeGroup) return undefined;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((screenX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((screenY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersects = this.raycaster.intersectObjects(this.nodeGroup.children, false);

    if (intersects.length > 0) {
      const mesh = intersects[0].object as THREE.Mesh;
      const nodeEntry = [...this.renderedNodes.values()].find(
        (entry) => entry.mesh === mesh
      );
      return nodeEntry?.node;
    }

    return undefined;
  }

  /**
   * Add event listener
   */
  on(eventType: Scene3DEventType, listener: Scene3DEventListener): void {
    this.eventListeners.get(eventType)?.add(listener);
  }

  /**
   * Remove event listener
   */
  off(eventType: Scene3DEventType, listener: Scene3DEventListener): void {
    this.eventListeners.get(eventType)?.delete(listener);
  }

  /**
   * Emit event to listeners
   */
  private emit(eventType: Scene3DEventType, event: Scene3DEvent): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error(`Error in Scene3DManager event listener:`, error);
        }
      }
    }
  }

  /**
   * Get renderer statistics
   */
  getStats(): Renderer3DStats {
    const info = this.renderer?.info;
    return {
      nodeCount: this.renderedNodes.size,
      edgeCount: this.renderedEdges.size,
      labelCount: this.labelGroup?.children.length ?? 0,
      fps: 60, // Would need frame timing to calculate actual FPS
      drawCalls: info?.render?.calls ?? 0,
      triangles: info?.render?.triangles ?? 0,
      memoryUsage: (info?.memory?.geometries ?? 0) * 1024 + (info?.memory?.textures ?? 0) * 1024,
    };
  }

  /**
   * Check if the manager is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Update scene background color
   *
   * @param color - Background color as hex number
   */
  setBackgroundColor(color: number): void {
    if (this.scene) {
      this.scene.background = new THREE.Color(color);
    }
  }

  /**
   * Update fog color
   *
   * @param color - Fog color as hex number
   */
  setFogColor(color: number): void {
    if (this.scene && this.scene.fog) {
      (this.scene.fog as THREE.Fog).color.setHex(color);
    }
  }

  /**
   * Update a node's color
   *
   * @param nodeId - ID of the node to update
   * @param color - New color as hex number
   */
  updateNodeColor(nodeId: string, color: number): void {
    const rendered = this.renderedNodes.get(nodeId);
    if (rendered && rendered.mesh.material instanceof THREE.MeshStandardMaterial) {
      rendered.mesh.material.color.setHex(color);
      rendered.mesh.material.emissive.setHex(color);
    }
  }

  /**
   * Update all node colors using a color function
   *
   * @param colorFn - Function that takes node and returns hex color number
   */
  updateAllNodeColors(colorFn: (node: GraphNode3D) => number): void {
    for (const [, rendered] of this.renderedNodes) {
      const color = colorFn(rendered.node);
      if (rendered.mesh.material instanceof THREE.MeshStandardMaterial) {
        rendered.mesh.material.color.setHex(color);
        rendered.mesh.material.emissive.setHex(color);
      }
    }
  }

  /**
   * Update an edge's color
   *
   * @param edgeId - ID of the edge to update
   * @param color - New color as hex number
   */
  updateEdgeColor(edgeId: string, color: number): void {
    const rendered = this.renderedEdges.get(edgeId);
    if (rendered && rendered.line.material instanceof THREE.LineBasicMaterial) {
      rendered.line.material.color.setHex(color);
    }
  }

  /**
   * Update all edge colors using a color function
   *
   * @param colorFn - Function that takes edge and returns hex color number
   */
  updateAllEdgeColors(colorFn: (edge: GraphEdge3D) => number): void {
    for (const [, rendered] of this.renderedEdges) {
      const color = colorFn(rendered.edge);
      if (rendered.line.material instanceof THREE.LineBasicMaterial) {
        rendered.line.material.color.setHex(color);
      }
    }
  }

  /**
   * Update label style (text color and background)
   *
   * @param color - Text color as CSS color string
   * @param backgroundColor - Background color as CSS color string or null
   */
  setLabelStyle(color: string, backgroundColor: string | null): void {
    this.labelStyle = { ...this.labelStyle, color, backgroundColor };
    // Note: Existing labels won't be updated. This affects only new labels.
    // To update existing labels, nodes would need to be re-rendered.
  }

  /**
   * Clear all nodes and edges
   */
  clear(): void {
    // Clear nodes
    for (const [, rendered] of this.renderedNodes) {
      if (this.nodeGroup) {
        this.nodeGroup.remove(rendered.mesh);
      }
      rendered.mesh.geometry.dispose();
      if (rendered.mesh.material instanceof THREE.Material) {
        rendered.mesh.material.dispose();
      }
      if (rendered.labelSprite && this.labelGroup) {
        this.labelGroup.remove(rendered.labelSprite);
        if (rendered.labelSprite.material instanceof THREE.Material) {
          rendered.labelSprite.material.dispose();
        }
      }
    }
    this.renderedNodes.clear();

    // Clear edges
    for (const [, rendered] of this.renderedEdges) {
      if (this.edgeGroup) {
        this.edgeGroup.remove(rendered.line);
      }
      rendered.line.geometry.dispose();
      if (rendered.line.material instanceof THREE.Material) {
        rendered.line.material.dispose();
      }
    }
    this.renderedEdges.clear();
  }

  /**
   * Destroy the manager and release resources
   */
  destroy(): void {
    // Stop render loop
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Stop resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Clear graphics
    this.clear();

    // Dispose shared resources
    if (this.sphereGeometry) {
      this.sphereGeometry.dispose();
      this.sphereGeometry = null;
    }
    if (this.nodeMaterial) {
      this.nodeMaterial.dispose();
      this.nodeMaterial = null;
    }

    // Dispose controls
    if (this.controls) {
      this.controls.dispose();
      this.controls = null;
    }

    // Dispose renderer
    if (this.renderer) {
      this.renderer.dispose();
      if (this.container) {
        this.container.removeChild(this.renderer.domElement);
      }
      this.renderer = null;
    }

    // Clear scene
    if (this.scene) {
      this.scene.clear();
      this.scene = null;
    }

    this.camera = null;
    this.nodeGroup = null;
    this.edgeGroup = null;
    this.labelGroup = null;
    this.container = null;
    this.eventListeners.clear();
    this.initialized = false;
  }
}

/**
 * Factory function to create Scene3DManager
 */
export function createScene3DManager(
  config?: Partial<Scene3DConfig>,
  nodeStyle?: Partial<Node3DStyle>,
  edgeStyle?: Partial<Edge3DStyle>,
  labelStyle?: Partial<Label3DStyle>,
  controlsConfig?: Partial<OrbitControlsConfig>
): Scene3DManager {
  return new Scene3DManager(config, nodeStyle, edgeStyle, labelStyle, controlsConfig);
}
