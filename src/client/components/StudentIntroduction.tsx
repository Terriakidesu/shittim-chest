import { useEffect, useRef } from "react";
import { asset, emblemUrl } from "../api";
import type { PullResult } from "../gachaRules";
import { portraitEntranceMs } from "../recruitmentTiming";
import { clubName, schoolName, studentDialogue, studentName, t, useLanguage } from "../i18n";
import { useFitText } from "../useFitText";

/** The reveal-nameplate scene. Document-paper headings and stamps stay in
    English (game props); data labels, names and the continue control localize. */
export function StudentIntroduction({ result, ready, onNext }: { result: PullResult; ready: boolean; onNext: () => void }) {
  useLanguage();
  const { student, rarity, duplicate, featured } = result;
  const name = studentName(student);
  const dialogue = studentDialogue(student.profile);
  const profile = student.profile;
  const emblem = emblemUrl(student.school);
  const continueRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLHeadingElement>(null);
  useFitText(nameRef, name);
  useEffect(() => { if (ready) continueRef.current?.focus({ preventScroll: true }); }, [ready]);
  return <section className={`student-introduction rarity-${rarity}`} style={{ animationDelay: `${portraitEntranceMs(rarity)}ms` }} aria-label={t(duplicate ? "intro.aria.duplicate" : "intro.aria.new", { name, stars: rarity })}>
    <div className="student-intro-backdrop" aria-hidden="true" />
    <img className="student-intro-portrait" src={asset(`img/portrait/${student.id}.webp`)} alt="" onError={(event) => { const image = event.currentTarget; if (image.dataset.fallback) image.style.display = "none"; else { image.dataset.fallback = "true"; image.src = asset(`img/avatar/${student.id}.webp`); } }} />
    <div className="student-intro-application">
      <div className="student-application-paper">
        <p className="student-application-heading">S.C.H.A.L.E. <span>Admission application</span></p>
        <div className="student-application-school">{emblem && <img src={emblem} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />}<strong>{student.school ? schoolName(student.school) : t("intro.schoolFallback")}</strong></div>
        <dl>
          {student.club && <><dt>{t("intro.club")}</dt><dd>{clubName(student.club)}</dd></>}
          <dt>{t("intro.role")}</dt><dd className={`application-role ${profile?.tacticalRole === "Special" ? "is-special" : ""}`}>{profile?.tacticalRole?.toUpperCase() || "—"}</dd>
          <dt>{t("intro.weapon")}</dt><dd>{profile?.weaponType || "—"}</dd>
          <dt>{t("intro.birthday")}</dt><dd>{profile?.birthday || "—"}</dd>
        </dl>
        <span className="student-application-footer">FEDERAL INVESTIGATION CLUB · S.C.H.A.L.E.</span>
      </div>
    </div>
    <div className="student-intro-identity">
      {!duplicate && <span className="student-intro-status">{t("intro.new")}{featured ? t("intro.pickup") : ""}</span>}
      <div className="student-intro-nameplate"><span className="student-intro-stars" aria-label={t("sim.starsAriaMany", { n: rarity })}>{Array.from({ length: rarity }, (_, index) => <img key={index} src={asset("ba-cards/Star.webp")} alt="" />)}</span><h2 ref={nameRef} title={name}><span>{name}</span></h2>{profile?.voiceActor && <span className="student-intro-voice" title={t("intro.cvTitle", { name: profile.voiceActor })}>{t("intro.cv", { name: profile.voiceActor })}</span>}</div>
      {dialogue && <div className="student-intro-message"><span>{dialogue}</span><small>{t("intro.message")}</small></div>}
    </div>
    <button ref={continueRef} className="student-intro-continue" disabled={!ready} onClick={onNext} aria-label={t("intro.continueAria", { name })}><span>{ready ? t("intro.continue") : ""}</span></button>
  </section>;
}
