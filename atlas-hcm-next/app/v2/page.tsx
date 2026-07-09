import { Suspense } from "react";
import V2Shell from "./v2-shell";

export default function V2Page() {
  return (
    <Suspense fallback={null}>
      <V2Shell />
    </Suspense>
  );
}
