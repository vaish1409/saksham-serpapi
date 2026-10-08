const express = require('express');
const c = require('../controllers/livelihoodController');
const { officerOnly } = require('../middleware/officer');

const router = express.Router();

// Public: guests can talk to the assistant without an account.
router.get('/meta', c.meta);
router.get('/catalog', c.catalog);
router.post('/turn', c.turn);
router.post('/recommend', c.recommendHandler);
router.delete('/sessions/:id', c.deleteMine);

// Officer / counsellor only.
router.get('/dashboard', officerOnly, c.dashboard);
router.get('/sessions', officerOnly, c.listSessions);
router.patch('/sessions/:id', officerOnly, c.updateSession);
router.get('/live-status', officerOnly, c.liveStatus);

module.exports = router;
