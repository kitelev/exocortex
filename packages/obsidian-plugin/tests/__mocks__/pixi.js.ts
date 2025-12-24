/**
 * Mock for pixi.js module
 *
 * Used by Jest to provide mock implementations of PixiJS v8 classes
 * for testing in JSDOM environment (no WebGL support).
 */

export const mockAppInit = jest.fn().mockResolvedValue(undefined);
export const mockAppRender = jest.fn();
export const mockAppDestroy = jest.fn();
export const mockRendererResize = jest.fn();

export const mockAddChild = jest.fn();
export const mockRemoveChild = jest.fn();
export const mockPositionSet = jest.fn();
export const mockScaleSet = jest.fn();
export const mockAnchorSet = jest.fn();

export const mockContainerDestroy = jest.fn();
export const mockGraphicsClear = jest.fn();
export const mockGraphicsCircle = jest.fn();
export const mockGraphicsRect = jest.fn();
export const mockGraphicsRoundRect = jest.fn();
export const mockGraphicsFill = jest.fn();
export const mockGraphicsMoveTo = jest.fn();
export const mockGraphicsLineTo = jest.fn();
export const mockGraphicsClosePath = jest.fn();
export const mockGraphicsStroke = jest.fn();
export const mockGraphicsDestroy = jest.fn();
export const mockGraphicsRemoveFromParent = jest.fn();
export const mockTextDestroy = jest.fn();

export const Application = jest.fn().mockImplementation(() => ({
  init: mockAppInit,
  stage: {
    addChild: mockAddChild,
    position: { set: mockPositionSet },
    scale: { set: mockScaleSet },
  },
  renderer: {
    resize: mockRendererResize,
    width: 800,
    height: 600,
  },
  ticker: {
    FPS: 60,
  },
  render: mockAppRender,
  destroy: mockAppDestroy,
}));

export const Container = jest.fn().mockImplementation(() => ({
  addChild: mockAddChild,
  removeChild: mockRemoveChild,
  destroy: mockContainerDestroy,
  sortableChildren: false,
  visible: true,
}));

export const Graphics = jest.fn().mockImplementation(() => {
  const graphics = {
    clear: jest.fn(function(this: unknown) {
      mockGraphicsClear();
      return this;
    }),
    circle: jest.fn(function(this: unknown, ...args: unknown[]) {
      mockGraphicsCircle(...args);
      return this;
    }),
    rect: jest.fn(function(this: unknown, ...args: unknown[]) {
      mockGraphicsRect(...args);
      return this;
    }),
    roundRect: jest.fn(function(this: unknown, ...args: unknown[]) {
      mockGraphicsRoundRect(...args);
      return this;
    }),
    fill: jest.fn(function(this: unknown, ...args: unknown[]) {
      mockGraphicsFill(...args);
      return this;
    }),
    moveTo: jest.fn(function(this: unknown, ...args: unknown[]) {
      mockGraphicsMoveTo(...args);
      return this;
    }),
    lineTo: jest.fn(function(this: unknown, ...args: unknown[]) {
      mockGraphicsLineTo(...args);
      return this;
    }),
    closePath: jest.fn(function(this: unknown) {
      mockGraphicsClosePath();
      return this;
    }),
    stroke: jest.fn(function(this: unknown, ...args: unknown[]) {
      mockGraphicsStroke(...args);
      return this;
    }),
    destroy: mockGraphicsDestroy,
    removeFromParent: mockGraphicsRemoveFromParent,
    position: { set: jest.fn() },
  };
  return graphics;
});

export const Text = jest.fn().mockImplementation(() => ({
  destroy: mockTextDestroy,
  anchor: { set: mockAnchorSet },
  position: { set: jest.fn() },
  text: "",
}));
