const express = require('express');
const router = express.Router();
// const { generateEmail, getHistory } = require('../controllers/aiController');

const protect  = require('../middleware/authMiddleware');
const aiController = require('../controllers/aiController');
router.post('/generate-email', protect, aiController.generateEmail);
router.get('/history', protect, aiController.getHistory);

module.exports = router;

