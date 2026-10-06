import { createFileRoute } from "@tanstack/react-router";

import { Landing } from "@/components/landing";

export const Route = createFileRoute("/landing")({
  head: () => ({
    meta: [
      { title: "Rings on a Lake — Ripple Lab" },
      {
        name: "description",
        content:
          "Why every splash writes a different pattern, and the mathematics hiding in it: circular symmetry, the cosine, 1/√r spreading, dispersion, and the hyperbolas where two ripples cancel.",
      },
      { property: "og:title", content: "Rings on a Lake — Ripple Lab" },
      {
        property: "og:description",
        content: "A ripple investigation: the mathematics hiding in rings on a lake.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});
