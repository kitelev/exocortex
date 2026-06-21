export interface IClock {
  now(): Date;
}

export function liveClock(): IClock {
  return {
    now: () => new Date(),
  };
}

export function frozenClock(iso: string): IClock {
  const fixed = new Date(iso);
  return {
    now: () => new Date(fixed.getTime()),
  };
}
