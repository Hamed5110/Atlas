"use client";

import { useEffect, useState } from "react";

/** Pass primitives only: a new object each render would restart the timer forever. */
export function useDebounced<T extends string | number | boolean>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
