import { useEffect, useRef } from "react";
import { asset, emblemUrl } from "../api";
import type { PullResult } from "../gachaRules";
import { portraitEntranceMs } from "../recruitmentTiming";
import { useFitText } from "../useFitText";

export function StudentIntroduction({ result, ready, onNext }: { result: PullResult; ready: boolean; onNext: () => void }) {
  const { student, rarity, duplicate, featured } = result;
  const profile = student.profile;
  const emblem = emblemUrl(student.school);
  const continueRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLHeadingElement>(null);
  useFitText(nameRef, student.name);
  useEffect(() => { if (ready) continueRef.current?.focus({ preventScroll: true }); }, [ready]);
  return <section className={`student-introduction rarity-${rarity}`} style={{ animationDelay: `${portraitEntranceMs(rarity)}ms` }} aria-label={`${student.name}, ${rarity} star, ${duplicate ? "already recruited" : "new student"}`}>
    <div className="student-intro-backdrop" aria-hidden="true" />
    <img className="student-intro-portrait" src={asset(`img/portrait/${student.id}.webp`)} alt="" onError={(event) => { const image = event.currentTarget; if (image.dataset.fallback) image.style.display = "none"; else { image.dataset.fallback = "true"; image.src = asset(`img/avatar/${student.id}.webp`); } }} />
    <div className="student-intro-application">
      <div className="student-application-paper">
        <p className="student-application-heading">S.C.H.A.L.E. <span>Admission application</span></p>
        <div className="student-application-school">{emblem && <img src={emblem} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />}<strong>{student.school || "S.C.H.A.L.E."}</strong></div>
        <dl>
          {student.club && <><dt>Club</dt><dd>{student.club}</dd></>}
          <dt>Tactical Role</dt><dd className={`application-role ${profile?.tacticalRole === "Special" ? "is-special" : ""}`}>{profile?.tacticalRole?.toUpperCase() || "—"}</dd>
          <dt>Weapons Used</dt><dd>{profile?.weaponType || "—"}</dd>
          <dt>Birthday</dt><dd>{profile?.birthday || "—"}</dd>
        </dl>
        <span className="student-application-footer">FEDERAL INVESTIGATION CLUB · S.C.H.A.L.E.</span>
      </div>
    </div>
    <div className="student-intro-identity">
      {!duplicate && <span className="student-intro-status">New{featured ? " · Pick-Up!" : ""}</span>}
      <div className="student-intro-nameplate"><span className="student-intro-stars" aria-label={`${rarity} stars`}>{Array.from({ length: rarity }, (_, index) => <img key={index} src={asset("ba-cards/Star.webp")} alt="" />)}</span><h2 ref={nameRef} title={student.name}><span>{student.name}</span></h2>{profile?.voiceActor && <span className="student-intro-voice" title={`CV. ${profile.voiceActor}`}>CV. {profile.voiceActor}</span>}</div>
      {profile?.recruitmentDialogue && <div className="student-intro-message"><span>{profile.recruitmentDialogue}</span><small>message</small></div>}
    </div>
    <button ref={continueRef} className="student-intro-continue" disabled={!ready} onClick={onNext} aria-label={`Continue after ${student.name}`}><span>{ready ? "Click or tap to continue" : ""}</span></button>
  </section>;
}
