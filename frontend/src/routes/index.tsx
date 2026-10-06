import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

import { IntroSplash } from "@/components/intro-splash";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ripple Lab — The Math of Water Waves" },
      {
        name: "description",
        content:
          "A steel ball falls into dark water, drawn by the same solver the lab runs on. It opens an investigation into the mathematics of a splash.",
      },
      { property: "og:title", content: "Ripple Lab — The Math of Water Waves" },
      {
        property: "og:description",
        content: "The mathematics of a splash, from the first ripple onward.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Intro,
});

/**
 * The entry page: nothing but the opening animation. When it finishes it hands
 * the visitor to the investigation.
 *
 * The navigation replaces this entry in the history, so going back from the
 * investigation leaves the site rather than landing on the splash again and
 * being pushed straight forward once more.
 */
function Intro() {
  const router = useRouter();
  const toLanding = useCallback(() => {
    void router.navigate({ to: "/landing", replace: true });
  }, [router]);

  return <IntroSplash onDone={toLanding} />;
}
