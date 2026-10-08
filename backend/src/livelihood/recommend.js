/**
 * Recommender: profile -> ranked NSQF courses with reasons, skill gaps,
 * local opportunity, linked schemes and a human-review flag.
 *
 * Fully deterministic: the same profile (and, when one is passed, the same demand
 * snapshot) always gives the same answer, and every point in a score is tied to a
 * sentence the person can read in their language.
 *
 * Demand data comes from opts.demand. It defaults to the static table in demand.js;
 * the web endpoint passes a snapshot that also carries live job listings (liveDemand.js).
 */
const { EDU_RANK, EDU_LABEL, TRADES } = require('./vocab');
const { COURSES, BY_ID } = require('./courses');
const demand = require('./demand');
const { SCHEMES, ARTISAN_TRADES, COMMON_DOCUMENTS } = require('./schemes');
const { checkSchemeEligibility } = require('../utils/rulesEngine');
const { stateLabel } = require('./extract');

const lang2 = (l) => (l === 'hi' ? 'hi' : 'en');
const label = (trade, lang) => TRADES[trade][lang];
const overlap = (a, b) => (a || []).filter((x) => (b || []).includes(x));

// ---------- score weights (kept together so they are easy to explain and tune) ----------
const W = {
  interest: 40,
  current: 15,
  family: 15,
  demandPerLevel: 6, // x level 1..3 => up to 18
  localWork: 12,
  preference: 8,
  eitherPreference: 4,
  primaryPathway: 3, // the course's main route is the one the person prefers
  heavyWithConstraint: -10,
  residentialButNeedsLocal: -20,
};

