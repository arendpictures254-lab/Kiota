import type { MetadataRoute } from "next";
import { SITE_PAGES, SITE_URL } from "@/lib/hosts";

export default function sitemap(): MetadataRoute.Sitemap {
  return SITE_PAGES.map((path) => ({
    url: `${SITE_URL}${path === "/" ? "" : path}`,
    changeFrequency: "monthly",
    priority: path === "/" ? 1 : 0.6,
  }));
}
