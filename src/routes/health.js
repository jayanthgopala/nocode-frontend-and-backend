'use strict';

const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
});

module.exports = router;
