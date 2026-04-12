/**
 * Fetch Open Graph / meta data from a URL for link card previews.
 * Returns { title, description, image, url } or null on failure.
 */
async function unfurlUrl(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'MicroblogBot/1.0 (link preview)' },
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;

    const html = await res.text();

    const og = (prop) => {
      const m = html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
        || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, 'i'));
      return m ? decodeEntities(m[1]) : null;
    };

    const meta = (name) => {
      const m = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'))
        || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, 'i'));
      return m ? decodeEntities(m[1]) : null;
    };

    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);

    return {
      title: og('title') || meta('title') || (titleTag ? decodeEntities(titleTag[1]) : url),
      description: og('description') || meta('description') || '',
      image: og('image') || '',
      url: og('url') || url,
    };
  } catch {
    return null;
  }
}

function decodeEntities(str) {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
}

/**
 * Detect embed type from URL for special handling (YouTube, TikTok, etc.)
 */
function getEmbedInfo(url) {
  try {
    const u = new URL(url);

    // YouTube
    const ytMatch = u.hostname.match(/youtube\.com|youtu\.be/);
    if (ytMatch) {
      let videoId = u.searchParams.get('v');
      if (u.hostname === 'youtu.be') videoId = u.pathname.slice(1);
      if (videoId) return { type: 'youtube', embedUrl: `https://www.youtube.com/embed/${videoId}` };
    }

    // TikTok
    if (u.hostname.includes('tiktok.com') && u.pathname.includes('/video/')) {
      return { type: 'tiktok', originalUrl: url };
    }

    // Substack
    if (u.hostname.includes('substack.com')) {
      return { type: 'substack', originalUrl: url };
    }

    return null;
  } catch {
    return null;
  }
}

module.exports = { unfurlUrl, getEmbedInfo };
