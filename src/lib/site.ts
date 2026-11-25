import { getCollection } from "astro:content";
import type { CollectionEntry } from "astro:content";

export type Language = "en" | "es";
export type PageEntry = CollectionEntry<"en"> | CollectionEntry<"es">;
export type Link = { label: string; href: string };

export const LANGUAGES: Language[] = ["en", "es"];
export const SWITCH_LABELS: Record<Language, string> = { en: "EN", es: "ES" };
export const OG_LOCALES: Record<Language, string> = { en: "en_US", es: "es_LA" };
export const SITE_NAME = "Prototype";
export const LEGAL_NAME = "Prototype S.A.S. DE C.V.";

export const SKIP_LINK_LABELS: Record<Language, string> = { en: "Skip to content", es: "Saltar al contenido" };

// Explicit orders: the glob loader returns entries alphabetically.
// The nav pages are sections of the home (their ids are the page names), not pages of their own.
const NAV_PAGES = ["about", "services", "contact"];
const FOOTER_PAGES = ["privacy", "terms", "data-deletion"];
export const HOME_AND_LEGAL_PAGES = ["home", ...FOOTER_PAGES];

export const labelFromTitle = (title: string): string => title.replace(/ \| Prototype$/, "");

// Single source for og:url and every hreflang alternate.
export const absoluteUrl = (entry: PageEntry, siteUrl: URL): string => new URL(entry.data.path, siteUrl).href;

export async function getChrome(language: Language, page: string, siteUrl: URL) {
  const otherLanguage: Language = language === "en" ? "es" : "en";
  const [current, other] = await Promise.all([getCollection(language), getCollection(otherLanguage)]);
  const byPage = (entries: PageEntry[], wanted: string): PageEntry => {
    const found = entries.find((entry) => entry.data.page === wanted);
    if (!found) throw new Error(`content/${entries === current ? language : otherLanguage}/${wanted}.md is missing`);
    return found;
  };
  const toLink = (wanted: string): Link => {
    const entry = byPage(current, wanted);
    return { label: labelFromTitle(entry.data.title), href: entry.data.path };
  };
  const homePath = byPage(current, "home").data.path;
  const toSectionLink = (wanted: string): Link => ({ label: toLink(wanted).label, href: `${homePath}#${wanted}` });
  const entryOf = (lang: Language, wanted: string): PageEntry => byPage(lang === language ? current : other, wanted);

  return {
    homeHref: homePath,
    nav: NAV_PAGES.map(toSectionLink),
    footer: FOOTER_PAGES.map(toLink),
    switchTarget: { label: SWITCH_LABELS[otherLanguage], language: otherLanguage, href: byPage(other, page).data.path },
    alternates: [
      ...LANGUAGES.map((lang) => ({ hreflang: lang as string, href: absoluteUrl(entryOf(lang, page), siteUrl) })),
      { hreflang: "x-default", href: absoluteUrl(entryOf("en", page), siteUrl) },
    ],
    ogUrl: absoluteUrl(byPage(current, page), siteUrl),
  };
}