// ---------- sentences ----------
const R = {
  interest: (tr, l) => ({ en: `You told us you want to learn ${label(tr, 'en')}.`, hi: `आपने ${label(tr, 'hi')} सीखने की इच्छा बताई।` }[l]),
  family: (tr, l) => ({ en: `Your family already works in ${label(tr, 'en')}, so you start with an advantage.`, hi: `आपके परिवार में यह काम होता है: ${label(tr, 'hi')}। इसलिए आप पहले से आगे हैं।` }[l]),
  current: (tr, l) => ({ en: `You already work in ${label(tr, 'en')}; this training gives you a certificate and better pay.`, hi: `आप पहले से यह काम करते हैं: ${label(tr, 'hi')}। यह ट्रेनिंग आपको प्रमाणपत्र और बेहतर कमाई दिलाएगी।` }[l]),
  demandHigh: (tr, st, l) => ({ en: `${cap(label(tr, 'en'))} work is in high demand in ${st}.`, hi: `${stateLabel(st, 'hi')} में इस क्षेत्र (${label(tr, 'hi')}) में काम की माँग बहुत ज़्यादा है।` }[l]),
  demandMid: (tr, st, l) => ({ en: `There is steady demand for ${label(tr, 'en')} work in ${st}.`, hi: `${stateLabel(st, 'hi')} में इस क्षेत्र (${label(tr, 'hi')}) में काम की माँग बनी रहती है।` }[l]),
  liveListings: (tr, st, info, l) => {
    const n = `${info.count}${info.capped ? '+' : ''}`;
    return ({ en: `Recently, about ${n} job listings for ${label(tr, 'en')} were found in ${st}.`, hi: `हाल ही में ${stateLabel(st, 'hi')} में ${label(tr, 'hi')} के लिए लगभग ${n} नौकरी की सूचियाँ मिलीं।` }[l]);
  },
  localWork: (l) => ({ en: 'People near you already do this work, so finding customers or a job should be easier.', hi: 'आपके आसपास लोग यह काम करते हैं, इसलिए ग्राहक या नौकरी मिलना आसान होगा।' }[l]),
  prefSelf: (l) => ({ en: 'This leads to your own small business, as you prefer.', hi: 'यह आपके पसंदीदा अपने छोटे काम की ओर ले जाता है।' }[l]),
  prefWage: (l) => ({ en: 'This leads to a job with a salary, as you prefer.', hi: 'यह आपकी पसंद की तरह नौकरी की ओर ले जाता है।' }[l]),
  eduFit: (edu, l) => ({ en: `Matches your education: ${EDU_LABEL[edu].en} is enough.`, hi: `आपकी पढ़ाई के अनुरूप: ${EDU_LABEL[edu].hi} काफ़ी है।` }[l]),
  lightWork: (l) => ({ en: 'The work is not physically heavy.', hi: 'इस काम में भारी शारीरिक मेहनत नहीं है।' }[l]),
  closeToHome: (l) => ({ en: 'Training can usually be done close to home.', hi: 'ट्रेनिंग आमतौर पर घर के पास हो सकती है।' }[l]),
  cautionHeavy: (l) => ({ en: 'This work can be physically demanding. Please discuss it with the counsellor.', hi: 'इस काम में शारीरिक मेहनत ज़्यादा हो सकती है। कृपया काउंसलर से बात करें।' }[l]),
  cautionAway: (l) => ({ en: 'The training centre may be away from home. Ask the counsellor about a nearby batch or a hostel.', hi: 'प्रशिक्षण केंद्र घर से दूर हो सकता है। काउंसलर से पास के बैच या हॉस्टल के बारे में पूछें।' }[l]),
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Short scripts the app reads aloud after a pathway is chosen.
const MICRO = {
  self: {
    title: { en: 'Starting your own work: 3 tips', hi: 'अपना काम शुरू करने के 3 सुझाव' },
    speak: {
      en: 'Start small with what you can afford. Write down every rupee that comes in and goes out. Keep some savings before you take a loan, and take only what you can repay each month.',
      hi: 'अपनी क्षमता के अनुसार छोटा शुरू कीजिए। हर आने और जाने वाले रुपये का हिसाब लिखिए। ऋण लेने से पहले कुछ बचत रखिए, और उतना ही लीजिए जितना हर महीने चुका सकें।',
    },
  },
  wage: {
    title: { en: 'Getting a job after training: 3 tips', hi: 'ट्रेनिंग के बाद नौकरी पाने के 3 सुझाव' },
    speak: {
      en: 'Keep your training certificate and Aadhaar together in one folder. Ask the training centre about placement support before you enrol. After the course, register on the National Career Service portal and keep your phone number active.',
      hi: 'ट्रेनिंग का प्रमाणपत्र और आधार एक ही फ़ाइल में रखिए। दाख़िला लेने से पहले केंद्र से प्लेसमेंट सहायता के बारे में पूछिए। कोर्स के बाद नेशनल करियर सर्विस पोर्टल पर पंजीकरण कीजिए और अपना फ़ोन नंबर चालू रखिए।',
    },
  },
};

// ---------- pieces ----------
function preferredPathway(profile, course) {
  const pref = profile.employmentPreference;
  if (pref === 'self' && course.pathways.includes('self')) return 'self';
  if (pref === 'wage' && course.pathways.includes('wage')) return 'wage';
  return course.pathways[0];
}

function skillGap(course, profile, lang) {
  const inCurrent = overlap(course.trades, profile.currentActivity);
  const inFamily = overlap(course.trades, profile.familyOccupation);
  const has = [];
  inCurrent.forEach((tr) => has.push({ en: `Hands-on experience in ${label(tr, 'en')}`, hi: `व्यावहारिक अनुभव: ${label(tr, 'hi')}` }[lang]));
  inFamily.filter((tr) => !inCurrent.includes(tr)).forEach((tr) => has.push({ en: `Family knowledge of ${label(tr, 'en')}`, hi: `परिवार से जानकारी: ${label(tr, 'hi')}` }[lang]));
  const next = course.next ? BY_ID[course.next] : null;
  return {
    type: inCurrent.length ? 'certify' : 'new', // 'certify' = already works in it, so the course formalises existing skill
    has,
    adds: course.skills.map((s) => s[lang]),
    addsEn: course.skills.map((s) => s.en),
    next: next ? { id: next.id, title: next.title[lang], nsqf: next.nsqf } : null,
  };
}

function buildFacts(profile) {
  const trades = [...(profile.currentActivity || []), ...(profile.familyOccupation || []), ...(profile.interests || [])];
  return {
    ...profile,
    category: profile.category || 'sc',
    wantsSelfEmployment: ['self', 'either'].includes(profile.employmentPreference),
    isArtisan: trades.some((tr) => ARTISAN_TRADES.includes(tr)),
    isWoman: profile.gender === 'female',
  };
}

function eligibleSchemes(profile) {
  const facts = buildFacts(profile);
  return SCHEMES.filter((s) => checkSchemeEligibility(facts, s).eligible);
}

function schemeCard(s, lang) {
  return { id: s.id, name: s.name[lang], benefit: s.benefit[lang], url: s.url };
}

// ---------- main ----------
function recommend(rawProfile, langIn, opts = {}) {
  const D = opts.demand || demand; // static table unless a live snapshot is passed
  const lang = lang2(langIn);
  const profile = rawProfile || {};
  const state = profile.state || null;
  const edu = profile.education;
  const eduRank = edu != null ? EDU_RANK[edu] : EDU_RANK.class8; // unknown: assume class 8, flagged for review below
  const tooYoung = profile.age != null && profile.age < 15;

  const facts = buildFacts(profile);
  const schemes = eligibleSchemes(profile);
  const scored = [];

  if (!tooYoung) {
    for (const c of COURSES) {
      if (EDU_RANK[c.minEdu] > eduRank) continue; // hard filter: entry education

      let score = 0;
      const reasons = [];
      const cautions = [];

      const interestHit = overlap(c.trades, profile.interests);
      const currentHit = overlap(c.trades, profile.currentActivity);
      const familyHit = overlap(c.trades, profile.familyOccupation);
      const localHit = overlap(c.trades, profile.localWork);
      const bestDemand = Math.max(0, ...c.trades.map((tr) => D.level(state, tr)));

      if (interestHit.length) { score += W.interest; reasons.push(R.interest(interestHit[0], lang)); }
      if (currentHit.length) { score += W.current; reasons.push(R.current(currentHit[0], lang)); }
      if (familyHit.length) { score += W.family; reasons.push(R.family(familyHit[0], lang)); }

      if (bestDemand >= 2) {
        score += bestDemand * W.demandPerLevel;
        const tr = c.trades.find((x) => D.level(state, x) === bestDemand);
        reasons.push(bestDemand === 3 ? R.demandHigh(tr, state, lang) : R.demandMid(tr, state, lang));
        const info = D.liveInfo ? D.liveInfo(state, tr) : null;
        if (info && info.count > 0) reasons.push(R.liveListings(tr, state, info, lang));
      }
      if (localHit.length) { score += W.localWork; reasons.push(R.localWork(lang)); }

      const path = preferredPathway(profile, c);
      const pref = profile.employmentPreference;
      if (pref === 'either') score += W.eitherPreference;
      else if (pref && c.pathways.includes(pref)) {
        score += W.preference + (c.pathways[0] === pref ? W.primaryPathway : 0);
        reasons.push(pref === 'self' ? R.prefSelf(lang) : R.prefWage(lang));
      }

      if (profile.physicalConstraint) {
        if (c.physical === 'low') reasons.push(R.lightWork(lang));
        if (c.physical === 'high') { score += W.heavyWithConstraint; cautions.push(R.cautionHeavy(lang)); }
      }
      if (profile.travel === 'local') {
        if (c.residential) { score += W.residentialButNeedsLocal; cautions.push(R.cautionAway(lang)); }
        else reasons.push(R.closeToHome(lang));
      }
      if (edu != null) reasons.push(R.eduFit(c.minEdu === 'none' ? 'none' : c.minEdu, lang));

      // must have at least one real link to the person, not just a generic fit
      const linked = interestHit.length || currentHit.length || familyHit.length || localHit.length || bestDemand >= 3;
      if (!linked) continue;

      scored.push({ course: c, score, reasons, cautions, path, interestHit, currentHit, familyHit });
    }
  }

  // rank by score; ties go to the lower NSQF level (easier entry)
  scored.sort((a, b) => b.score - a.score || a.course.nsqf - b.course.nsqf || a.course.id.localeCompare(b.course.id));
  // First pass: one course per trade (the next level up is shown inside the skill-gap view).
  // Second pass: only if fewer than 3 trades matched, fill from what is left.
  const picked = [];
  const seen = new Set();
  for (const s of scored) {
    const key = s.course.trades[0];
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(s);
    if (picked.length === 3) break;
  }
  for (const s of scored) {
    if (picked.length >= 3) break;
    if (!picked.includes(s)) picked.push(s);
  }

  const recommendations = picked.map((s, i) => {
    const c = s.course;
    const gap = skillGap(c, profile, lang);
    const trade = c.trades[0];
    const matchedSchemes = schemes.filter((sc) => {
      if (sc.appliesTo !== 'any' && sc.appliesTo !== s.path) return false;
      if (sc.onlyForTrades && !c.trades.some((tr) => sc.onlyForTrades.includes(tr))) return false;
      return true;
    });
    const lvl = D.level(state, trade);
    return {
      rank: i + 1,
      fit: s.score >= 60 ? 'strong' : s.score >= 35 ? 'good' : 'possible',
      score: s.score,
      course: {
        id: c.id,
        title: c.title[lang],
        trades: c.trades,
        tradeLabel: label(trade, lang),
        nsqf: c.nsqf,
        weeks: c.weeks,
        minEducation: EDU_LABEL[c.minEdu][lang],
        certifyingBody: c.ssc,
        centre: c.centre[lang],
      },
      reasons: s.reasons,
      cautions: s.cautions,
      gap,
      pathway: {
        primary: s.path,
        options: c.pathways,
        role: c.roles[lang],
        enterprise: c.enterprise[lang],
      },
      local: {
        level: lvl,
        high: lvl === 3,
        note: D.note(state) ? D.note(state)[lang] : null,
        ...(D.liveInfo ? { live: D.liveInfo(state, trade) } : {}), // only present when a live snapshot was passed
      },
      microLesson: {
        title: MICRO[s.path].title[lang],
        speak: MICRO[s.path].speak[lang],
      },
      schemes: matchedSchemes.map((sc) => schemeCard(sc, lang)),
    };
  });

  // ---- human-in-the-loop: when should a counsellor look at this before anything is promised ----
  const review = [];
  const say = (en, hi) => review.push(lang === 'hi' ? hi : en);
  if (tooYoung) say('Age is below 15: a counsellor should advise on schooling first.', 'उम्र 15 साल से कम है: पहले पढ़ाई के बारे में काउंसलर सलाह दें।');
  if (!tooYoung && recommendations.length === 0) say('No course matched well. A counsellor should suggest options.', 'कोई कोर्स ठीक से मेल नहीं खाया। काउंसलर विकल्प सुझाएँ।');
  if ((profile.skipped || []).length >= 3) say('Several questions were skipped.', 'कई सवाल छोड़े गए।');
  if (profile.age == null || !profile.state) say('Age or state is missing.', 'उम्र या राज्य की जानकारी नहीं है।');
  if (edu == null) say('Education level is missing.', 'शिक्षा की जानकारी नहीं है।');
  if (profile.physicalConstraint) say('Physical difficulty mentioned: confirm suitable options.', 'शारीरिक परेशानी बताई गई: उपयुक्त विकल्प की पुष्टि करें।');
  if (recommendations.length && recommendations.every((r) => r.fit === 'possible')) say('Only weak matches found.', 'केवल कमज़ोर मेल मिले।');

  const opp = {
    note: state && D.note(state) ? D.note(state)[lang] : null,
    topTrades: D.topTrades(state, 3).map((x) => ({ trade: x.trade, label: label(x.trade, lang), level: x.level })),
  };

  return {
    lang,
    recommendations,
    schemes: schemes.map((s) => schemeCard(s, lang)),
    documents: COMMON_DOCUMENTS.map((d) => d[lang]),
    opportunities: opp,
    needsCounsellor: review.length > 0,
    counsellorReasons: review,
    tooYoung,
    facts: { isArtisan: facts.isArtisan, wantsSelfEmployment: facts.wantsSelfEmployment },
  };
}

module.exports = { recommend, eligibleSchemes, W };
