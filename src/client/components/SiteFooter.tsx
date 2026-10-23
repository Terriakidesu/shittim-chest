import { link } from "../route";
import { t } from "../i18n";

export function SiteFooter() {
  return <footer className="site-footer">
    <nav aria-label={t("footer.navAria")}><a href={link.home}>{t("footer.home")}</a><a href={link.calendar}>{t("footer.calendar")}</a><a href={link.simulator}>{t("footer.simulator")}</a><a href={link.about}>{t("footer.about")}</a></nav>
    <p>{t("footer.disclaimer")}</p>
  </footer>;
}
