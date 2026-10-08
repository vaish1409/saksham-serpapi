const { LivelihoodSession } = require('../models');
const { processTurn, getMeta } = require('../livelihood/extract');
const { sanitizeProfile } = require('../livelihood/sanitize');
const { recommend } = require('../livelihood/recommend');
const { COURSES } = require('../livelihood/courses');
const { DEMAND } = require('../livelihood/demand');
const { summarise } = require('../livelihood/dashboard');
const { liveDemand } = require('../livelihood/liveDemand');

const lang2 = (l) => (l === 'hi' ? 'hi' : 'en');

// GET /api/livelihood/meta  — options for the review screen (cache in the PWA)
function meta(req, res) {
  res.json(getMeta());
}

// GET /api/livelihood/catalog — the raw catalogue, so the PWA can cache it and a counsellor can browse it offline
function catalog(req, res) {
  res.json({
    note: 'Prototype sample data. Replace with Skill India Digital Hub / NSDC data.',
    courses: COURSES.map((c) => ({
      id: c.id, title: c.title, nsqf: c.nsqf, minEdu: c.minEdu, weeks: c.weeks, trades: c.trades,
      pathways: c.pathways, certifyingBody: c.ssc, centre: c.centre,
    })),
    demand: DEMAND,
  });
}

// POST /api/livelihood/turn  { lang, questionId, transcript, profile, attempts }
// Stateless: works the same for the web app, a WhatsApp voice-note bridge or an IVR call.
function turn(req, res, next) {
  try {
    const { lang, questionId, transcript, profile, attempts } = req.body || {};
    const result = processTurn({
      lang,
      questionId: questionId || null,
      transcript: typeof transcript === 'string' ? transcript.slice(0, 1000) : '',
      profile: sanitizeProfile(profile),
      attempts,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// POST /api/livelihood/recommend  { profile, lang, save?, consent?, contactPhone? }
// Without `save` nothing is stored — guests can try it freely.
async function recommendHandler(req, res, next) {
  try {
    const { profile, lang, save, consent, contactPhone } = req.body || {};
    const clean = sanitizeProfile(profile);
    // Live job-market snapshot (SerpApi). Never throws: with no key, or on any problem, this is just the static table.
    const demandSnapshot = await liveDemand.snapshotFor(clean);
    const result = recommend(clean, lang, { demand: demandSnapshot });
    let sessionId = null;

    if (save) {
      if (consent !== true) {
        return res.status(400).json({ message: 'Consent is required before anything is saved.' });
      }
      const phone = typeof contactPhone === 'string' ? contactPhone.replace(/\D/g, '') : '';
      const top = result.recommendations[0];
      const row = await LivelihoodSession.create({
        lang: lang2(lang),
        state: clean.state,
        profile: clean,
        recommendedCourseIds: result.recommendations.map((r) => r.course.id),
        primaryTrade: top ? top.course.trades[0] : null,
        skillGaps: top ? top.gap.addsEn : [],
        needsReview: result.needsCounsellor,
        reviewReasons: result.counsellorReasons,
        contactPhone: phone.length >= 10 && phone.length <= 15 ? phone : null,
        consent: true,
      });
      sessionId = row.id;
    }
    res.json({ ...result, live: demandSnapshot.meta, sessionId });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/livelihood/sessions/:id — "delete my data". The unguessable id is the capability.
async function deleteMine(req, res, next) {
  try {
    const n = await LivelihoodSession.destroy({ where: { id: req.params.id } });
    res.json({ deleted: n > 0 });
  } catch (err) {
    // a malformed uuid is just "nothing to delete"
    if (err.name === 'SequelizeDatabaseError') return res.json({ deleted: false });
    next(err);
  }
}

// ---------- officer / counsellor ----------

// GET /api/livelihood/live-status — is live job data on, and how much of the SerpApi budget is used this month
async function liveStatus(req, res, next) {
  try {
    res.json(await liveDemand.status());
  } catch (err) {
    next(err);
  }
}

// GET /api/livelihood/dashboard?lang=
async function dashboard(req, res, next) {
  try {
    const rows = await LivelihoodSession.findAll({ order: [['createdAt', 'DESC']], limit: 5000 });
    res.json(summarise(rows.map((r) => r.toJSON()), req.query.lang));
  } catch (err) {
    next(err);
  }
}

// GET /api/livelihood/sessions?review=true&status=pending
async function listSessions(req, res, next) {
  try {
    const where = {};
    if (req.query.review === 'true') where.needsReview = true;
    if (['pending', 'confirmed', 'changed'].includes(req.query.status)) where.counsellorStatus = req.query.status;
    const rows = await LivelihoodSession.findAll({ where, order: [['createdAt', 'DESC']], limit: 50 });
    res.json({ count: rows.length, sessions: rows });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/livelihood/sessions/:id  { counsellorStatus?, followUpStatus? }
async function updateSession(req, res, next) {
  try {
    const row = await LivelihoodSession.findByPk(req.params.id);
    if (!row) return res.status(404).json({ message: 'Session not found' });
    const { counsellorStatus, followUpStatus } = req.body || {};
    if (['pending', 'confirmed', 'changed'].includes(counsellorStatus)) row.counsellorStatus = counsellorStatus;
    if (['none', 'enrolled', 'completed', 'placed', 'dropped'].includes(followUpStatus)) row.followUpStatus = followUpStatus;
    await row.save();
    res.json({ session: row });
  } catch (err) {
    next(err);
  }
}

module.exports = { meta, catalog, turn, recommendHandler, deleteMine, dashboard, listSessions, updateSession, liveStatus };
