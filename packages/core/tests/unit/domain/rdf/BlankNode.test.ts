import { BlankNode } from "../../../../src/domain/models/rdf/BlankNode";

describe("BlankNode", () => {
  describe("constructor", () => {
    it("should create blank node with provided id", () => {
      const node = new BlankNode("b1");
      expect(node.id).toBe("b1");
    });

    it("should throw error for empty id", () => {
      expect(() => new BlankNode("")).toThrow("BlankNode id cannot be empty");
    });

    it("should throw error for id with whitespace", () => {
      expect(() => new BlankNode("  ")).toThrow("BlankNode id cannot be empty");
    });
  });

  describe("equals", () => {
    it("should return true for blank nodes with same id", () => {
      const node1 = new BlankNode("b1");
      const node2 = new BlankNode("b1");
      expect(node1.equals(node2)).toBe(true);
    });

    it("should return false for blank nodes with different ids", () => {
      const node1 = new BlankNode("b1");
      const node2 = new BlankNode("b2");
      expect(node1.equals(node2)).toBe(false);
    });
  });

  describe("toString", () => {
    it("should return blank node notation", () => {
      const node = new BlankNode("b1");
      expect(node.toString()).toBe("_:b1");
    });

    it("should work with numeric ids", () => {
      const node = new BlankNode("123");
      expect(node.toString()).toBe("_:123");
    });

    it("should work with complex ids", () => {
      const node = new BlankNode("node-abc-123");
      expect(node.toString()).toBe("_:node-abc-123");
    });
  });

  describe("generateId", () => {
    it("should generate unique ids", () => {
      const id1 = BlankNode.generateId();
      const id2 = BlankNode.generateId();
      expect(id1).not.toBe(id2);
    });

    it("should generate ids with correct prefix", () => {
      const id = BlankNode.generateId();
      expect(id).toMatch(/^b[0-9]+$/);
    });

    it("should generate incrementing ids", () => {
      const id1 = BlankNode.generateId();
      const id2 = BlankNode.generateId();
      const num1 = parseInt(id1.substring(1), 10);
      const num2 = parseInt(id2.substring(1), 10);
      expect(num2).toBe(num1 + 1);
    });
  });

  describe("create with auto-generated id", () => {
    it("should create blank node with auto-generated id", () => {
      const node = BlankNode.create();
      expect(node.id).toMatch(/^b[0-9]+$/);
    });

    it("should create unique blank nodes", () => {
      const node1 = BlankNode.create();
      const node2 = BlankNode.create();
      expect(node1.equals(node2)).toBe(false);
    });
  });
});
