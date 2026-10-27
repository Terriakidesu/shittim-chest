import { t } from "../i18n";

/**
 * One-line disclaimer. The navigation above already carries every destination,
 * so repeating the links here only duplicated the header on every page.
 */
export function SiteFooter() {
  return <footer className="site-footer">
    <p>{t("footer.disclaimer")}</p>
  </footer>;
}
