'use strict';

const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

// ── GET /api/gestao-settings ──────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT incluir_bots_excluidos FROM gestao_settings WHERE id = TRUE');
    res.json({ incluir_bots_excluidos: rows[0]?.incluir_bots_excluidos ?? false });
  } catch (err) {
    console.error('GET /gestao-settings error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── PATCH /api/gestao-settings ────────────────────────────────────────────────
router.patch('/', async (req, res) => {
  try {
    const { incluir_bots_excluidos } = req.body;
    if (typeof incluir_bots_excluidos !== 'boolean')
      return res.status(400).json({ error: 'Campo "incluir_bots_excluidos" deve ser boolean.' });

    const { rows } = await pool.query(
      `INSERT INTO gestao_settings (id, incluir_bots_excluidos) VALUES (TRUE, $1)
       ON CONFLICT (id) DO UPDATE SET incluir_bots_excluidos = EXCLUDED.incluir_bots_excluidos
       RETURNING incluir_bots_excluidos`,
      [incluir_bots_excluidos]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('PATCH /gestao-settings error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

module.exports = router;
