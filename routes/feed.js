const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  const tag = req.query.tag || null;
  const category = req.query.category || null;
  const posts = db.listPosts({ tag, category, limit: 100 });
  const tags = db.getAllTags();
  res.render('feed', { posts, tags, activeTag: tag, activeCategory: category, categories: db.CATEGORIES });
});

module.exports = router;
