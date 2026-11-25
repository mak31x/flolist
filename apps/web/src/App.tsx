import { healthResponseSchema } from "@flolist/shared";
import { brand } from "@flolist/ui/brand";
import { useEffect, useState } from "react";

type ApiStatus = "checking" | "ok" | "unreachable";

/** Walking-skeleton hello page. The real app shell arrives in M0.3. */
export function App() {
  const [status, setStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then((res) => res.json())
      .then((json: unknown) => {
        setStatus(healthResponseSchema.safeParse(json).success ? "ok" : "unreachable");
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          console.error(err);
          setStatus("unreachable");
        }
      });
    return () => {
      controller.abort();
    };
  }, []);

  return (
    <main>
      <h1>{brand.wordmark}</h1>
      <p>Hello from {brand.name}.</p>
      <p role="status">API: {status}</p>
    </main>
  );
}
