import { HtmlDocument } from "@/components/site/HtmlDocument";

// Operator / legacy login (bilingual EN·KO) outside the localized guest site; the root layout
// passes children through, so this segment renders its own document.
export default function LoginLayout({ children }: LayoutProps<"/login">) {
  return <HtmlDocument lang="en">{children}</HtmlDocument>;
}
