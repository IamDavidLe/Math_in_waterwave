import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  const router = () => createRouter({ routeTree, context: { queryClient: new QueryClient() } });

  // The three pages are separate: the opening animation, the investigation, and
  // the lab. A missing one matches nothing and falls back to the root.
  it.each(["/", "/landing", "/lab"])("matches a page for %s", (path) => {
    const matches = router().matchRoutes(path);

    expect(matches.at(-1)?.routeId).toBe(path === "/" ? "/" : path);
  });

  it("falls back to not found for a path with no page", () => {
    const matches = router().matchRoutes("/nope");

    expect(matches.at(-1)?.routeId).toBe(rootRouteId);
  });
});
