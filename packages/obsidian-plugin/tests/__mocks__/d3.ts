// Create chainable mock factory for D3 selections
const createMockSelection = (): Record<string, jest.Mock> => {
  const selection: Record<string, jest.Mock> = {};
  selection.selectAll = jest.fn(() => ({ remove: jest.fn() }));
  selection.attr = jest.fn().mockReturnValue(selection);
  selection.append = jest.fn().mockReturnValue(selection);
  selection.call = jest.fn().mockReturnValue(selection);
  selection.on = jest.fn().mockReturnValue(selection);
  selection.transition = jest.fn().mockReturnValue(selection);
  selection.duration = jest.fn().mockReturnValue(selection);
  selection.data = jest.fn(() => ({
    join: jest.fn(() => ({
      attr: jest.fn().mockReturnThis(),
      text: jest.fn(),
      on: jest.fn(),
      call: jest.fn(),
    })),
  }));
  return selection;
};

export const select = jest.fn(() => createMockSelection());

// Create chainable zoom mock
const createMockZoom = (): Record<string, jest.Mock | object> => {
  const zoomBehavior: Record<string, jest.Mock | object> = {};
  zoomBehavior.scaleExtent = jest.fn().mockReturnValue(zoomBehavior);
  zoomBehavior.on = jest.fn().mockReturnValue(zoomBehavior);
  zoomBehavior.transform = {};
  zoomBehavior.scaleBy = {};
  return zoomBehavior;
};

export const zoom = jest.fn(() => createMockZoom());

export const zoomIdentity = {
  translate: jest.fn().mockReturnThis(),
  scale: jest.fn().mockReturnThis(),
};

// Create chainable force simulation mock
const createMockSimulation = (): Record<string, jest.Mock> => {
  const simulation: Record<string, jest.Mock> = {};
  simulation.force = jest.fn().mockReturnValue(simulation);
  simulation.on = jest.fn((event: string, handler?: () => void) => {
    // Immediately call tick to populate positions for testing
    if (event === "tick" && handler) {
      setTimeout(() => handler(), 0);
    }
    return simulation;
  });
  simulation.stop = jest.fn();
  simulation.alpha = jest.fn().mockReturnValue(simulation);
  simulation.alphaTarget = jest.fn().mockReturnValue(simulation);
  simulation.restart = jest.fn();
  return simulation;
};

export const forceSimulation = jest.fn(() => createMockSimulation());

// Create chainable force link mock
const createMockForceLink = (): Record<string, jest.Mock> => {
  const link: Record<string, jest.Mock> = {};
  link.id = jest.fn().mockReturnValue(link);
  link.distance = jest.fn().mockReturnValue(link);
  return link;
};

export const forceLink = jest.fn(() => createMockForceLink());

// Create chainable force many body mock
const createMockForceManyBody = (): Record<string, jest.Mock> => {
  const force: Record<string, jest.Mock> = {};
  force.strength = jest.fn().mockReturnValue(force);
  force.distanceMin = jest.fn().mockReturnValue(force);
  force.distanceMax = jest.fn().mockReturnValue(force);
  return force;
};

export const forceManyBody = jest.fn(() => createMockForceManyBody());

export const forceCenter = jest.fn();

// Create chainable force collide mock
const createMockForceCollide = (): Record<string, jest.Mock> => {
  const force: Record<string, jest.Mock> = {};
  force.radius = jest.fn().mockReturnValue(force);
  return force;
};

export const forceCollide = jest.fn(() => createMockForceCollide());

export const drag = jest.fn(() => ({
  on: jest.fn(() => ({ on: jest.fn(() => ({ on: jest.fn() })) })),
}));
