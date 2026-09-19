'use strict';

const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

// GET /api/bot-filter-profiles
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM bot_filter_profiles ORDER BY name');
    res.json(rows);
  } catch (err) {
    console.error('GET /bot-filter-profiles error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// POST /api/bot-filter-profiles
router.post('/', async (req, res) => {
  try {
    const { name, bot_names = [] } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nome obrigatório.' });
    const { rows } = await pool.query(
      'INSERT INTO bot_filter_profiles (name, bot_names) VALUES ($1, $2) RETURNING *',
      [name.trim(), bot_names]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Já existe um perfil com esse nome.' });
    console.error('POST /bot-filter-profiles error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// PATCH /api/bot-filter-profiles/:id
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, bot_names } = req.body;
    const sets = [];
    const params = [];
    if (name !== undefined) { params.push(name.trim()); sets.push(`name = $${params.length}`); }
    if (bot_names !== undefined) { params.push(bot_names); sets.push(`bot_names = $${params.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar.' });
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE bot_filter_profiles SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Perfil não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Já existe um perfil com esse nome.' });
    console.error('PATCH /bot-filter-profiles error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// DELETE /api/bot-filter-profiles/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM bot_filter_profiles WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /bot-filter-profiles error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

module.exports = router;
