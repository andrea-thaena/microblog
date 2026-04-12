const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { unfurlUrl, getEmbedInfo } = require('../lib/unfurl');

// Multer config
const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|mp3|m4a|wav|ogg|mp4|mov|webm|pdf/;
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    cb(null, allowed.test(ext));
  }
});

// Admin dashboard — list all posts
router.get('/', (req, res) => {
  const posts = db.listPosts({ limit: 200 });
  const tags = db.getAllTags();
  res.render('admin', { posts, tags, editing: null, categories: db.CATEGORIES });
});

// New post
router.post('/post', upload.array('files', 20), async (req, res) => {
  const { body: text, tags, urls, category } = req.body;
  const tagList = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  const mediaItems = [];

  // Process uploaded files
  if (req.files) {
    for (const file of req.files) {
      const type = getFileType(file.mimetype);
      mediaItems.push({
        type,
        url: '/uploads/' + file.filename,
        original_name: file.originalname,
        mime_type: file.mimetype,
      });
    }
  }

  // Process URLs
  if (urls) {
    const urlList = (Array.isArray(urls) ? urls : [urls]).filter(u => u.trim());
    for (const url of urlList) {
      const embed = getEmbedInfo(url);
      const meta = await unfurlUrl(url);
      mediaItems.push({
        type: 'link',
        url: url.trim(),
        link_title: meta?.title || url,
        link_description: meta?.description || '',
        link_image: meta?.image || '',
      });
    }
  }

  db.createPost(text, mediaItems, tagList, category || null);
  res.redirect('/admin');
});

// Edit form
router.get('/edit/:id', (req, res) => {
  const post = db.getPost(parseInt(req.params.id));
  if (!post) return res.redirect('/admin');
  const posts = db.listPosts({ limit: 200 });
  const tags = db.getAllTags();
  res.render('admin', { posts, tags, editing: post, categories: db.CATEGORIES });
});

// Update post
router.post('/edit/:id', upload.array('files', 20), async (req, res) => {
  const id = parseInt(req.params.id);
  const { body: text, tags, urls, category } = req.body;
  const tagList = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  const mediaItems = [];

  if (req.files) {
    for (const file of req.files) {
      const type = getFileType(file.mimetype);
      mediaItems.push({
        type,
        url: '/uploads/' + file.filename,
        original_name: file.originalname,
        mime_type: file.mimetype,
      });
    }
  }

  if (urls) {
    const urlList = (Array.isArray(urls) ? urls : [urls]).filter(u => u.trim());
    for (const url of urlList) {
      const meta = await unfurlUrl(url);
      mediaItems.push({
        type: 'link',
        url: url.trim(),
        link_title: meta?.title || url,
        link_description: meta?.description || '',
        link_image: meta?.image || '',
      });
    }
  }

  db.updatePost(id, text, mediaItems, tagList, category || null);
  res.redirect('/admin');
});

// Delete post
router.post('/delete/:id', (req, res) => {
  const post = db.getPost(parseInt(req.params.id));
  if (post) {
    // Clean up uploaded files
    for (const m of post.media) {
      if (m.url.startsWith('/uploads/')) {
        const fp = path.join(__dirname, '..', m.url);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      }
    }
    db.deletePost(parseInt(req.params.id));
  }
  res.redirect('/admin');
});

// Delete single media item
router.post('/media/delete/:id', (req, res) => {
  const m = db.deleteMedia(parseInt(req.params.id));
  if (m && m.url && m.url.startsWith('/uploads/')) {
    const fp = path.join(__dirname, '..', m.url);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  res.redirect(req.headers.referer || '/admin');
});

function getFileType(mimetype) {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('audio/')) return 'audio';
  if (mimetype.startsWith('video/')) return 'video';
  return 'file';
}

module.exports = router;
