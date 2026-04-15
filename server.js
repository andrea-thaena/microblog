const express = require('express');
const session = require('express-session');
const path = require('path');
const { marked } = require('marked');
const { getEmbedInfo } = require('./lib/unfurl');

marked.setOptions({ breaks: true, gfm: true });

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

// View engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'data', 'uploads')));
app.use('/public', express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 1 week
}));

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.redirect('/admin/login');
}

// Template helpers + auth status
app.use((req, res, next) => {
  res.locals.isAdmin = !!(req.session && req.session.authenticated);
  res.locals.renderMarkdown = (text) => marked.parse(text || '');
  res.locals.getEmbedInfo = getEmbedInfo;
  next();
});

// Login routes (no auth required — must be before requireAuth middleware)
app.get('/admin/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    req.session.authenticated = true;
    res.redirect('/admin');
  } else {
    res.render('login', { error: 'Wrong password' });
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Protected admin routes
app.use('/admin', requireAuth, require('./routes/admin'));

// Public feed
app.use('/', require('./routes/feed'));

// Init DB then start
const { getDb } = require('./db');
getDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Microblog running at http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
