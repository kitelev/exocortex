import { v4 as uuidv4, v5 as uuidv5 } from "uuid";

export interface IUidGenerator {
  next(): string;
}

export function liveUidGenerator(): IUidGenerator {
  return {
    next: () => uuidv4(),
  };
}

const SEED_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

export function seededUidGenerator(seed: string): IUidGenerator {
  let counter = 0;
  const seedNamespace = uuidv5(seed, SEED_NAMESPACE);
  return {
    next: () => {
      const name = `${seed}#${counter}`;
      counter += 1;
      return uuidv5(name, seedNamespace);
    },
  };
}
