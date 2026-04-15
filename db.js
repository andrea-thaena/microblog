const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
const uploadsDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const DB_PATH = path.join(dataDir, 'microblog.db');

let db;

async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      body TEXT,
      category TEXT,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      url TEXT NOT NULL,
      original_name TEXT,
      mime_type TEXT,
      link_title TEXT,
      link_description TEXT,
      link_image TEXT,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS post_tags (
      post_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (post_id, tag_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    )
  `);

  // Migration: add category column if missing
  try { db.run('ALTER TABLE posts ADD COLUMN category TEXT'); } catch(e) {}

  save();
  return db;
}

function save() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Helper: run a SELECT and return array of objects
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  const rows = all(sql, params);
  return rows.length ? rows[0] : null;
}

function run(sql, params = []) {
  db.run(sql, params);
}

function runAndSave(sql, params = []) {
  db.run(sql, params);
  save();
}

function getLastId() {
  const stmt = db.prepare('SELECT last_insert_rowid() as id');
  stmt.step();
  const row = stmt.getAsObject();
  stmt.free();
  return row.id;
}

function createPost(body, mediaItems, tagNames, category) {
  run('INSERT INTO posts (body, category) VALUES (?, ?)', [body || '', category || null]);
  const postId = getLastId();

  if (mediaItems && mediaItems.length) {
    mediaItems.forEach((m, i) => {
      run(
        `INSERT INTO media (post_id, type, url, original_name, mime_type, link_title, link_description, link_image, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [postId, m.type, m.url, m.original_name || null, m.mime_type || null,
         m.link_title || null, m.link_description || null, m.link_image || null, i]
      );
    });
  }

  if (tagNames && tagNames.length) {
    tagNames.forEach(name => {
      const clean = name.trim().toLowerCase();
      if (!clean) return;
      run('INSERT OR IGNORE INTO tags (name) VALUES (?)', [clean]);
      const tag = get('SELECT * FROM tags WHERE name = ?', [clean]);
      run('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)', [postId, tag.id]);
    });
  }

  save();
  return postId;
}

function updatePost(id, body, mediaItems, tagNames, category) {
  run('UPDATE posts SET body = ?, category = ?, updated_at = datetime("now") WHERE id = ?', [body || '', category || null, id]);

  run('DELETE FROM post_tags WHERE post_id = ?', [id]);
  if (tagNames && tagNames.length) {
    tagNames.forEach(name => {
      const clean = name.trim().toLowerCase();
      if (!clean) return;
      run('INSERT OR IGNORE INTO tags (name) VALUES (?)', [clean]);
      const tag = get('SELECT * FROM tags WHERE name = ?', [clean]);
      run('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)', [id, tag.id]);
    });
  }

  if (mediaItems && mediaItems.length) {
    const row = get('SELECT COALESCE(MAX(sort_order),0) as m FROM media WHERE post_id = ?', [id]);
    const maxOrder = row ? row.m : 0;
    mediaItems.forEach((m, i) => {
      run(
        `INSERT INTO media (post_id, type, url, original_name, mime_type, link_title, link_description, link_image, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, m.type, m.url, m.original_name || null, m.mime_type || null,
         m.link_title || null, m.link_description || null, m.link_image || null, maxOrder + i + 1]
      );
    });
  }

  save();
}

function deletePost(id) {
  run('DELETE FROM posts WHERE id = ?', [id]);
  save();
}

function getPost(id) {
  const post = get('SELECT * FROM posts WHERE id = ?', [id]);
  if (!post) return null;
  post.media = all('SELECT * FROM media WHERE post_id = ? ORDER BY sort_order', [id]);
  post.tags = all('SELECT t.name FROM tags t JOIN post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = ? ORDER BY t.name', [id]).map(t => t.name);
  return post;
}

function listPosts({ tag, category, limit = 50, offset = 0 } = {}) {
  let sql = 'SELECT p.* FROM posts p';
  const params = [];
  const wheres = [];

  if (tag) {
    sql += ' JOIN post_tags pt ON pt.post_id = p.id JOIN tags t ON t.id = pt.tag_id';
    wheres.push('t.name = ?');
    params.push(tag.toLowerCase());
  }

  if (category) {
    wheres.push('p.category = ?');
    params.push(category);
  }

  if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');

  sql += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const posts = all(sql, params);
  posts.forEach(p => {
    p.media = all('SELECT * FROM media WHERE post_id = ? ORDER BY sort_order', [p.id]);
    p.tags = all('SELECT t.name FROM tags t JOIN post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = ? ORDER BY t.name', [p.id]).map(t => t.name);
  });
  return posts;
}

function getAllTags() {
  return all('SELECT t.name, COUNT(pt.post_id) as count FROM tags t JOIN post_tags pt ON pt.tag_id = t.id GROUP BY t.id ORDER BY t.name');
}

function deleteMedia(mediaId) {
  const m = get('SELECT * FROM media WHERE id = ?', [mediaId]);
  run('DELETE FROM media WHERE id = ?', [mediaId]);
  save();
  return m;
}

const CATEGORIES = [
  'Tips for AI Integration',
  'Microbiome Nerd Stuff',
];

module.exports = { getDb, createPost, updatePost, deletePost, getPost, listPosts, getAllTags, deleteMedia, CATEGORIES };
