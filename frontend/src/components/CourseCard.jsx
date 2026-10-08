import { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, ChevronDown, Volume2, Briefcase, Store, MapPin, Award, Building2, Landmark, ExternalLink, TriangleAlert, Sprout, Search } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

const FIT_STYLE = {
  strong: 'bg-teal text-white',
  good: 'bg-marigold text-ink',
  possible: 'bg-teal-light text-teal-dark',
};

function Section({ icon: Icon, title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-teal-light">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="w-full flex items-center gap-3 py-3 text-left">
        <Icon size={20} className="text-teal flex-shrink-0" />
        <span className="flex-1 font-display font-semibold text-ink">{title}</span>
        <ChevronDown size={20} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="pb-4 pl-8 pr-1 text-[15px] text-gray-700 space-y-2">{children}</div>}
    </div>
  );
}

/* One recommended course: the reason, the skill gap, where it leads and what support exists. */
export default function CourseCard({ rec, onListen, speaking }) {
  const { t } = useLanguage();
  const { course, reasons, cautions, gap, pathway, local, schemes, microLesson } = rec;
  const fitKey = `fit_${rec.fit}`;

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: (rec.rank - 1) * 0.08 }}
      className="bg-white rounded-xl2 shadow-card px-5 pt-5 pb-1"
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-marigold text-ink font-display font-extrabold text-xl flex items-center justify-center flex-shrink-0">
          {rec.rank}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-xl font-display font-bold text-ink leading-snug">{course.title}</h3>
          <div className="flex flex-wrap gap-2 mt-2 text-sm">
            <span className={`px-3 py-1 rounded-full font-semibold ${FIT_STYLE[rec.fit]}`}>{t(fitKey)}</span>
            <span className="px-3 py-1 rounded-full bg-teal-light text-teal-dark font-semibold">{t('nsqfLevel')} {course.nsqf}</span>
            <span className="px-3 py-1 rounded-full bg-cream text-gray-700 font-medium">{course.weeks} {t('weeks')}</span>
          </div>
        </div>
        <button onClick={() => onListen()} aria-label={t('listen')} className="tap-target bg-teal-light rounded-full text-teal flex-shrink-0">
          <Volume2 size={22} className={speaking ? 'animate-pulse' : ''} />
        </button>
      </div>

      {/* why: always open, this is the part the brief asks us to be able to explain */}
      <ul className="space-y-2 mb-3">
        {reasons.slice(0, 4).map((r) => (
          <li key={r} className="flex items-start gap-2 text-[15px] text-gray-700">
            <CheckCircle2 size={18} className="text-teal mt-0.5 flex-shrink-0" />
            <span>{r}</span>
          </li>
        ))}
      </ul>

      {cautions.map((c) => (
        <p key={c} className="flex items-start gap-2 text-sm text-coral bg-coral-light rounded-xl2 px-3 py-2 mb-3">
          <TriangleAlert size={16} className="mt-0.5 flex-shrink-0" />
          {c}
        </p>
      ))}

      <Section icon={Sprout} title={t('skillGap')} defaultOpen>
        {gap.has.length > 0 && (
          <div>
            <p className="font-semibold text-ink">{t('youHave')}</p>
            <ul className="list-disc pl-5">{gap.has.map((h) => <li key={h}>{h}</li>)}</ul>
            {gap.type === 'certify' && <p className="text-teal-dark mt-1">{t('certifyNote')}</p>}
          </div>
        )}
        <div>
          <p className="font-semibold text-ink">{t('youWillLearn')}</p>
          <ul className="list-disc pl-5">{gap.adds.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
        {gap.next && (
          <p>
            <span className="font-semibold text-ink">{t('nextLevel')}: </span>
            {gap.next.title} ({t('nsqfLevel')} {gap.next.nsqf})
          </p>
        )}
      </Section>

      <Section icon={pathway.primary === 'self' ? Store : Briefcase} title={t('whereItLeads')}>
        <p className={pathway.primary === 'wage' ? 'font-semibold text-ink' : ''}>
          <Briefcase size={15} className="inline mr-1.5 -mt-0.5" />
          {t('jobPath')}: {pathway.role}
        </p>
        <p className={pathway.primary === 'self' ? 'font-semibold text-ink' : ''}>
          <Store size={15} className="inline mr-1.5 -mt-0.5" />
          {t('ownWorkPath')}: {pathway.enterprise}
        </p>
        {local.note && (
          <p className="flex items-start gap-2 text-teal-dark">
            <MapPin size={16} className="mt-0.5 flex-shrink-0" />
            {local.note}
          </p>
        )}
        {local.live && local.live.count > 0 && (
          <div className="bg-cream rounded-xl2 px-3 py-2">
            <p className="flex items-start gap-2 font-semibold text-ink">
              <Search size={16} className="mt-0.5 flex-shrink-0 text-teal" />
              {t('liveListings')}: {local.live.count}{local.live.capped ? '+' : ''}
            </p>
            {local.live.sample?.[0] && (
              <p className="text-sm text-gray-600">
                {local.live.sample[0].title}{local.live.sample[0].company ? ` · ${local.live.sample[0].company}` : ''}
              </p>
            )}
            <p className="text-xs text-gray-500">{t('liveSource')}</p>
          </div>
        )}
      </Section>

      <Section icon={Landmark} title={`${t('supportYouMayGet')} (${schemes.length})`}>
        {schemes.length === 0 && <p>{t('noSchemes')}</p>}
        {schemes.map((s) => (
          <div key={s.id} className="bg-cream rounded-xl2 px-3 py-2">
            <p className="font-semibold text-ink">{s.name}</p>
            <p className="text-sm">{s.benefit}</p>
            <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-teal mt-1">
              {t('learnMore')} <ExternalLink size={13} />
            </a>
          </div>
        ))}
        {schemes.length > 0 && <p className="text-xs text-gray-500">{t('counsellorConfirms')}</p>}
      </Section>

      <Section icon={Building2} title={t('whereToTrain')}>
        <p><span className="font-semibold text-ink">{t('trainingAt')}: </span>{course.centre}</p>
        <p><Award size={15} className="inline mr-1.5 -mt-0.5" /><span className="font-semibold text-ink">{t('certifiedBy')}: </span>{course.certifyingBody}</p>
        <p><span className="font-semibold text-ink">{t('entryEducation')}: </span>{course.minEducation}</p>
      </Section>

      <div className="border-t border-teal-light py-3">
        <button onClick={() => onListen(microLesson.speak)} className="w-full flex items-center gap-3 text-left">
          <span className="w-10 h-10 rounded-full bg-marigold-light text-marigold-dark flex items-center justify-center flex-shrink-0">
            <Volume2 size={20} />
          </span>
          <span className="flex-1">
            <span className="block text-xs text-gray-500">{t('microLesson')}</span>
            <span className="block font-display font-semibold text-ink">{microLesson.title}</span>
          </span>
        </button>
      </div>
    </motion.article>
  );
}
